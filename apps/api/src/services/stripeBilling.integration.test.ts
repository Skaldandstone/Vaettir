import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, type OrgRole, type SeatType } from "@vaettir/db";
import { appRouter } from "../router.js";
import { createBillingRouter } from "../routers/billing.js";
import { stripeWebhookPlugin } from "../routes/stripeWebhook.js";
import {
  billingStatus,
  createCheckout,
  createPortal,
  enrollBillingTest,
  processBillingEvent,
} from "./stripeBilling.js";
import { STRIPE_API_VERSION, type BillingRuntime } from "./stripeConfig.js";
import { hardDeleteOrganization } from "./orgHardDelete.js";

let orgId: string,
  ownerId: string,
  accountId: string,
  customerId: string,
  subId: string;
let users: string[];
let runtime: BillingRuntime;
let price: Stripe.Price,
  customer: Stripe.Customer,
  subscription: Stripe.Subscription;
const storedAccount = () =>
  prisma.stripeBillingAccount.findUniqueOrThrow({ where: { id: accountId } });
const org = () =>
  prisma.organization.findUniqueOrThrow({
    where: { id: orgId },
    include: { planTier: true },
  });
const scope = () => ({
  product: "vaettir",
  environment: runtime.config.environment,
  sandbox: runtime.config.sandbox,
  organizationId: orgId,
  billingAccountId: accountId,
});
async function addUser(role?: OrgRole, seatType: SeatType = "FULL") {
  const suffix = randomUUID();
  const user = await prisma.user.create({
    data: { clerkUserId: suffix, email: `${suffix}@example.com` },
  });
  users.push(user.id);
  if (role)
    await prisma.membership.create({
      data: { organizationId: orgId, userId: user.id, role, seatType },
    });
  return user.id;
}
async function context(userId: string | null = ownerId) {
  return {
    prisma,
    user: userId
      ? await prisma.user.findUniqueOrThrow({
          where: { id: userId },
          include: { memberships: true },
        })
      : null,
    staff: null,
  };
}
const checkout = (fullSeats = 4) =>
  createCheckout(prisma, runtime, ownerId, {
    organizationId: orgId,
    planKey: "team",
    fullSeats,
  });
