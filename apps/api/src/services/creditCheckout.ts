import { createHash } from "node:crypto";
import { z } from "@vaettir/core/dist/validation.js";
import { TRPCError } from "@trpc/server";
import type Stripe from "stripe";
import { Prisma, type PrismaClient } from "@vaettir/db";
import { CREDIT_TOPUP_PACKS } from "./creditPacks.js";
import {
  creditPurchasesEnabled,
  getCreditStripeRuntime,
  type CreditStripeRuntime,
} from "./creditStripeConfig.js";
import { encryptToken, decryptToken } from "./tokenEncryption.js";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}
// PostgreSQL JSONB reorders object keys. A replay must compare values, not the
// incidental insertion order of the provider or database JSON representation.
const digest = (value: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
export const creditCheckoutInput = z
  .object({
    organizationId: z.string().min(1).max(200),
    requestId: z.string().uuid(),
    packKey: z.enum(["500", "2000", "10000"]),
  })
  .strict();
export type CreditCheckoutActor = { actorId: string; clerkSubject: string };
export const creditCheckoutStatusInput = z
  .object({
    organizationId: z.string().min(1).max(200),
    requestId: z.string().uuid(),
  })
  .strict();
export const creditCheckoutStatusOutput = z.object({
  status: z.enum([
    "NONE",
    "OPEN",
    "PROCESSING",
    "FAILED",
    "DELIVERED",
    "EXPIRED",
    "REVIEW_REQUIRED",
  ]),
  credits: z.number().nullable(),
});
const purchaseSchema = z
  .object({
    kind: z.literal("credit-purchase-v1"),
    requestId: z.string().uuid(),
    actorClerkId: z.string().min(1).max(200),
    packKey: z.enum(["500", "2000", "10000"]),
    credits: z.number().int().positive().max(10000),
    priceUsdCents: z.number().int().positive().max(15000),
    currency: z.literal("usd"),
    mode: z.enum(["live", "sandbox"]),
    accountId: z.string().max(100),
    organizationName: z.string().max(300),
    returnOrigin: z.string().url(),
  })
  .strict();
const cipher = z
  .object({ ciphertext: z.string(), iv: z.string(), authTag: z.string() })
  .strict();
const issuedSchema = z
  .object({
    kind: z.literal("credit-checkout-v1"),
    intentId: z.string(),
    sessionId: z.string(),
    customerId: z.string(),
    encryptedUrl: cipher,
  })
  .strict();
function checkoutUrl(raw: string) {
  const url = new URL(raw);
  if (
    raw.length > 8192 ||
    url.origin !== "https://checkout.stripe.com" ||
    url.username ||
    url.password
  )
    throw new Error("Unexpected payment destination.");
  return raw;
}

export async function reviewedCreditCheckoutStatus(
  db: PrismaClient,
  input: z.infer<typeof creditCheckoutStatusInput>,
  actor: CreditCheckoutActor,
  env: NodeJS.ProcessEnv = process.env,
): Promise<z.infer<typeof creditCheckoutStatusOutput>> {
  await db.$transaction((tx) => lockedAdmin(tx, input.organizationId, actor), {
    timeout: 10000,
  });
  const id =
    "credit-intent-" +
    digest([
      input.organizationId,
      actor.actorId,
      actor.clerkSubject,
      input.requestId,
    ]);
  const intent = await db.auditLog.findUnique({ where: { id } });
  if (!intent) return { status: "NONE", credits: null };
  if (
    intent.organizationId !== input.organizationId ||
    intent.actorId !== actor.actorId ||
    intent.entityType !== "CreditPurchase"
  )
    throw new Error("Purchase identity mismatch.");
  const terms = purchaseSchema.parse(intent.metadata);
  const ledgerId = "credit-topup-" + digest([terms.accountId, terms.mode, id]);
  const ledger = await db.aiCreditTransaction.findUnique({
    where: { id: ledgerId },
  });
  if (ledger) {
    if (
      ledger.organizationId !== input.organizationId ||
      ledger.type !== "TOPUP" ||
      ledger.amount !== terms.credits
    )
      throw new Error("Settlement mismatch.");
    return { status: "DELIVERED", credits: terms.credits };
  }
  const issued = await db.auditLog.findUnique({
    where: { id: "credit-issued-" + digest(id) },
  });
  if (!issued) return { status: "REVIEW_REQUIRED", credits: terms.credits };
  const receipt = issuedSchema.parse(issued.metadata);
  const runtime = getCreditStripeRuntime(env);
  if (
    !runtime ||
    runtime.accountId !== terms.accountId ||
    runtime.mode !== terms.mode
  )
    return { status: "REVIEW_REQUIRED", credits: terms.credits };
  const session = await runtime.stripe.checkout.sessions.retrieve(
    receipt.sessionId,
  );
  if (
    session.metadata?.vaettirCreditIntentId !== id ||
    session.client_reference_id !== input.organizationId
  )
    throw new Error("Checkout identity mismatch.");
  await db.$transaction((tx) => lockedAdmin(tx, input.organizationId, actor), {
    timeout: 10000,
  });
  const failed = await db.auditLog.findUnique({
    where: {
      id:
        "credit-failed-" +
        digest([terms.accountId, terms.mode, receipt.sessionId]),
    },
  });
  return {
    status:
      session.status === "expired"
        ? "EXPIRED"
        : session.status === "open"
          ? "OPEN"
          : failed && session.payment_status === "unpaid"
            ? "FAILED"
            : "PROCESSING",
    credits: terms.credits,
  };
}

async function lockedAdmin(
  tx: Prisma.TransactionClient,
  orgId: string,
  actor: CreditCheckoutActor,
) {
  const [org] = await tx.$queryRaw<
    Array<{ suspendedAt: Date | null }>
  >`SELECT "suspendedAt" FROM "Organization" WHERE id=${orgId} FOR UPDATE`;
  const [user] = await tx.$queryRaw<
    Array<{ clerkUserId: string }>
  >`SELECT "clerkUserId" FROM "User" WHERE id=${actor.actorId} FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM "Membership" WHERE "organizationId"=${orgId} AND "userId"=${actor.actorId} FOR SHARE`;
  const member = await tx.membership.findUnique({
    where: {
      organizationId_userId: { organizationId: orgId, userId: actor.actorId },
    },
  });
  if (
    !org ||
    org.suspendedAt ||
    !user ||
    user.clerkUserId !== actor.clerkSubject ||
    !member ||
    member.seatType !== "FULL" ||
    !["OWNER", "ADMIN"].includes(member.role)
  )
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Current workspace billing access is required.",
    });
  if (
    await tx.apiKey.findUnique({
      where: { serviceUserId: actor.actorId },
      select: { id: true },
    })
  )
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Sign in with a human account to purchase credits.",
    });
}

