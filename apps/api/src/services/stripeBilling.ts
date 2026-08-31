import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type Stripe from "stripe";
import type { Prisma, PrismaClient, StripeBillingAccount } from "@vaettir/db";
import { assertActiveOrganization, lockOrganization } from "./organizationLock.js";
import { requireAdmin, usage } from "./seatManagement.js";
import { BILLING_PRODUCT, type BillingRuntime, type BillingOffer } from "./stripeConfig.js";

const terminal = new Set(["none", "canceled", "incomplete_expired"]);
const fail = (message: string): never => { throw new TRPCError({ code: "CONFLICT", message }); };
const id = (value: { id: string } | string | null | undefined) => typeof value === "string" ? value : value?.id;
const metadata = (account: StripeBillingAccount) => ({ product: BILLING_PRODUCT, environment: account.environment, organizationId: account.organizationId, billingAccountId: account.id });
const matches = (values: Stripe.Metadata | null, account: StripeBillingAccount) => Object.entries(metadata(account)).every(([k, v]) => values?.[k] === v);

// Recheck persisted membership and suspension for every billing request. CI/staff
// tokens are not a substitute for an authenticated human billing administrator.
export async function authorizeBilling(tx: Prisma.TransactionClient, organizationId: string, actorId: string) {
  assertActiveOrganization(await lockOrganization(tx, organizationId));
  await requireAdmin(tx, organizationId, actorId);
  if (await tx.apiKey.findUnique({ where: { serviceUserId: actorId } })) throw new TRPCError({ code: "FORBIDDEN", message: "A human organization administrator is required for billing." });
  const org = await tx.organization.findUniqueOrThrow({ where: { id: organizationId }, include: { planTier: true, betaEnrollment: true } });
  if (org.planTier.key === "private-beta" || org.betaEnrollment) throw new TRPCError({ code: "FORBIDDEN", message: "Private beta is free. Paid checkout and plan changes are not available." });
  return org;
}

async function accountFor(tx: Prisma.TransactionClient, organizationId: string, runtime: BillingRuntime) {
  const account = await tx.stripeBillingAccount.findUnique({ where: { organizationId } });
  if (!account || account.environment !== runtime.config.environment) throw new TRPCError({ code: "FORBIDDEN", message: "This organization is not enrolled for this billing test environment." });
  return account;
}

export async function enrollBillingTest(db: PrismaClient, runtime: BillingRuntime, organizationId: string, actor: string, reason: string) {
  return db.$transaction(async tx => {
    assertActiveOrganization(await lockOrganization(tx, organizationId));
    const org = await tx.organization.findUniqueOrThrow({ where: { id: organizationId }, include: { planTier: true, betaEnrollment: true } });
    if (org.planTier.key !== "free" || org.betaEnrollment) fail("Enroll only an isolated, non-beta Free organization for billing tests.");
    const existing = await tx.stripeBillingAccount.findUnique({ where: { organizationId } });
    if (existing) {
      if (existing.environment !== runtime.config.environment) fail("Billing environment cannot be changed through enrollment.");
      return { enrolled: true };
    }
    await tx.stripeBillingAccount.create({ data: { organizationId, environment: runtime.config.environment, createdBy: actor, reason } });
    return { enrolled: true };
  });
}

export async function billingStatus(db: PrismaClient, runtime: BillingRuntime | null, organizationId: string, actorId: string) {
  return db.$transaction(async tx => {
    await authorizeBilling(tx, organizationId, actorId);
    const account = await tx.stripeBillingAccount.findUnique({ where: { organizationId } });
    return { enabled: !!runtime && account?.environment === runtime.config.environment, testOnly: true,
      status: account?.status ?? "not_enrolled", entitledPlanKey: account?.entitledPlanKey ?? null,
      purchasedFullSeats: account?.entitledFullSeats ?? 0, checkoutPending: !!account?.checkoutKey && !account.subscriptionId,
      offers: runtime?.config.offers.map(o => ({ planKey: o.planKey })) ?? [] };
  });
}

function assertCustomer(customer: Stripe.Customer | Stripe.DeletedCustomer, account: StripeBillingAccount) {
  if (customer.deleted || customer.livemode || customer.id !== account.customerId || !matches(customer.metadata, account)) fail("Billing customer ownership could not be verified.");
}