function event(
  type = "customer.subscription.updated",
  eventId = `evt_${randomUUID()}`,
): Stripe.Event {
  return {
    id: eventId,
    object: "event",
    api_version: STRIPE_API_VERSION,
    created: 12345,
    livemode: false,
    type,
    data: { object: { id: subId, customer: customerId } },
    pending_webhooks: 1,
    request: null,
  } as Stripe.Event;
}
async function bindSubscription() {
  await checkout();
  subscription.metadata = {
    ...scope(),
    checkoutKey: (await storedAccount()).checkoutKey!,
  };
}
function barrier() {
  let release!: () => void, started!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  return {
    release,
    entered,
    wait: async () => {
      started();
      await held;
      return subscription;
    },
  };
}
beforeEach(async () => {
  users = [];
  const suffix = randomUUID();
  const free = await prisma.planTier.findUniqueOrThrow({
    where: { key: "free" },
  });
  orgId = (
    await prisma.organization.create({
      data: { name: suffix, slug: suffix, planTierId: free.id },
    })
  ).id;
  ownerId = await addUser("OWNER");
  customerId = `cus_${suffix}`;
  subId = `sub_${suffix}`;
  // A real SDK verifies signatures, but every API method is stubbed. No network.
  const stripe = new Stripe(["sk", "test", "localFixtureOnly"].join("_"), {
    apiVersion: STRIPE_API_VERSION,
  });
  runtime = {
    stripe,
    webhookSecret: ["whsec", "localFixtureOnly"].join("_"),
    ensureReady: async () => {},
    config: {
      mode: "test",
      environment: "test-isolated",
      sandbox: "vaettir-sandbox-fixture",
      accountId: "acct_fixture",
      origin: "http://localhost:3000",
      portalConfiguration: "bpc_fixture",
      offers: [
        {
          planKey: "team",
          priceId: "price_fixture",
          productId: "prod_fixture",
          currency: "usd",
          amountCents: 3900,
        },
      ],
    },
  };
  await enrollBillingTest(
    prisma,
    runtime,
    orgId,
    "test-staff",
    "Isolated test fixture",
  );
  accountId = (
    await prisma.stripeBillingAccount.findUniqueOrThrow({
      where: { organizationId: orgId },
    })
  ).id;
  customer = {
    id: customerId,
    object: "customer",
    livemode: false,
    metadata: scope(),
  } as Stripe.Customer;
  price = {
    id: "price_fixture",
    active: true,
    livemode: false,
    type: "recurring",
    recurring: { usage_type: "licensed", interval: "month", interval_count: 1 },
    billing_scheme: "per_unit",
    transform_quantity: null,
    custom_unit_amount: null,
    unit_amount: 3900,
    currency: "usd",
    product: {
      id: "prod_fixture",
      active: true,
      livemode: false,
      metadata: {
        product: "vaettir",
        environment: runtime.config.environment,
        sandbox: runtime.config.sandbox,
        planKey: "team",
      },
    },
  } as Stripe.Price;
  subscription = {
    id: subId,
    customer: customerId,
    livemode: false,
    metadata: scope(),
    status: "active",
    items: { data: [{ price, quantity: 4 }], has_more: false },
    pending_update: null,
    pause_collection: null,
    latest_invoice: {
      status: "paid",
      livemode: false,
      customer: customerId,
      parent: { subscription_details: { subscription: subId } },
    },
  } as Stripe.Subscription;
  vi.spyOn(stripe.prices, "retrieve").mockImplementation(
    async () => price as never,
  );
  vi.spyOn(stripe.customers, "create").mockImplementation(
    async () => customer as never,
  );
  vi.spyOn(stripe.customers, "retrieve").mockImplementation(
    async () => customer as never,
  );
  vi.spyOn(stripe.subscriptions, "retrieve").mockImplementation(
    async () => subscription as never,
  );
  vi.spyOn(stripe.subscriptions, "list").mockImplementation(
    async () => ({ data: [subscription], has_more: false }) as never,
  );
  vi.spyOn(stripe.checkout.sessions, "create").mockImplementation(
    async () =>
      ({
        id: `cs_${accountId}`,
        customer: customerId,
        mode: "subscription",
        livemode: false,
        url: "https://checkout.stripe.com/c/pay/test_fixture",
      }) as never,
  );
  vi.spyOn(stripe.billingPortal.configurations, "retrieve").mockImplementation(
    async () =>
      ({
        id: "bpc_fixture",
        active: true,
        livemode: false,
        metadata: {
          product: "vaettir",
          environment: runtime.config.environment,
          sandbox: runtime.config.sandbox,
        },
        login_page: { enabled: false },
        features: {
          subscription_update: { enabled: false },
          subscription_cancel: { enabled: true, mode: "at_period_end" },
        },
      }) as never,
  );
  vi.spyOn(stripe.billingPortal.sessions, "create").mockImplementation(
    async () =>
      ({ url: "https://billing.stripe.com/p/session/test_fixture" }) as never,
  );
});
afterEach(async () => {
  vi.restoreAllMocks();
  if (orgId) {
    // Only this isolated fixture's receipts/account, never customer data.
    await prisma.stripeBillingEvent.deleteMany({ where: { accountId } });
    await prisma.stripeBillingAccount.deleteMany({
      where: { organizationId: orgId },
    });
    users.push(
      ...(
        await prisma.apiKey.findMany({ where: { organizationId: orgId } })
      ).map((key) => key.serviceUserId),
    );
    await hardDeleteOrganization(
      prisma,
      orgId,
      ownerId,
      "Billing fixture cleanup",
    );
    await prisma.organizationDeletionLog.deleteMany({
      where: { organizationId: orgId },
    });
  }
  await prisma.user.deleteMany({ where: { id: { in: users } } });
});

