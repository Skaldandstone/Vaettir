import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import type Stripe from "stripe";
import { prisma } from "@vaettir/db";
import { assertOwnedTestDatabase } from "./testOnlyDatabaseSafety.js";
import { hardDeleteOrganization } from "./services/orgHardDelete.js";
const sdk = vi.hoisted(() => ({
  customersCreate: vi.fn(),
  customersRetrieve: vi.fn(),
  sessionsCreate: vi.fn(),
  sessionsRetrieve: vi.fn(),
  accountsRetrieve: vi.fn(),
  sessions: new Map<string, Record<string, unknown>>(),
  customers: new Map<string, Record<string, unknown>>(),
  requests: new Map<string, Record<string, unknown>>(),
}));
vi.mock("stripe", () => ({
  default: function FixtureStripe() {
    return {
      accounts: { retrieve: sdk.accountsRetrieve },
      customers: {
        create: sdk.customersCreate,
        retrieve: sdk.customersRetrieve,
      },
      checkout: {
        sessions: {
          create: sdk.sessionsCreate,
          retrieve: sdk.sessionsRetrieve,
        },
      },
    };
  },
}));
const {
  createReviewedCreditCheckout,
  handleCreditPaymentEvent,
  reviewedCreditCheckoutStatus,
} = await import("./services/creditCheckout.js");
const { getCreditStripeRuntime } =
  await import("./services/creditStripeConfig.js");