/** Immutable intent and issued-checkout audit records use the existing native
 * unique primary keys. Neither is a mutable credit balance or seat override.
 * Stripe idempotency keys recover response loss without a second checkout.
 */
export async function createReviewedCreditCheckout(
  db: PrismaClient,
  raw: z.infer<typeof creditCheckoutInput>,
  actor: CreditCheckoutActor,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ url: string }> {
  const input = creditCheckoutInput.parse(raw);
  if (!actor.clerkSubject || !creditPurchasesEnabled(input.organizationId, env))
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "AI-credit purchasing is not enabled for this workspace yet.",
    });
  const runtime = getCreditStripeRuntime(env)!;
  const id =
    "credit-intent-" +
    digest([
      input.organizationId,
      actor.actorId,
      actor.clerkSubject,
      input.requestId,
    ]);
  const intent = await db.$transaction(
    async (tx) => {
      await lockedAdmin(tx, input.organizationId, actor);
      const prior = await tx.auditLog.findUnique({ where: { id } });
      if (prior) {
        const p = purchaseSchema.parse(prior.metadata);
        if (
          prior.organizationId !== input.organizationId ||
          prior.actorId !== actor.actorId ||
          prior.entityType !== "CreditPurchase" ||
          p.actorClerkId !== actor.clerkSubject ||
          p.packKey !== input.packKey ||
          p.mode !== runtime.mode ||
          p.accountId !== runtime.accountId
        )
          throw new TRPCError({
            code: "CONFLICT",
            message: "The purchase request changed. Review a new purchase.",
          });
        return prior;
      }
      if (
        (await tx.auditLog.count({
          where: {
            organizationId: input.organizationId,
            actorId: actor.actorId,
            entityType: "CreditPurchase",
            createdAt: { gt: new Date(Date.now() - 3600000) },
          },
        })) >= 20
      )
        throw new TRPCError({ code: "TOO_MANY_REQUESTS" });
      const org = await tx.organization.findUniqueOrThrow({
        where: { id: input.organizationId },
        select: { name: true },
      });
      const pack = CREDIT_TOPUP_PACKS[input.packKey];
      const metadata = purchaseSchema.parse({
        kind: "credit-purchase-v1",
        requestId: input.requestId,
        actorClerkId: actor.clerkSubject,
        packKey: input.packKey,
        credits: pack.credits,
        priceUsdCents: pack.priceUsdCents,
        currency: "usd",
        mode: runtime.mode,
        accountId: runtime.accountId,
        organizationName: org.name,
        returnOrigin: env.VAETTIR_BILLING_RETURN_ORIGIN,
      });
      return tx.auditLog.create({
        data: {
          id,
          organizationId: input.organizationId,
          actorId: actor.actorId,
          entityType: "CreditPurchase",
          entityId: id,
          action: "CREATE",
          summary: `Reviewed one-time purchase of ${pack.credits} AI credits for USD ${(pack.priceUsdCents / 100).toFixed(2)}. No seat fees or subscription.`,
          metadata,
        },
      });
    },
    { timeout: 10000 },
  );
  const terms = purchaseSchema.parse(intent.metadata),
    issuedId = "credit-issued-" + digest(id);
  const prior = await db.auditLog.findUnique({ where: { id: issuedId } });
  if (prior) {
    const receipt = issuedSchema.parse(prior.metadata);
    if (
      prior.organizationId !== input.organizationId ||
      prior.actorId !== actor.actorId ||
      receipt.intentId !== id
    )
      throw new TRPCError({ code: "CONFLICT" });
    const session = await runtime.stripe.checkout.sessions.retrieve(
      receipt.sessionId,
    );
    if (session.status !== "open" || session.expires_at * 1000 <= Date.now())
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "This checkout is completed or expired. Refresh your credit balance before reviewing another purchase.",
      });
    if (
      session.metadata?.vaettirCreditIntentId !== id ||
      session.client_reference_id !== input.organizationId
    )
      throw new Error("Checkout identity changed.");
    await db.$transaction(
      (tx) => lockedAdmin(tx, input.organizationId, actor),
      { timeout: 10000 },
    );
    return { url: checkoutUrl(decryptToken(receipt.encryptedUrl, env)) };
  }
  // Stripe only retains idempotency keys for a limited period. An unresolved
  // old attempt is never automatically re-issued after that window.
  if (Date.now() - intent.createdAt.getTime() > 12 * 3600000)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "This purchase needs payment-status review before starting another attempt.",
    });
  if (runtime.mode === "live") {
    const account = await runtime.stripe.accounts.retrieve(null);
    if (account.id !== runtime.accountId || !account.charges_enabled)
      throw new Error("The configured payment account is unavailable.");
  }
  const org = await db.organization.findUniqueOrThrow({
    where: { id: input.organizationId },
    select: { stripeCustomerId: true },
  });
  let customerId = org.stripeCustomerId;
  if (customerId) {
    const customer = await runtime.stripe.customers.retrieve(customerId);
    if (
      customer.deleted ||
      customer.livemode !== (runtime.mode === "live") ||
      customer.metadata.vaettirOrganizationId !== input.organizationId
    )
      throw new Error(
        "The saved payment customer does not match this workspace.",
      );
  } else {
    const customer = await runtime.stripe.customers.create(
      {
        name: terms.organizationName,
        metadata: { vaettirOrganizationId: input.organizationId },
      },
      {
        idempotencyKey:
          "vaettir-credit-customer-" +
          digest([runtime.accountId, runtime.mode, input.organizationId]),
      },
    );
    customerId = customer.id;
    await db.$transaction(
      async (tx) => {
        await lockedAdmin(tx, input.organizationId, actor);
        const current = await tx.organization.findUniqueOrThrow({
          where: { id: input.organizationId },
          select: { stripeCustomerId: true },
        });
        if (
          current.stripeCustomerId &&
          current.stripeCustomerId !== customer.id
        )
          throw new TRPCError({
            code: "CONFLICT",
            message: "Payment customer changed. Refresh billing.",
          });
        if (!current.stripeCustomerId)
          await tx.organization.update({
            where: { id: input.organizationId },
            data: { stripeCustomerId: customer.id },
          });
      },
      { timeout: 10000 },
    );
  }
  // Recheck after all external awaits and before issuing the purchase.
  await db.$transaction((tx) => lockedAdmin(tx, input.organizationId, actor), {
    timeout: 10000,
  });
  const session = await runtime.stripe.checkout.sessions.create(
    {
      mode: "payment",
      // Pack prices were reviewed in USD, not adaptive local currencies.
      adaptive_pricing: { enabled: false },
      customer: customerId,
      client_reference_id: input.organizationId,
      integration_identifier:
        "vaettir-ai-credits-" + digest(id).slice(0, 8).replace(/[0-9]/g, "a"),
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: terms.priceUsdCents,
            product_data: {
              name: `${terms.credits.toLocaleString()} Vaettir AI credits`,
            },
          },
          quantity: 1,
        },
      ],
      success_url: terms.returnOrigin + "/settings/billing?topup=success",
      cancel_url: terms.returnOrigin + "/settings/billing?topup=cancelled",
      metadata: {
        vaettirOrganizationId: input.organizationId,
        vaettirCreditIntentId: id,
      },
      payment_intent_data: {
        metadata: {
          vaettirOrganizationId: input.organizationId,
          vaettirCreditIntentId: id,
        },
      },
    },
    { idempotencyKey: id },
  );
  if (!session.url)
    throw new Error("The payment provider did not return checkout.");
  const url = checkoutUrl(session.url);
  await db.$transaction(
    async (tx) => {
      await lockedAdmin(tx, input.organizationId, actor);
      const row = await tx.auditLog.findUnique({ where: { id: issuedId } });
      if (row) {
        const receipt = issuedSchema.parse(row.metadata);
        if (
          receipt.intentId !== id ||
          receipt.sessionId !== session.id ||
          receipt.customerId !== customerId
        )
          throw new TRPCError({ code: "CONFLICT" });
        return;
      }
      await tx.auditLog.create({
        data: {
          id: issuedId,
          organizationId: input.organizationId,
          actorId: actor.actorId,
          entityType: "CreditCheckout",
          entityId: id,
          action: "CREATE",
          summary:
            "Opened one-time AI-credit checkout. No credits granted until confirmed payment.",
          metadata: {
            kind: "credit-checkout-v1",
            intentId: id,
            sessionId: session.id,
            customerId: customerId!,
            encryptedUrl: { ...encryptToken(url, env) },
          },
        },
      });
    },
    { timeout: 10000 },
  );
  return { url };
}

