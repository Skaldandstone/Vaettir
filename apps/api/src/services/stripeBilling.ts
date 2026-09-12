import type Stripe from "stripe";
import type { PrismaClient } from "@vaettir/db";
import { getStripeRuntime } from "./stripeConfig.js";

// P12-05: real Stripe subscription billing, wired against sandbox/test mode
// (see stripeConfig.ts) on direct instruction to get this running now with
// the proposed pricing rather than wait for a full pricing/provider
// sign-off. Every function here returns/throws a clear "billing not
// configured" outcome when STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET aren't
// set, matching this codebase's existing inert-until-configured contract
// for optional integrations (Sentry, Slack, GitHub webhooks).

export class BillingNotConfiguredError extends Error {
  constructor() {
    super("Billing is not configured on this deployment.");
    this.name = "BillingNotConfiguredError";
  }
}

// P12-11: the proposed top-off packs PRICING.md already documents (~$0.02/
// credit, with a pack discount at higher volumes) - a guestimate wired on
// direct instruction, same as P12-12's charging rate, pending a real
// pricing audit. Uses Stripe Checkout's inline price_data rather than a
// pre-created Price object per pack: unlike the per-seat subscription
// tiers (which need a real Stripe Price already configured, see
// PlanTier.stripePriceId), a one-time ad-hoc price needs nothing set up in
// the Stripe dashboard first.
export const CREDIT_TOPUP_PACKS = {
  "500": { credits: 500, priceUsdCents: 1000 },
  "2000": { credits: 2000, priceUsdCents: 3500 },
  "10000": { credits: 10_000, priceUsdCents: 15_000 },
} as const;
export type CreditTopupPackKey = keyof typeof CREDIT_TOPUP_PACKS;

async function getFullSeatCount(prisma: PrismaClient, organizationId: string): Promise<number> {
  return prisma.membership.count({ where: { organizationId, seatType: "FULL" } });
}

function requireReturnOrigin(env: NodeJS.ProcessEnv): string {
  const origin = env.VAETTIR_BILLING_RETURN_ORIGIN;
  if (!origin) throw new Error("VAETTIR_BILLING_RETURN_ORIGIN must be set to create a Checkout/Portal session.");
  return origin;
}

// Creates (or reuses) the Stripe Customer for this org, then a Checkout
// Session subscribing it to the target tier's price at a quantity matching
// the org's current full-seat count. The org isn't updated to the new plan
// tier here -- that only happens once Stripe confirms the subscription via
// the checkout.session.completed webhook (handleStripeWebhookEvent below),
// so a customer who abandons checkout never silently ends up "on" a plan
// they never actually paid for.
export async function createBillingCheckoutSession(
  prisma: PrismaClient,
  organizationId: string,
  planTierId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ url: string }> {
  const runtime = getStripeRuntime(env);
  if (!runtime) throw new BillingNotConfiguredError();
  const origin = requireReturnOrigin(env);

  const [organization, tier, fullSeats] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: organizationId } }),
    prisma.planTier.findUniqueOrThrow({ where: { id: planTierId } }),
    getFullSeatCount(prisma, organizationId),
  ]);
  if (!tier.stripePriceId) {
    throw new Error(`Plan tier "${tier.key}" has no Stripe price configured yet.`);
  }

  const customerId = await getOrCreateStripeCustomerId(prisma, runtime.stripe, organization);

  const session = await runtime.stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: tier.stripePriceId, quantity: Math.max(1, fullSeats) }],
    success_url: `${origin}/settings/billing?checkout=success`,
    cancel_url: `${origin}/settings/billing?checkout=cancelled`,
    metadata: { vaettirOrganizationId: organization.id, vaettirPlanTierId: tier.id },
    subscription_data: { metadata: { vaettirOrganizationId: organization.id, vaettirPlanTierId: tier.id } },
  });
  if (!session.url) throw new Error("Stripe did not return a Checkout Session URL.");
  return { url: session.url };
}

async function getOrCreateStripeCustomerId(
  prisma: PrismaClient,
  stripe: Stripe,
  organization: { id: string; name: string; stripeCustomerId: string | null },
): Promise<string> {
  if (organization.stripeCustomerId) return organization.stripeCustomerId;
  const customer = await stripe.customers.create({
    name: organization.name,
    metadata: { vaettirOrganizationId: organization.id },
  });
  await prisma.organization.update({ where: { id: organization.id }, data: { stripeCustomerId: customer.id } });
  return customer.id;
}