describe("test billing authorization and checkout", () => {
  it("verifies the exact sandbox runtime before any provider mutation", async () => {
    runtime.ensureReady = vi.fn(async () => {
      throw new Error("wrong sandbox");
    });
    await expect(checkout()).rejects.toThrow(/wrong sandbox/);
    expect(runtime.stripe.prices.retrieve).not.toHaveBeenCalled();
    expect(runtime.stripe.customers.create).not.toHaveBeenCalled();
    expect(runtime.stripe.checkout.sessions.create).not.toHaveBeenCalled();
    expect(
      await prisma.stripeBillingAccount.findUnique({
        where: { organizationId: orgId },
      }),
    ).not.toBeNull();
  });
  it("is disabled by default, denies anonymous and disallows arbitrary fields", async () => {
    const router = createBillingRouter(() => null);
    const caller = router.createCaller(await context());
    expect((await caller.status({ organizationId: orgId })).enabled).toBe(
      false,
    );
    await expect(
      caller.checkout({ organizationId: orgId, planKey: "team", fullSeats: 4 }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(
      router
        .createCaller(await context(null))
        .status({ organizationId: orgId }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      caller.portal({
        organizationId: orgId,
        customerId: "cus_other",
      } as never),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(runtime.stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });
  it("enrollment is staff-only, auditable, idempotent and environment-bound", async () => {
    const caller = createBillingRouter(() => runtime).createCaller(
      await context(),
    );
    await expect(
      caller.enrollTest({ organizationId: orgId, reason: "not staff" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await enrollBillingTest(
      prisma,
      runtime,
      orgId,
      "different-actor",
      "Retry enrollment",
    );
    expect((await storedAccount()).createdBy).toBe("test-staff");
    runtime.config.environment = "test-other";
    await expect(
      enrollBillingTest(prisma, runtime, orgId, "staff", "Wrong environment"),
    ).rejects.toThrow(/environment/);
  });
  it.each([
    ["VIEWER", "READ_ONLY"],
    ["ADMIN", "READ_ONLY"],
    ["EDITOR", "FULL"],
    [undefined, "FULL"],
  ] as const)("denies %s/%s", async (role, seat) => {
    const actor = await addUser(role, seat);
    await expect(
      createCheckout(prisma, runtime, actor, {
        organizationId: orgId,
        planKey: "team",
        fullSeats: 4,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(runtime.stripe.prices.retrieve).not.toHaveBeenCalled();
  });
  it("rejects stale membership, suspension, beta and service accounts", async () => {
    const staleCaller = createBillingRouter(() => runtime).createCaller(
      await context(),
    );
    await prisma.membership.deleteMany({
      where: { organizationId: orgId, userId: ownerId },
    });
    await expect(
      staleCaller.status({ organizationId: orgId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await prisma.membership.create({
      data: {
        organizationId: orgId,
        userId: ownerId,
        role: "OWNER",
        seatType: "FULL",
      },
    });
    await prisma.organization.update({
      where: { id: orgId },
      data: { suspendedAt: new Date() },
    });
    await expect(checkout()).rejects.toMatchObject({ code: "FORBIDDEN" });
    const beta = await prisma.planTier.findUniqueOrThrow({
      where: { key: "private-beta" },
    });
    await prisma.organization.update({
      where: { id: orgId },
      data: { suspendedAt: null, planTierId: beta.id },
    });
    await expect(checkout()).rejects.toThrow(/Private beta/);
    const free = await prisma.planTier.findUniqueOrThrow({
      where: { key: "free" },
    });
    await prisma.organization.update({
      where: { id: orgId },
      data: { planTierId: free.id },
    });
    const key = await appRouter.createCaller(await context()).apiKeys.create({
      organizationId: orgId,
      name: "billing-service",
      role: "ADMIN",
    });
    const record = await prisma.apiKey.findUniqueOrThrow({
      where: { id: key.id },
    });
    await expect(
      createPortal(prisma, runtime, orgId, record.serviceUserId),
    ).rejects.toThrow(/human/);
  });
  it("reuses persisted keys and exact Checkout params under concurrent retries", async () => {
    const responses = await Promise.all([checkout(), checkout(), checkout()]);
    expect(new Set(responses.map((result) => result.url)).size).toBe(1);
    const calls = vi.mocked(runtime.stripe.checkout.sessions.create).mock.calls;
    expect(calls).toHaveLength(3);
    for (const call of calls) expect(call).toEqual(calls[0]);
    const params = calls[0][0]!;
    expect(params).toMatchObject({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: "price_fixture", quantity: 4 }],
      automatic_tax: { enabled: false },
    });
    expect(params.integration_identifier).toMatch(/^vaettir-hosted-[a-z]{8}$/);
    expect(params).not.toHaveProperty("payment_method_types");
    expect((await org()).planTier.key).toBe("free");
    expect(
      await prisma.aiCreditTransaction.count({
        where: { organizationId: orgId },
      }),
    ).toBe(0);
  });
  it("requires reconciliation after ambiguous expiry and refuses changed parameters", async () => {
    await checkout();
    await expect(checkout(5)).rejects.toThrow(/Another checkout/);
    await prisma.stripeBillingAccount.update({
      where: { id: accountId },
      data: { checkoutStartedAt: new Date(Date.now() - 3600_001) },
    });
    await expect(checkout()).rejects.toThrow(/reconcile/);
    expect(runtime.stripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
  });
  it("bounds seats and counts invitations before Checkout", async () => {
    await expect(checkout(3)).rejects.toThrow(/seats/);
    await expect(checkout(51)).rejects.toThrow(/seats/);
    await prisma.invitation.createMany({
      data: Array.from({ length: 4 }, () => ({
        organizationId: orgId,
        email: `${randomUUID()}@example.com`,
        role: "EDITOR",
        seatType: "FULL",
        invitedById: ownerId,
        expiresAt: new Date(Date.now() + 100000),
      })),
    });
    await expect(checkout(4)).rejects.toThrow(/seats/);
    expect(runtime.stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });
  it.each(["foreign-product", "live", "wrong-currency", "metered", "inactive"])(
    "rejects %s price",
    async (variant) => {
      if (variant === "foreign-product")
        (price.product as Stripe.Product).metadata.product = "studio";
      if (variant === "live") price.livemode = true;
      if (variant === "wrong-currency") price.currency = "eur";
      if (variant === "metered") price.recurring!.usage_type = "metered";
      if (variant === "inactive") price.active = false;
      await expect(checkout()).rejects.toThrow(/approved/);
      expect(runtime.stripe.customers.create).not.toHaveBeenCalled();
    },
  );
  it("rejects foreign customer and rechecks membership after provider reads", async () => {
    customer.metadata.product = "studio";
    await expect(checkout()).rejects.toThrow(/customer/);
    customer.metadata = scope();
    vi.mocked(runtime.stripe.prices.retrieve).mockImplementationOnce(
      async () => {
        await prisma.membership.deleteMany({
          where: { organizationId: orgId, userId: ownerId },
        });
        return price as never;
      },
    );
    await expect(checkout()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(runtime.stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });
  it("sanitizes provider errors in the public router", async () => {
    vi.mocked(runtime.stripe.prices.retrieve).mockRejectedValueOnce(
      new Error("PRIVATE_PROVIDER_PAYLOAD"),
    );
    await expect(
      createBillingRouter(() => runtime)
        .createCaller(await context())
        .checkout({ organizationId: orgId, planKey: "team", fullSeats: 4 }),
    ).rejects.toMatchObject({
      message: "Billing is unavailable. Retry later or contact support.",
      cause: undefined,
    });
  });
  it("requires a dedicated safe portal and refuses another product's subscriptions", async () => {
    await bindSubscription();
    expect((await createPortal(prisma, runtime, orgId, ownerId)).url).toMatch(
      /^https:\/\/billing.stripe.com/,
    );
    expect(runtime.stripe.billingPortal.sessions.create).toHaveBeenCalledWith({
      customer: customerId,
      configuration: "bpc_fixture",
      return_url: "http://localhost:3000/settings/billing",
    });
    subscription.metadata.product = "studio";
    await expect(createPortal(prisma, runtime, orgId, ownerId)).rejects.toThrow(
      /isolated/,
    );
    subscription.metadata = scope();
    vi.mocked(
      runtime.stripe.billingPortal.configurations.retrieve,
    ).mockResolvedValueOnce({
      id: "bpc_fixture",
      active: true,
      livemode: false,
      metadata: {
        product: "vaettir",
        environment: runtime.config.environment,
        sandbox: runtime.config.sandbox,
      },
      login_page: { enabled: true },
      features: {
        subscription_update: { enabled: false },
        subscription_cancel: { enabled: false },
      },
    } as never);
    await expect(createPortal(prisma, runtime, orgId, ownerId)).rejects.toThrow(
      /Portal/,
    );
    expect(runtime.stripe.billingPortal.sessions.create).toHaveBeenCalledTimes(
      1,
    );
  });
});

describe("verified subscription reconciliation", () => {
  it("atomically grants exactly purchased seats once and blocks every manual plan writer", async () => {
    await bindSubscription();
    const delivered = event();
    expect(
      (await processBillingEvent(prisma, runtime, delivered)).outcome,
    ).toBe("test_entitlement_granted");
    expect(
      (await processBillingEvent(prisma, runtime, delivered)).outcome,
    ).toBe("duplicate");
    expect(
      await prisma.stripeBillingEvent.count({ where: { accountId } }),
    ).toBe(1);
    expect(await org()).toMatchObject({
      billingFullSeats: 4,
      planTier: { key: "team" },
    });
    const tenant = appRouter.createCaller(await context());
    expect(
      await tenant.organization.seatUsage({ organizationId: orgId }),
    ).toMatchObject({ fullSeatsIncluded: 4, billingManaged: true });
    const business = await prisma.planTier.findUniqueOrThrow({
      where: { key: "business" },
    });
    await expect(
      tenant.organization.changePlanTier({
        organizationId: orgId,
        planTierId: business.id,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const staff = await addUser();
    await prisma.user.update({
      where: { id: staff },
      data: { email: `${randomUUID()}@skaldandstone.com` },
    });
    await expect(
      appRouter.createCaller(await context(staff)).admin.adjustPlanTier({
        organizationId: orgId,
        planTierId: business.id,
        reason: "test",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      appRouter
        .createCaller({ ...(await context(null)), staff: { actor: "test" } })
        .staff.setPlanTier({ organizationId: orgId, planTierKey: "business" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      hardDeleteOrganization(prisma, orgId, ownerId, "Must not orphan billing"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const invitations = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        tenant.organization.inviteMember({
          organizationId: orgId,
          email: `${randomUUID()}@example.com`,
          role: "EDITOR",
          seatType: "FULL",
        }),
      ),
    );
    expect(
      invitations.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(3);
    await expect(
      tenant.apiKeys.create({
        organizationId: orgId,
        name: "over-cap",
        role: "EDITOR",
      }),
    ).rejects.toThrow();
    expect(
      await prisma.aiCreditTransaction.count({
        where: { organizationId: orgId },
      }),
    ).toBe(0);
  });
  it.each([
    "unpaid",
    "past_due",
    "trialing",
    "foreign-invoice",
    "foreign-product",
    "live-price",
    "unknown-price",
    "invalid-quantity",
  ])("does not grant for %s", async (variant) => {
    await bindSubscription();
    if (variant === "unpaid")
      (subscription.latest_invoice as Stripe.Invoice).status = "open";
    if (variant === "past_due" || variant === "trialing")
      subscription.status = variant;
    if (variant === "foreign-invoice")
      (subscription.latest_invoice as Stripe.Invoice).customer = "cus_other";
    if (variant === "foreign-product")
      (price.product as Stripe.Product).metadata.product = "studio";
    if (variant === "live-price") price.livemode = true;
    if (variant === "unknown-price") price.id = "price_unknown";
    if (variant === "invalid-quantity")
      subscription.items.data[0].quantity = 999;
    await processBillingEvent(prisma, runtime, event());
    expect((await org()).planTier.key).toBe("free");
    expect((await storedAccount()).entitledFullSeats).toBe(0);
  });
  it("ignores foreign customer, environment, Connect and live events", async () => {
    await bindSubscription();
    for (const override of [
      { livemode: true },
      { account: "acct_other" },
      { context: "other" },
      { data: { object: { id: subId, customer: "cus_other" } } },
    ]) {
      expect(
        (
          await processBillingEvent(prisma, runtime, {
            ...event(),
            ...override,
          } as Stripe.Event)
        ).outcome,
      ).toMatch(/^ignored/);
    }
    runtime.config.environment = "test-other";
    expect((await processBillingEvent(prisma, runtime, event())).outcome).toBe(
      "ignored_customer",
    );
    expect(runtime.stripe.subscriptions.retrieve).not.toHaveBeenCalled();
  });
  it("ignores a foreign subscription binding and preserves beta", async () => {
    await checkout();
    expect((await processBillingEvent(prisma, runtime, event())).outcome).toBe(
      "ignored_binding",
    );
    await bindSubscription();
    const beta = await prisma.planTier.findUniqueOrThrow({
      where: { key: "private-beta" },
    });
    await prisma.organization.update({
      where: { id: orgId },
      data: { planTierId: beta.id },
    });
    await processBillingEvent(prisma, runtime, event());
    expect((await org()).planTier.key).toBe("private-beta");
  });
  it("serializes simultaneous events and retries the loser without duplicate grants", async () => {
    await bindSubscription();
    const gate = barrier();
    vi.mocked(runtime.stripe.subscriptions.retrieve).mockImplementationOnce(
      gate.wait as never,
    );
    const first = processBillingEvent(prisma, runtime, event());
    await gate.entered;
    const second = event();
    await expect(processBillingEvent(prisma, runtime, second)).rejects.toThrow(
      /busy/,
    );
    gate.release();
    await first;
    await processBillingEvent(prisma, runtime, second);
    expect(
      await prisma.stripeBillingEvent.count({ where: { accountId } }),
    ).toBe(2);
    expect((await storedAccount()).entitledFullSeats).toBe(4);
  });
  it("uses current state for delayed and same-second events, never event.created order", async () => {
    await bindSubscription();
    const early = event();
    await processBillingEvent(prisma, runtime, early);
    subscription.status = "canceled";
    await processBillingEvent(
      prisma,
      runtime,
      event("customer.subscription.deleted"),
    );
    await processBillingEvent(prisma, runtime, {
      ...event(),
      created: early.created - 1000,
    });
    expect((await org()).planTier.key).toBe("free");
    expect((await storedAccount()).entitledFullSeats).toBe(0);
  });
  it("does not clear a new checkout when a tracked old cancellation is retried", async () => {
    await bindSubscription();
    await processBillingEvent(prisma, runtime, event());
    subscription.status = "canceled";
    await processBillingEvent(prisma, runtime, event());
    await checkout();
    const next = (await storedAccount()).checkoutKey;
    expect(next).not.toBe(subscription.metadata.checkoutKey);
    await processBillingEvent(prisma, runtime, event());
    expect((await storedAccount()).checkoutKey).toBe(next);
  });
  it("cannot let an expired worker commit or clear a replacement lease", async () => {
    await bindSubscription();
    const gate = barrier();
    vi.mocked(runtime.stripe.subscriptions.retrieve).mockImplementationOnce(
      gate.wait as never,
    );
    const work = processBillingEvent(prisma, runtime, event());
    const rejected = expect(work).rejects.toThrow(/lease/);
    await gate.entered;
    await prisma.stripeBillingAccount.update({
      where: { id: accountId },
      data: {
        syncToken: "replacement",
        syncUntil: new Date(Date.now() + 60000),
      },
    });
    gate.release();
    await rejected;
    expect((await storedAccount()).syncToken).toBe("replacement");
    expect((await org()).planTier.key).toBe("free");
    expect(
      await prisma.stripeBillingEvent.count({ where: { accountId } }),
    ).toBe(0);
  });
  it("rolls back entitlements when receipt persistence fails, then allows retry", async () => {
    await bindSubscription();
    const gate = barrier();
    const delivered = event();
    vi.mocked(runtime.stripe.subscriptions.retrieve).mockImplementationOnce(
      gate.wait as never,
    );
    const work = processBillingEvent(prisma, runtime, delivered);
    const rejected = expect(work).rejects.toThrow();
    await gate.entered;
    await prisma.stripeBillingEvent.create({
      data: {
        accountId,
        environment: runtime.config.environment,
        eventId: delivered.id,
        eventType: delivered.type,
        outcome: "fixture-conflict",
      },
    });
    gate.release();
    await rejected;
    expect((await org()).planTier.key).toBe("free");
    expect((await storedAccount()).syncToken).toBeNull();
    await prisma.stripeBillingEvent.deleteMany({
      where: { accountId, eventId: delivered.id },
    });
    await processBillingEvent(prisma, runtime, delivered);
    expect((await org()).planTier.key).toBe("team");
  });
  it("routes invoice and Checkout events but Checkout completion alone proves no payment", async () => {
    await bindSubscription();
    (subscription.latest_invoice as Stripe.Invoice).status = "open";
    await processBillingEvent(prisma, runtime, {
      ...event("checkout.session.completed"),
      data: {
        object: {
          mode: "subscription",
          customer: customerId,
          subscription: subId,
        },
      },
    } as Stripe.Event);
    expect((await storedAccount()).entitledFullSeats).toBe(0);
    (subscription.latest_invoice as Stripe.Invoice).status = "paid";
    await processBillingEvent(prisma, runtime, {
      ...event("invoice.paid"),
      data: { object: subscription.latest_invoice },
    } as Stripe.Event);
    expect((await storedAccount()).entitledFullSeats).toBe(4);
    expect((await billingStatus(prisma, runtime, orgId, ownerId)).status).toBe(
      "active",
    );
  });
});

describe("real SDK raw-body webhook boundary", () => {
  it("verifies exact bytes, timestamps, rejects tampering and oversized bodies, keeps JSON parser scoped", async () => {
    await bindSubscription();
    const server = Fastify();
    server.post("/json", async (req) => ({
      objectBody: typeof req.body === "object" && !Buffer.isBuffer(req.body),
    }));
    await server.register(stripeWebhookPlugin(prisma, () => runtime));
    await server.register(
      stripeWebhookPlugin(prisma, () => runtime),
      { prefix: "/api" },
    );
    try {
      const payload = JSON.stringify(event(), null, 2);
      const signature = runtime.stripe.webhooks.generateTestHeaderString({
        payload,
        secret: runtime.webhookSecret,
      });
      const send = (
        body: string,
        header = signature,
        url = "/api/webhooks/stripe",
      ) =>
        server.inject({
          method: "POST",
          url,
          headers: {
            "content-type": "application/json",
            "stripe-signature": header,
          },
          payload: body,
        });
      expect((await send(payload)).statusCode).toBe(200);
      expect((await send(payload)).statusCode).toBe(200);
      expect(
        await prisma.stripeBillingEvent.count({ where: { accountId } }),
      ).toBe(1);
      expect((await send(payload + " ")).statusCode).toBe(400);
      expect(
        (await send(payload, "invalid", "/webhooks/stripe")).statusCode,
      ).toBe(400);
      const old = runtime.stripe.webhooks.generateTestHeaderString({
        payload,
        secret: runtime.webhookSecret,
        timestamp: Math.floor(Date.now() / 1000) - 601,
      });
      expect((await send(payload, old)).statusCode).toBe(400);
      expect((await send("x".repeat(256 * 1024 + 1))).statusCode).toBe(413);
      expect(
        (
          await server.inject({
            method: "POST",
            url: "/json",
            headers: { "content-type": "application/json" },
            payload: "{}",
          })
        ).json(),
      ).toEqual({ objectBody: true });
    } finally {
      await server.close();
    }
  });
  it("returns retryable failures without payload leakage and disabled mode never verifies", async () => {
    await bindSubscription();
    const server = Fastify();
    await server.register(stripeWebhookPlugin(prisma, () => runtime));
    await server.register(
      stripeWebhookPlugin(prisma, () => null),
      { prefix: "/disabled" },
    );
    try {
      vi.mocked(runtime.stripe.subscriptions.retrieve).mockRejectedValueOnce(
        new Error("PRIVATE_PROVIDER_PAYLOAD"),
      );
      const payload = JSON.stringify(event());
      const signature = runtime.stripe.webhooks.generateTestHeaderString({
        payload,
        secret: runtime.webhookSecret,
      });
      const result = await server.inject({
        method: "POST",
        url: "/webhooks/stripe",
        headers: {
          "content-type": "application/json",
          "stripe-signature": signature,
        },
        payload,
      });
      expect(result.statusCode).toBe(503);
      expect(result.body).not.toContain("PRIVATE_PROVIDER_PAYLOAD");
      expect(
        await prisma.stripeBillingEvent.count({ where: { accountId } }),
      ).toBe(0);
      expect(
        (
          await server.inject({
            method: "POST",
            url: "/disabled/webhooks/stripe",
            headers: { "content-type": "application/json" },
            payload: "{}",
          })
        ).statusCode,
      ).toBe(503);
    } finally {
      await server.close();
    }
  });
});