/** Called only after verification of the exact raw Stripe webhook signature.
 * Retrieve current provider payment state. Immutable server-side purchase
 * terms, customer, amount, currency and mode must all agree before fulfillment.
 */
export async function handleCreditPaymentEvent(
  db: PrismaClient,
  event: Stripe.Event,
  runtime: CreditStripeRuntime,
): Promise<{ handled: boolean; reason?: string }> {
  if (
    event.type !== "checkout.session.completed" &&
    event.type !== "checkout.session.async_payment_succeeded" &&
    event.type !== "checkout.session.async_payment_failed"
  )
    return { handled: false, reason: "not a credit payment completion" };
  if (event.livemode !== (runtime.mode === "live") || event.account)
    return { handled: false, reason: "payment environment mismatch" };
  const reported = event.data.object as Stripe.Checkout.Session;
  // This merchant also serves other products. Do not fetch their checkout or
  // customer data merely because the shared account delivered an event here.
  if (
    !/^credit-intent-[a-f0-9]{64}$/.test(
      reported.metadata?.vaettirCreditIntentId ?? "",
    )
  )
    return { handled: false, reason: "not a Vaettir credit checkout" };
  if (!/^cs_(?:test|live)_[A-Za-z0-9]+$/.test(reported.id))
    return { handled: false, reason: "invalid checkout identity" };
  const session = await runtime.stripe.checkout.sessions.retrieve(reported.id);
  if (
    session.mode !== "payment" ||
    (session.payment_status !== "paid" &&
      event.type !== "checkout.session.async_payment_failed") ||
    session.livemode !== event.livemode
  )
    return { handled: false, reason: "payment not cleared" };
  const intentId = session.metadata?.vaettirCreditIntentId,
    orgId = session.metadata?.vaettirOrganizationId;
  if (!intentId || !/^credit-intent-[a-f0-9]{64}$/.test(intentId) || !orgId)
    return { handled: false, reason: "not a reviewed credit purchase" };
  const customerId =
    typeof session.customer === "string"
      ? session.customer
      : session.customer?.id;
  const paymentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id;
  if (
    !customerId ||
    !paymentId ||
    !/^pi_[A-Za-z0-9]+$/.test(paymentId) ||
    session.client_reference_id !== orgId
  )
    return { handled: false, reason: "payment binding incomplete" };
  return db.$transaction(
    async (tx) => {
      const [org] = await tx.$queryRaw<
        Array<{ stripeCustomerId: string | null }>
      >`SELECT "stripeCustomerId" FROM "Organization" WHERE id=${orgId} FOR UPDATE`;
      const intent = await tx.auditLog.findUnique({ where: { id: intentId } });
      if (
        !org ||
        org.stripeCustomerId !== customerId ||
        !intent ||
        intent.organizationId !== orgId ||
        intent.entityType !== "CreditPurchase"
      )
        throw new Error("Reviewed paid purchase could not be reconciled.");
      const terms = purchaseSchema.parse(intent.metadata);
      if (
        terms.mode !== runtime.mode ||
        terms.accountId !== runtime.accountId ||
        session.currency !== terms.currency ||
        session.amount_total !== terms.priceUsdCents ||
        session.amount_subtotal !== terms.priceUsdCents ||
        session.total_details?.amount_discount !== 0 ||
        session.total_details?.amount_tax !== 0
      )
        throw new Error(
          "Reviewed paid purchase terms could not be reconciled.",
        );
      if (session.payment_status !== "paid") {
        const failureId =
          "credit-failed-" +
          digest([runtime.accountId, runtime.mode, session.id]);
        const failed = await tx.auditLog.findUnique({
          where: { id: failureId },
        });
        const failure = {
          kind: "credit-payment-failed-v1",
          intentId,
          sessionId: session.id,
        };
        if (
          failed &&
          (failed.organizationId !== orgId ||
            digest(failed.metadata) !== digest(failure))
        )
          throw new Error("Failed payment identity changed.");
        if (!failed)
          await tx.auditLog.create({
            data: {
              id: failureId,
              organizationId: orgId,
              actorId: intent.actorId,
              entityType: "CreditPaymentFailure",
              entityId: intentId,
              action: "CREATE",
              summary:
                "Stripe reported a failed delayed payment. No credits granted and no plan change.",
              metadata: failure,
            },
          });
        return { handled: true };
      }
      const receiptId =
        "credit-payment-" +
        digest([runtime.accountId, runtime.mode, paymentId]);
      const expected = {
        kind: "credit-payment-v1",
        intentId,
        sessionId: session.id,
        paymentId,
        credits: terms.credits,
        priceUsdCents: terms.priceUsdCents,
        currency: terms.currency,
      };
      const receipt = await tx.auditLog.findUnique({
        where: { id: receiptId },
      });
      if (
        receipt &&
        (receipt.organizationId !== orgId ||
          digest(receipt.metadata) !== digest(expected))
      )
        throw new Error(
          "Payment identity is already bound to different purchase terms.",
        );
      const ledgerId =
        "credit-topup-" + digest([runtime.accountId, runtime.mode, intentId]);
      const prior = await tx.aiCreditTransaction.findUnique({
        where: { id: ledgerId },
      });
      if (prior) {
        if (
          !receipt ||
          prior.organizationId !== orgId ||
          prior.type !== "TOPUP" ||
          prior.amount !== terms.credits ||
          prior.description !==
            `Purchased ${terms.credits} AI credits (${session.id}).`
        )
          throw new Error("Credit settlement identity changed.");
        return { handled: true };
      }
      await tx.aiCreditTransaction.create({
        data: {
          id: ledgerId,
          organizationId: orgId,
          type: "TOPUP",
          amount: terms.credits,
          description: `Purchased ${terms.credits} AI credits (${session.id}).`,
        },
      });
      if (!receipt)
        await tx.auditLog.create({
          data: {
            id: receiptId,
            organizationId: orgId,
            actorId: intent.actorId,
            entityType: "CreditPayment",
            entityId: intentId,
            action: "CREATE",
            summary: `Confirmed payment and delivered ${terms.credits} AI credits exactly once. Seat pricing and plan unchanged.`,
            metadata: expected,
          },
        });
      return { handled: true };
    },
    { timeout: 10000 },
  );
}