function validPrice(price: Stripe.Price, offer: BillingOffer, runtime: BillingRuntime) {
  const product = price.product;
  return price.id === offer.priceId && price.active && !price.livemode && price.type === "recurring"
    && price.recurring?.usage_type === "licensed" && price.recurring.interval === "month" && price.recurring.interval_count === 1
    && price.billing_scheme === "per_unit" && !price.transform_quantity && !price.custom_unit_amount
    && price.unit_amount !== null && price.unit_amount > 0 && price.currency === offer.currency
    && typeof product === "object" && !product.deleted && product.active && !product.livemode && product.id === offer.productId
    && product.metadata.product === BILLING_PRODUCT && product.metadata.environment === runtime.config.environment && product.metadata.planKey === offer.planKey;
}

function safeStripeUrl(value: string | null, hostname: string) {
  if (!value) fail("Billing session did not return a redirect.");
  const url = new URL(value!);
  if (url.protocol !== "https:" || url.hostname !== hostname || url.username || url.password || url.port) fail("Unexpected billing redirect.");
  return url.href;
}

export async function createCheckout(db: PrismaClient, runtime: BillingRuntime, actorId: string, input: { organizationId: string; planKey: string; fullSeats: number }) {
  const offer = runtime.config.offers.find(o => o.planKey === input.planKey);
  if (!offer) throw new TRPCError({ code: "BAD_REQUEST", message: "This plan has no approved test price." });
  let account = await db.$transaction(async tx => {
    await authorizeBilling(tx, input.organizationId, actorId);
    return accountFor(tx, input.organizationId, runtime);
  });
  const price = await runtime.stripe.prices.retrieve(offer.priceId, { expand: ["product"] });
  if (!validPrice(price, offer, runtime)) fail("Configured price is not an approved Vaettir test subscription price.");
  account = await db.$transaction(async tx => {
    await authorizeBilling(tx, input.organizationId, actorId);
    const current = await accountFor(tx, input.organizationId, runtime);
    const tier = await tx.planTier.findUniqueOrThrow({ where: { key: offer.planKey } });
    const counts = await usage(tx, input.organizationId);
    if (!tier.isPublic || !Number.isInteger(input.fullSeats) || input.fullSeats < tier.minFullSeats || input.fullSeats > (tier.maxFullSeats ?? 10000)
      || counts.fullSeats > input.fullSeats || (tier.maxReadOnlySeats !== null && counts.readOnlySeats > tier.maxReadOnlySeats)) fail("Selected seats cannot accommodate this organization and its invitations.");
    if (!terminal.has(current.status)) fail("A subscription already exists. Use billing support for plan changes.");
    if (current.checkoutKey) {
      if (current.checkoutPriceId !== offer.priceId || current.checkoutSeats !== input.fullSeats) fail("Another checkout is pending. Resume it or contact support.");
      if (!current.checkoutStartedAt || Date.now() - current.checkoutStartedAt.getTime() >= 3600_000) fail("Checkout expired or has an uncertain outcome. Contact support to reconcile before retrying.");
      return current;
    }
    return tx.stripeBillingAccount.update({ where: { id: current.id }, data: {
      checkoutKey: randomUUID(), checkoutPriceId: offer.priceId, checkoutSeats: input.fullSeats, checkoutStartedAt: new Date(),
      customerStartedAt: current.customerStartedAt ?? new Date(),
    } });
  });
  if (!account.customerId) {
    // Do not retry an unresolved customer creation after Stripe's key retention window.
    if (!account.customerStartedAt || Date.now() - account.customerStartedAt.getTime() > 23 * 3600_000) fail("Customer creation requires billing support reconciliation.");
    const customer = await runtime.stripe.customers.create({ metadata: metadata(account) }, { idempotencyKey: `vaettir:${account.environment}:${account.id}:customer` });
    if (customer.livemode || !matches(customer.metadata, account)) fail("Unexpected billing customer.");
    account = await db.$transaction(async tx => {
      await authorizeBilling(tx, input.organizationId, actorId);
      const current = await accountFor(tx, input.organizationId, runtime);
      if (current.customerId && current.customerId !== customer.id) fail("Billing customer changed; support reconciliation required.");
      return tx.stripeBillingAccount.update({ where: { id: current.id }, data: { customerId: customer.id } });
    });
  }
  assertCustomer(await runtime.stripe.customers.retrieve(account.customerId!), account);
  // Repeat authorization after external reads; no network calls hold DB locks.
  await db.$transaction(async tx => { await authorizeBilling(tx, input.organizationId, actorId); });
  // Persisted checkout key supplies a stable integration label for retries.
  const label = account.checkoutKey!.slice(0, 8).split("").map(c => String.fromCharCode(97 + parseInt(c, 16))).join("");
  const session = await runtime.stripe.checkout.sessions.create({
    mode: "subscription", customer: account.customerId!, client_reference_id: account.id,
    line_items: [{ price: offer.priceId, quantity: account.checkoutSeats! }],
    metadata: { ...metadata(account), checkoutKey: account.checkoutKey! },
    subscription_data: { metadata: { ...metadata(account), checkoutKey: account.checkoutKey! } },
    success_url: `${runtime.config.origin}/settings/billing?checkout=returned`, cancel_url: `${runtime.config.origin}/settings/billing?checkout=canceled`,
    expires_at: Math.floor(account.checkoutStartedAt!.getTime() / 1000) + 3600,
    integration_identifier: `vaettir-hosted-${label}`, automatic_tax: { enabled: false },
  }, { idempotencyKey: `vaettir:${account.environment}:${account.checkoutKey}` });
  if (session.livemode || session.mode !== "subscription" || id(session.customer) !== account.customerId) fail("Unexpected checkout session.");
  return db.$transaction(async tx => {
    await authorizeBilling(tx, input.organizationId, actorId);
    const current = await accountFor(tx, input.organizationId, runtime);
    if (current.checkoutKey !== account.checkoutKey) fail("Checkout changed; refresh billing status.");
    await tx.stripeBillingAccount.update({ where: { id: account.id }, data: { checkoutSessionId: session.id } });
    return { url: safeStripeUrl(session.url, "checkout.stripe.com"), testOnly: true };
  });
}