const tag = `credit-fixture-${randomUUID()}`;
const env = {
  NODE_ENV: "production",
  VAETTIR_STRIPE_CREDITS_LIVE_KEY: "rk_live_fixtureOnly",
  VAETTIR_STRIPE_CREDITS_WEBHOOK_SECRET: "whsec_fixtureOnly",
  VAETTIR_STRIPE_CREDITS_ACCOUNT_ID: "acct_fixtureOnly",
  VAETTIR_BILLING_RETURN_ORIGIN: "https://vaettir.skaldandstone.com",
  VAETTIR_LIVE_CREDIT_PURCHASES_ENABLED: "true",
  VAETTIR_LIVE_CREDIT_ORGANIZATIONS: "",
  PRODUCTION_SIGNAL_ENCRYPTION_KEY: Buffer.alloc(32, 4).toString("base64"),
};
let tierId: string;
const ownedFixtures: Array<{
  organizationId: string;
  actorId: string;
  slug: string;
}> = [];
async function fixture() {
  const suffix = randomUUID();
  const org = await prisma.organization.create({
    data: { name: tag, slug: `${tag}-${suffix}`, planTierId: tierId },
  });
  const user = await prisma.user.create({
    data: {
      email: `${suffix}@example.com`,
      clerkUserId: `synthetic-${suffix}`,
      memberships: {
        create: { organizationId: org.id, role: "OWNER", seatType: "FULL" },
      },
    },
  });
  env.VAETTIR_LIVE_CREDIT_ORGANIZATIONS = org.id;
  ownedFixtures.push({
    organizationId: org.id,
    actorId: user.id,
    slug: org.slug,
  });
  return {
    orgId: org.id,
    actor: { actorId: user.id, clerkSubject: user.clerkUserId },
    input: {
      organizationId: org.id,
      requestId: randomUUID(),
      packKey: "500" as const,
    },
  };
}
async function payment(
  f: Awaited<ReturnType<typeof fixture>>,
  kind = "checkout.session.completed",
) {
  const intent = await prisma.auditLog.findFirstOrThrow({
    where: { organizationId: f.orgId, entityType: "CreditPurchase" },
  });
  const session = [...sdk.sessions.values()].find(
    (s) =>
      (s.metadata as Record<string, string>).vaettirCreditIntentId ===
      intent.id,
  )!;
  return {
    event: {
      id: `evt_${randomUUID().replaceAll("-", "")}`,
      type: kind,
      livemode: true,
      data: { object: { id: session.id, metadata: session.metadata } },
    } as Stripe.Event,
    session,
  };
}
describe("native credit settlement with synthetic provider only", () => {
  beforeAll(async () => {
    assertOwnedTestDatabase(process.env.DATABASE_URL);
    tierId = (
      await prisma.planTier.create({
        data: {
          key: tag,
          name: "Synthetic free unlimited plan",
          sortOrder: 999,
          isPublic: false,
          minFullSeats: 0,
          maxFullSeats: null,
          maxReadOnlySeats: null,
          monthlyPricePerSeatCents: 0,
          includedAiCreditsPerMonth: 0,
        },
      })
    ).id;
    sdk.accountsRetrieve.mockResolvedValue({
      id: "acct_fixtureOnly",
      charges_enabled: true,
    });
    sdk.customersCreate.mockImplementation(async (params, options) => {
      const prior = sdk.requests.get(options.idempotencyKey);
      if (prior) return prior;
      const customer = {
        id: `cus_${randomUUID().replaceAll("-", "")}`,
        livemode: true,
        ...params,
      };
      sdk.customers.set(customer.id, customer);
      sdk.requests.set(options.idempotencyKey, customer);
      return customer;
    });
    sdk.customersRetrieve.mockImplementation(async (id) =>
      sdk.customers.get(id),
    );
    sdk.sessionsCreate.mockImplementation(async (params, options) => {
      const prior = sdk.requests.get(options.idempotencyKey);
      if (prior) return prior;
      const session = {
        ...params,
        id: `cs_live_${randomUUID().replaceAll("-", "")}`,
        url: "https://checkout.stripe.com/c/pay/synthetic",
        status: "open",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        livemode: true,
        payment_status: "unpaid",
        payment_intent: `pi_${randomUUID().replaceAll("-", "")}`,
        currency: "usd",
        amount_total: params.line_items[0].price_data.unit_amount,
        amount_subtotal: params.line_items[0].price_data.unit_amount,
        total_details: { amount_tax: 0, amount_discount: 0 },
      };
      sdk.sessions.set(session.id, session);
      sdk.requests.set(options.idempotencyKey, session);
      return session;
    });
    sdk.sessionsRetrieve.mockImplementation(async (id) => sdk.sessions.get(id));
  });
  afterAll(async () => {
    for (const fixture of ownedFixtures) {
      const current = await prisma.organization.findUnique({
        where: { id: fixture.organizationId },
        select: { slug: true },
      });
      if (
        !current ||
        current.slug !== fixture.slug ||
        !current.slug.startsWith(tag + "-")
      )
        throw Error("Credit fixture ownership mismatch");
      await hardDeleteOrganization(
        prisma,
        fixture.organizationId,
        fixture.actorId,
        "Owned synthetic credit-payment fixture teardown",
      );
    }
    if (tierId) {
      const tier = await prisma.planTier.findUniqueOrThrow({
        where: { id: tierId },
      });
      if (tier.key !== tag)
        throw Error("Credit fixture tier ownership mismatch");
      await prisma.planTier.delete({ where: { id: tierId } });
    }
    await prisma.$disconnect();
  });
  it("concurrent retries persist one reviewed intent and one checkout, with no grants or seat billing", async () => {
    const f = await fixture();
    const before = await prisma.organization.findUniqueOrThrow({
      where: { id: f.orgId },
      include: { planTier: true, memberships: true },
    });
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        createReviewedCreditCheckout(prisma, f.input, f.actor, env),
      ),
    );
    expect(new Set(results.map((r) => r.url)).size).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: { organizationId: f.orgId, entityType: "CreditPurchase" },
      }),
    ).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: { organizationId: f.orgId, entityType: "CreditCheckout" },
      }),
    ).toBe(1);
    expect(
      await prisma.aiCreditTransaction.count({
        where: { organizationId: f.orgId },
      }),
    ).toBe(0);
    const after = await prisma.organization.findUniqueOrThrow({
      where: { id: f.orgId },
      include: { planTier: true, memberships: true },
    });
    expect(after.planTier).toEqual(before.planTier);
    expect(after.memberships).toEqual(before.memberships);
    expect(after.stripeSubscriptionId).toBeNull();
    const { session } = await payment(f);
    expect(session.mode).toBe("payment");
    expect(session).not.toHaveProperty("subscription_data");
    expect(session).not.toHaveProperty("payment_method_types");
    const receipt = await prisma.auditLog.findFirstOrThrow({
      where: { organizationId: f.orgId, entityType: "CreditCheckout" },
    });
    expect(JSON.stringify(receipt.metadata)).not.toContain(
      "checkout.stripe.com",
    );
  });
  it("unpaid completion gives nothing; concurrent completed/async-success deliveries settle once", async () => {
    const f = await fixture();
    await createReviewedCreditCheckout(prisma, f.input, f.actor, env);
    const { event, session } = await payment(f);
    expect(
      (
        await handleCreditPaymentEvent(
          prisma,
          event,
          getCreditStripeRuntime(env)!,
        )
      ).handled,
    ).toBe(false);
    expect(
      await prisma.aiCreditTransaction.count({
        where: { organizationId: f.orgId },
      }),
    ).toBe(0);
    session.payment_status = "paid";
    session.status = "complete";
    await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        handleCreditPaymentEvent(
          prisma,
          {
            ...event,
            type:
              i % 2
                ? "checkout.session.async_payment_succeeded"
                : "checkout.session.completed",
          } as Stripe.Event,
          getCreditStripeRuntime(env)!,
        ),
      ),
    );
    const ledger = await prisma.aiCreditTransaction.findMany({
      where: { organizationId: f.orgId },
    });
    expect(ledger).toHaveLength(1);
    expect(ledger[0].amount).toBe(500);
    expect(ledger[0].type).toBe("TOPUP");
    expect(
      await prisma.auditLog.count({
        where: { organizationId: f.orgId, entityType: "CreditPayment" },
      }),
    ).toBe(1);
    expect(
      await reviewedCreditCheckoutStatus(prisma, f.input, f.actor, env),
    ).toEqual({ status: "DELIVERED", credits: 500 });
    await expect(
      createReviewedCreditCheckout(prisma, f.input, f.actor, env),
    ).rejects.toThrow(/completed or expired/);
    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: f.orgId },
      include: { planTier: true },
    });
    expect(org.planTier.monthlyPricePerSeatCents).toBe(0);
    expect(org.planTier.maxFullSeats).toBeNull();
    expect(org.planTier.includedAiCreditsPerMonth).toBe(0);
    expect(org.stripeSubscriptionId).toBeNull();
  });
  it.each(["amount", "currency", "customer", "account"])(
    "refuses paid %s mismatch without ledger mutation",
    async (field) => {
      const f = await fixture();
      await createReviewedCreditCheckout(prisma, f.input, f.actor, env);
      const { event, session } = await payment(f);
      session.payment_status = "paid";
      if (field === "amount") session.amount_total = 1;
      if (field === "currency") session.currency = "eur";
      if (field === "customer") session.customer = "cus_other";
      const runtime = getCreditStripeRuntime(env)!;
      if (field === "account") runtime.accountId = "acct_other";
      await expect(
        handleCreditPaymentEvent(prisma, event, runtime),
      ).rejects.toThrow(/reconciled/);
      expect(
        await prisma.aiCreditTransaction.count({
          where: { organizationId: f.orgId },
        }),
      ).toBe(0);
    },
  );
  it.each(["clerk", "readOnly", "revoked", "suspended"])(
    "rechecks current %s authorization before provider writes",
    async (kind) => {
      const f = await fixture();
      const calls = sdk.sessionsCreate.mock.calls.length;
      if (kind === "clerk")
        await prisma.user.update({
          where: { id: f.actor.actorId },
          data: { clerkUserId: `changed-${randomUUID()}` },
        });
      if (kind === "readOnly")
        await prisma.membership.update({
          where: {
            organizationId_userId: {
              organizationId: f.orgId,
              userId: f.actor.actorId,
            },
          },
          data: { seatType: "READ_ONLY" },
        });
      if (kind === "revoked")
        await prisma.membership.update({
          where: {
            organizationId_userId: {
              organizationId: f.orgId,
              userId: f.actor.actorId,
            },
          },
          data: { role: "VIEWER" },
        });
      if (kind === "suspended")
        await prisma.organization.update({
          where: { id: f.orgId },
          data: { suspendedAt: new Date() },
        });
      await expect(
        createReviewedCreditCheckout(prisma, f.input, f.actor, env),
      ).rejects.toThrow(/Current workspace/);
      expect(sdk.sessionsCreate.mock.calls).toHaveLength(calls);
    },
  );
  it("reuses the original intent after provider response loss and rejects changed pack terms", async () => {
    const f = await fixture();
    sdk.sessionsCreate.mockImplementationOnce(async () => {
      throw Error("Synthetic response loss");
    });
    await expect(
      createReviewedCreditCheckout(prisma, f.input, f.actor, env),
    ).rejects.toThrow(/response loss/);
    await createReviewedCreditCheckout(prisma, f.input, f.actor, env);
    expect(
      await prisma.auditLog.count({
        where: { organizationId: f.orgId, entityType: "CreditPurchase" },
      }),
    ).toBe(1);
    await expect(
      createReviewedCreditCheckout(
        prisma,
        { ...f.input, packKey: "2000" },
        f.actor,
        env,
      ),
    ).rejects.toThrow(/request changed/);
  });
  it("rolls the ledger back when its settlement receipt cannot commit, then recovers exactly once", async () => {
    const f = await fixture();
    await createReviewedCreditCheckout(prisma, f.input, f.actor, env);
    const { event, session } = await payment(f);
    session.payment_status = "paid";
    const name = "credit_fault_" + randomUUID().replaceAll("-", "");
    if (!/^[a-z0-9_]+$/.test(name) || !/^[a-z0-9]+$/.test(f.orgId))
      throw Error("Synthetic fault scope refused");
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION "${name}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."organizationId"='${f.orgId}' AND NEW."entityType"='CreditPayment' THEN RAISE EXCEPTION 'synthetic settlement failure'; END IF; RETURN NEW; END $$`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER "${name}" BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION "${name}"()`,
    );
    try {
      await expect(
        handleCreditPaymentEvent(prisma, event, getCreditStripeRuntime(env)!),
      ).rejects.toThrow();
      expect(
        await prisma.aiCreditTransaction.count({
          where: { organizationId: f.orgId },
        }),
      ).toBe(0);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER "${name}" ON "AuditLog"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION "${name}"()`);
    }
    expect(
      (
        await handleCreditPaymentEvent(
          prisma,
          event,
          getCreditStripeRuntime(env)!,
        )
      ).handled,
    ).toBe(true);
    expect(
      (
        await handleCreditPaymentEvent(
          prisma,
          event,
          getCreditStripeRuntime(env)!,
        )
      ).handled,
    ).toBe(true);
    expect(
      await prisma.aiCreditTransaction.count({
        where: { organizationId: f.orgId },
      }),
    ).toBe(1);
  });
  it("records delayed-payment failure without granting credits and handles later paid delivery independently of the sales switch", async () => {
    const f = await fixture();
    await createReviewedCreditCheckout(prisma, f.input, f.actor, env);
    const { event, session } = await payment(
      f,
      "checkout.session.async_payment_failed",
    );
    session.status = "complete";
    expect(
      (
        await handleCreditPaymentEvent(
          prisma,
          event,
          getCreditStripeRuntime(env)!,
        )
      ).handled,
    ).toBe(true);
    expect(
      (
        await handleCreditPaymentEvent(
          prisma,
          event,
          getCreditStripeRuntime(env)!,
        )
      ).handled,
    ).toBe(true);
    expect(
      await prisma.aiCreditTransaction.count({
        where: { organizationId: f.orgId },
      }),
    ).toBe(0);
    expect(
      await prisma.auditLog.count({
        where: { organizationId: f.orgId, entityType: "CreditPaymentFailure" },
      }),
    ).toBe(1);
    expect(
      (await reviewedCreditCheckoutStatus(prisma, f.input, f.actor, env))
        .status,
    ).toBe("FAILED");
    const stopped = { ...env, VAETTIR_LIVE_CREDIT_PURCHASES_ENABLED: "false" };
    await expect(
      createReviewedCreditCheckout(prisma, f.input, f.actor, stopped),
    ).rejects.toThrow(/not enabled/);
    session.payment_status = "paid";
    expect(
      (
        await handleCreditPaymentEvent(
          prisma,
          {
            ...event,
            type: "checkout.session.async_payment_succeeded",
          } as Stripe.Event,
          getCreditStripeRuntime(stopped)!,
        )
      ).handled,
    ).toBe(true);
    expect(
      (await reviewedCreditCheckoutStatus(prisma, f.input, f.actor, stopped))
        .status,
    ).toBe("DELIVERED");
  });
  it("does not fetch other products' checkout data from this shared merchant", async () => {
    const before = sdk.sessionsRetrieve.mock.calls.length;
    expect(
      (
        await handleCreditPaymentEvent(
          prisma,
          {
            type: "checkout.session.completed",
            livemode: true,
            data: { object: { id: "cs_live_otherproduct", metadata: {} } },
          } as Stripe.Event,
          getCreditStripeRuntime(env)!,
        )
      ).handled,
    ).toBe(false);
    expect(sdk.sessionsRetrieve.mock.calls).toHaveLength(before);
  });
  it("rejects authorization revoked during customer creation before issuing checkout", async () => {
    const f = await fixture();
    const calls = sdk.sessionsCreate.mock.calls.length;
    const original = sdk.customersCreate.getMockImplementation()!;
    sdk.customersCreate.mockImplementationOnce(async (...args) => {
      const customer = await original(...args);
      await prisma.membership.update({
        where: {
          organizationId_userId: {
            organizationId: f.orgId,
            userId: f.actor.actorId,
          },
        },
        data: { role: "VIEWER" },
      });
      return customer;
    });
    await expect(
      createReviewedCreditCheckout(prisma, f.input, f.actor, env),
    ).rejects.toThrow(/Current workspace/);
    expect(sdk.sessionsCreate.mock.calls).toHaveLength(calls);
    expect(
      await prisma.aiCreditTransaction.count({
        where: { organizationId: f.orgId },
      }),
    ).toBe(0);
  });
});