// P12-11: a one-time Checkout Session for a fixed AI-credit pack (see
// CREDIT_TOPUP_PACKS above). Distinct mode ("payment", not "subscription")
// and distinct metadata (vaettirTopupCredits) from the subscription
// checkout above, so the webhook handler can tell the two apart -- see
// handleStripeWebhookEvent's checkout.session.completed case.
export async function createCreditTopupCheckoutSession(
  prisma: PrismaClient,
  organizationId: string,
  packKey: CreditTopupPackKey,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ url: string }> {
  const runtime = getStripeRuntime(env);
  if (!runtime) throw new BillingNotConfiguredError();
  const origin = requireReturnOrigin(env);
  const pack = CREDIT_TOPUP_PACKS[packKey];

  const organization = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
  const customerId = await getOrCreateStripeCustomerId(prisma, runtime.stripe, organization);

  const session = await runtime.stripe.checkout.sessions.create({
    mode: "payment",
    customer: customerId,
    line_items: [
      {
        price_data: {
          currency: "usd",
          unit_amount: pack.priceUsdCents,
          product_data: { name: `${pack.credits.toLocaleString()} Vaettir AI credits` },
        },
        quantity: 1,
      },
    ],
    success_url: `${origin}/settings/billing?topup=success`,
    cancel_url: `${origin}/settings/billing?topup=cancelled`,
    metadata: { vaettirOrganizationId: organization.id, vaettirTopupCredits: String(pack.credits) },
  });
  if (!session.url) throw new Error("Stripe did not return a Checkout Session URL.");
  return { url: session.url };
}

// The Stripe-hosted billing portal for a customer who already has a real
// subscription -- update payment method, view invoices, cancel. Requires a
// stripeCustomerId already on file, i.e. at least one prior real checkout.
export async function createBillingPortalSession(
  prisma: PrismaClient,
  organizationId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ url: string }> {
  const runtime = getStripeRuntime(env);
  if (!runtime) throw new BillingNotConfiguredError();
  const origin = requireReturnOrigin(env);

  const organization = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
  if (!organization.stripeCustomerId) {
    throw new Error("This organization has no billing account yet -- subscribe to a paid plan first.");
  }

  const session = await runtime.stripe.billingPortal.sessions.create({
    customer: organization.stripeCustomerId,
    return_url: `${origin}/settings/billing`,
  });
  return { url: session.url };
}

// Keeps the Stripe subscription's item quantity in sync with the org's real
// current full-seat count, so a seat added/removed outside of Checkout
// (an invite accepted, a member removed, a seat-type change) is reflected
// in what actually gets billed next cycle. Fire-and-forget from every seat-
// count-changing mutation, same pattern P5-14/P9-06 already use for
// background enrichment that shouldn't slow down the request that
// triggered it -- a transient Stripe API failure here should never fail
// the seat mutation itself. A no-op (not an error) when billing isn't
// configured or the org has no active subscription -- most orgs, most of
// the time, on a deployment that may not even have billing wired up yet.
export async function syncBillingSeatQuantity(
  prisma: PrismaClient,
  organizationId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const runtime = getStripeRuntime(env);
  if (!runtime) return;
  const organization = await prisma.organization.findUnique({ where: { id: organizationId } });
  if (!organization?.stripeSubscriptionId) return;

  const [subscription, fullSeats] = await Promise.all([
    runtime.stripe.subscriptions.retrieve(organization.stripeSubscriptionId),
    getFullSeatCount(prisma, organizationId),
  ]);
  const item = subscription.items.data[0];
  if (!item || item.quantity === fullSeats) return;
  await runtime.stripe.subscriptionItems.update(item.id, { quantity: Math.max(1, fullSeats) });
}

// Handles the three subscription lifecycle events this pass cares about.
// Every other event type is acknowledged (200) and ignored -- Stripe
// retries on a non-2xx response, and there's no reason to retry-storm
// ourselves over an event we don't act on.
export async function handleStripeWebhookEvent(prisma: PrismaClient, event: Stripe.Event): Promise<{ handled: boolean; reason?: string }> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const organizationId = session.metadata?.vaettirOrganizationId;
      if (!organizationId) return { handled: false, reason: "checkout session missing expected metadata" };

      // P12-11: a credit top-off is a one-time payment, not a subscription --
      // distinguished by its own metadata key, checked first since a topup
      // session has no planTierId/subscription to fall through to below.
      const topupCredits = session.metadata?.vaettirTopupCredits;
      if (topupCredits) {
        const amount = Number(topupCredits);
        if (!Number.isFinite(amount) || amount <= 0) return { handled: false, reason: "invalid topup credit amount in metadata" };
        await prisma.aiCreditTransaction.create({
          data: { organizationId, type: "TOPUP", amount, description: `Purchased ${amount.toLocaleString()} credits (Stripe checkout ${session.id})` },
        });
        return { handled: true };
      }

      const planTierId = session.metadata?.vaettirPlanTierId;
      const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
      if (!planTierId || !subscriptionId) {
        return { handled: false, reason: "checkout session missing expected metadata" };
      }
      await prisma.organization.update({
        where: { id: organizationId },
        data: { stripeSubscriptionId: subscriptionId, planTierId },
      });
      return { handled: true };
    }
    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const organizationId = subscription.metadata?.vaettirOrganizationId;
      if (!organizationId) return { handled: false, reason: "subscription missing expected metadata" };
      // Cancellation reverts to Free rather than leaving the org pinned to a
      // paid tier with no active subscription behind it.
      const freeTier = await prisma.planTier.findUnique({ where: { key: "free" } });
      if (!freeTier) return { handled: false, reason: "no free tier configured to revert to" };
      await prisma.organization.update({
        where: { id: organizationId },
        data: { stripeSubscriptionId: null, planTierId: freeTier.id },
      });
      return { handled: true };
    }
    default:
      return { handled: false, reason: `ignored event type: ${event.type}` };
  }
}