export async function createPortal(db: PrismaClient, runtime: BillingRuntime, organizationId: string, actorId: string) {
  const account = await db.$transaction(async tx => { await authorizeBilling(tx, organizationId, actorId); return accountFor(tx, organizationId, runtime); });
  if (!account.customerId) fail("No billing customer exists yet.");
  assertCustomer(await runtime.stripe.customers.retrieve(account.customerId!), account);
  const config = await runtime.stripe.billingPortal.configurations.retrieve(runtime.config.portalConfiguration);
  if (!config.active || config.livemode || config.metadata?.product !== BILLING_PRODUCT || config.metadata.environment !== account.environment
    || config.login_page.enabled || config.features.subscription_update.enabled
    || (config.features.subscription_cancel.enabled && config.features.subscription_cancel.mode !== "at_period_end")) fail("Portal must be product-specific, with public login and subscription updates disabled.");
  const subscriptions = await runtime.stripe.subscriptions.list({ customer: account.customerId!, status: "all", limit: 100 });
  if (subscriptions.has_more || subscriptions.data.some(sub => sub.livemode || !matches(sub.metadata, account))) fail("Customer is not isolated to Vaettir. Portal access refused.");
  await db.$transaction(async tx => { await authorizeBilling(tx, organizationId, actorId); });
  const session = await runtime.stripe.billingPortal.sessions.create({ customer: account.customerId!, configuration: config.id, return_url: `${runtime.config.origin}/settings/billing` });
  await db.$transaction(async tx => { await authorizeBilling(tx, organizationId, actorId); });
  return { url: safeStripeUrl(session.url, "billing.stripe.com"), testOnly: true };
}

function eventTarget(event: Stripe.Event): { customer?: string; subscription?: string } | null {
  const object = event.data.object;
  if (["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted", "customer.subscription.paused", "customer.subscription.resumed"].includes(event.type)) {
    const sub = object as Stripe.Subscription; return { customer: id(sub.customer), subscription: sub.id };
  }
  if (["invoice.paid", "invoice.payment_failed", "invoice.payment_action_required"].includes(event.type)) {
    const invoice = object as Stripe.Invoice; return { customer: id(invoice.customer), subscription: id(invoice.parent?.subscription_details?.subscription) };
  }
  if (["checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.async_payment_failed"].includes(event.type)) {
    const session = object as Stripe.Checkout.Session;
    return session.mode === "subscription" ? { customer: id(session.customer), subscription: id(session.subscription) } : null;
  }
  return null;
}

export async function processBillingEvent(db: PrismaClient, runtime: BillingRuntime, event: Stripe.Event) {
  // Only direct account test events, never Connect/organization contexts or live events.
  if (event.livemode || event.account || event.context) return { outcome: "ignored_environment" };
  const target = eventTarget(event);
  if (!target?.customer || !target.subscription) return { outcome: "ignored_type" };
  const account = await db.stripeBillingAccount.findUnique({ where: { customerId: target.customer } });
  if (!account || account.environment !== runtime.config.environment) return { outcome: "ignored_customer" };
  const token = randomUUID();
  const claimed = await db.$transaction(async tx => {
    await lockOrganization(tx, account.organizationId);
    if (await tx.stripeBillingEvent.findUnique({ where: { environment_eventId: { environment: account.environment, eventId: event.id } } })) return false;
    const current = await tx.stripeBillingAccount.findUniqueOrThrow({ where: { id: account.id } });
    if (current.syncUntil && current.syncUntil > new Date()) fail("Billing reconciliation busy; retry event.");
    await tx.stripeBillingAccount.update({ where: { id: account.id }, data: { syncToken: token, syncUntil: new Date(Date.now() + 60_000) } });
    return true;
  });
  if (!claimed) return { outcome: "duplicate" };
  try {
    assertCustomer(await runtime.stripe.customers.retrieve(account.customerId!), account);
    // Fetch current state for EVERY event, never order snapshots by event.created.
    const sub = await runtime.stripe.subscriptions.retrieve(target.subscription, { expand: ["items.data.price.product", "latest_invoice"] });
    const offer = runtime.config.offers.find(o => o.priceId === sub.items.data[0]?.price.id);
    const quantity = sub.items.data[0]?.quantity ?? 0;
    const invoice = sub.latest_invoice;
    const valid = !sub.livemode && id(sub.customer) === account.customerId && matches(sub.metadata, account)
      && sub.items.data.length === 1 && !sub.items.has_more && !!offer && validPrice(sub.items.data[0]!.price, offer, runtime)
      && Number.isSafeInteger(quantity) && quantity > 0 && !sub.pending_update && !sub.pause_collection;
    const paid = valid && sub.status === "active" && typeof invoice === "object" && invoice !== null && invoice.status === "paid"
      && !invoice.livemode && id(invoice.customer) === account.customerId && id(invoice.parent?.subscription_details?.subscription) === sub.id;
    return await db.$transaction(async tx => {
      await lockOrganization(tx, account.organizationId);
      const current = await tx.stripeBillingAccount.findUniqueOrThrow({ where: { id: account.id } });
      if (current.syncToken !== token || !current.syncUntil || current.syncUntil <= new Date()) fail("Billing reconciliation lease expired; retry event.");
      const org = await tx.organization.findUniqueOrThrow({ where: { id: account.organizationId }, include: { planTier: true, betaEnrollment: true } });
      let outcome = "ignored_binding";
      const bound = current.subscriptionId === sub.id || (!!current.checkoutKey && sub.metadata.checkoutKey === current.checkoutKey && matches(sub.metadata, current));
      if (bound && org.planTier.key !== "private-beta" && !org.betaEnrollment) {
        const tier = offer ? await tx.planTier.findUnique({ where: { key: offer.planKey } }) : null;
        const grant = paid && tier?.isPublic && quantity >= tier.minFullSeats && quantity <= (tier.maxFullSeats ?? 10000);
        const free = await tx.planTier.findUniqueOrThrow({ where: { key: "free" } });
        await tx.organization.update({ where: { id: org.id }, data: { planTierId: grant ? tier!.id : free.id, billingFullSeats: grant ? quantity : 0 } });
        await tx.stripeBillingAccount.update({ where: { id: current.id }, data: { subscriptionId: sub.id, status: sub.status,
          entitledPlanKey: grant ? tier!.key : null, entitledFullSeats: grant ? quantity : 0,
          ...(terminal.has(sub.status) && sub.metadata.checkoutKey === current.checkoutKey ? { checkoutKey: null, checkoutSessionId: null, checkoutPriceId: null, checkoutSeats: null, checkoutStartedAt: null } : {}),
        } });
        outcome = grant ? "test_entitlement_granted" : "paid_entitlement_withheld";
      }
      await tx.stripeBillingEvent.create({ data: { environment: account.environment, eventId: event.id, eventType: event.type, accountId: account.id, outcome } });
      await tx.stripeBillingAccount.update({ where: { id: account.id }, data: { syncToken: null, syncUntil: null } });
      return { outcome };
    });
  } finally {
    // An expired worker must never clear its replacement's lease.
    await db.stripeBillingAccount.updateMany({ where: { id: account.id, syncToken: token }, data: { syncToken: null, syncUntil: null } });
  }
}
