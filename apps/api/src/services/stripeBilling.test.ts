import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@vaettir/db";

// Mocks the whole `stripe` package so `new Stripe(...)` (inside
// getStripeRuntime) returns this fake client instead of a real SDK
// instance -- no network call ever happens, but the real
// createBillingCheckoutSession/etc. code paths run unmodified.
const stripeMocks = {
  customersCreate: vi.fn(),
  checkoutSessionsCreate: vi.fn(),
  billingPortalSessionsCreate: vi.fn(),
  subscriptionsRetrieve: vi.fn(),
  subscriptionItemsUpdate: vi.fn(),
  webhooksConstructEvent: vi.fn(),
};

// Arrow functions can't be used as constructors ("is not a constructor"),
// and `new Stripe(...)` in stripeConfig.ts needs the mocked default export
// to be a real constructible function.
function FakeStripe() {
  return {
    customers: { create: stripeMocks.customersCreate },
    checkout: { sessions: { create: stripeMocks.checkoutSessionsCreate } },
    billingPortal: { sessions: { create: stripeMocks.billingPortalSessionsCreate } },
    subscriptions: { retrieve: stripeMocks.subscriptionsRetrieve },
    subscriptionItems: { update: stripeMocks.subscriptionItemsUpdate },
    webhooks: { constructEvent: stripeMocks.webhooksConstructEvent },
  };
}

vi.mock("stripe", () => ({ default: FakeStripe }));

const {
  createBillingCheckoutSession,
  createBillingPortalSession,
  createCreditTopupCheckoutSession,
  syncBillingSeatQuantity,
  handleStripeWebhookEvent,
  BillingNotConfiguredError,
} = await import("./stripeBilling.js");

const TEST_ENV = { STRIPE_SECRET_KEY: "sk_test_abc", STRIPE_WEBHOOK_SECRET: "whsec_abc", VAETTIR_BILLING_RETURN_ORIGIN: "https://app.test" };

function fakePrisma(overrides: Record<string, unknown> = {}) {
  return {
    organization: {
      findUniqueOrThrow: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    planTier: {
      findUniqueOrThrow: vi.fn(),
      findUnique: vi.fn(),
    },
    membership: {
      count: vi.fn(),
    },
    aiCreditTransaction: {
      create: vi.fn(),
    },
    ...overrides,
  } as unknown as PrismaClient & {
    organization: { findUniqueOrThrow: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
    planTier: { findUniqueOrThrow: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn> };
    membership: { count: ReturnType<typeof vi.fn> };
    aiCreditTransaction: { create: ReturnType<typeof vi.fn> };
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createBillingCheckoutSession", () => {
  it("throws BillingNotConfiguredError when Stripe isn't configured", async () => {
    const prisma = fakePrisma();
    await expect(createBillingCheckoutSession(prisma, "org_1", "tier_1", {})).rejects.toThrow(BillingNotConfiguredError);
  });

  it("throws when the target tier has no Stripe price configured", async () => {
    const prisma = fakePrisma();
    prisma.organization.findUniqueOrThrow.mockResolvedValue({ id: "org_1", name: "Acme", stripeCustomerId: null });
    prisma.planTier.findUniqueOrThrow.mockResolvedValue({ id: "tier_1", key: "team", stripePriceId: null });
    prisma.membership.count.mockResolvedValue(3);
    await expect(createBillingCheckoutSession(prisma, "org_1", "tier_1", TEST_ENV)).rejects.toThrow(/no Stripe price/);
  });

  it("creates a new Stripe customer when the org has none, then a checkout session at the real seat count", async () => {
    const prisma = fakePrisma();
    prisma.organization.findUniqueOrThrow.mockResolvedValue({ id: "org_1", name: "Acme", stripeCustomerId: null });
    prisma.planTier.findUniqueOrThrow.mockResolvedValue({ id: "tier_1", key: "team", stripePriceId: "price_abc" });
    prisma.membership.count.mockResolvedValue(4);
    stripeMocks.customersCreate.mockResolvedValue({ id: "cus_new" });
    stripeMocks.checkoutSessionsCreate.mockResolvedValue({ url: "https://checkout.stripe.com/session/xyz" });

    const result = await createBillingCheckoutSession(prisma, "org_1", "tier_1", TEST_ENV);

    expect(result.url).toBe("https://checkout.stripe.com/session/xyz");
    expect(prisma.organization.update).toHaveBeenCalledWith({ where: { id: "org_1" }, data: { stripeCustomerId: "cus_new" } });
    expect(stripeMocks.checkoutSessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ customer: "cus_new", line_items: [{ price: "price_abc", quantity: 4 }] }),
    );
  });

  it("reuses an existing Stripe customer instead of creating a new one", async () => {
    const prisma = fakePrisma();
    prisma.organization.findUniqueOrThrow.mockResolvedValue({ id: "org_1", name: "Acme", stripeCustomerId: "cus_existing" });
    prisma.planTier.findUniqueOrThrow.mockResolvedValue({ id: "tier_1", key: "team", stripePriceId: "price_abc" });
    prisma.membership.count.mockResolvedValue(1);
    stripeMocks.checkoutSessionsCreate.mockResolvedValue({ url: "https://checkout.stripe.com/session/xyz" });

    await createBillingCheckoutSession(prisma, "org_1", "tier_1", TEST_ENV);

    expect(stripeMocks.customersCreate).not.toHaveBeenCalled();
    expect(prisma.organization.update).not.toHaveBeenCalled();
  });
});

describe("createCreditTopupCheckoutSession", () => {
  it("throws BillingNotConfiguredError when Stripe isn't configured", async () => {
    const prisma = fakePrisma();
    await expect(createCreditTopupCheckoutSession(prisma, "org_1", "500", {})).rejects.toThrow(BillingNotConfiguredError);
  });

  it("creates a one-time payment-mode checkout session for the chosen pack", async () => {
    const prisma = fakePrisma();
    prisma.organization.findUniqueOrThrow.mockResolvedValue({ id: "org_1", name: "Acme", stripeCustomerId: "cus_existing" });
    stripeMocks.checkoutSessionsCreate.mockResolvedValue({ url: "https://checkout.stripe.com/session/topup" });

    const result = await createCreditTopupCheckoutSession(prisma, "org_1", "2000", TEST_ENV);

    expect(result.url).toBe("https://checkout.stripe.com/session/topup");
    expect(stripeMocks.checkoutSessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "payment",
        customer: "cus_existing",
        metadata: { vaettirOrganizationId: "org_1", vaettirTopupCredits: "2000" },
      }),
    );
    const call = stripeMocks.checkoutSessionsCreate.mock.calls[0][0];
    expect(call.line_items[0].price_data.unit_amount).toBe(3500);
  });
});

describe("createBillingPortalSession", () => {
  it("throws when the org has no Stripe customer yet", async () => {
    const prisma = fakePrisma();
    prisma.organization.findUniqueOrThrow.mockResolvedValue({ id: "org_1", stripeCustomerId: null });
    await expect(createBillingPortalSession(prisma, "org_1", TEST_ENV)).rejects.toThrow(/no billing account/);
  });

  it("returns a real portal session URL for an org with a Stripe customer", async () => {
    const prisma = fakePrisma();
    prisma.organization.findUniqueOrThrow.mockResolvedValue({ id: "org_1", stripeCustomerId: "cus_existing" });
    stripeMocks.billingPortalSessionsCreate.mockResolvedValue({ url: "https://billing.stripe.com/session/xyz" });

    const result = await createBillingPortalSession(prisma, "org_1", TEST_ENV);
    expect(result.url).toBe("https://billing.stripe.com/session/xyz");
    expect(stripeMocks.billingPortalSessionsCreate).toHaveBeenCalledWith({ customer: "cus_existing", return_url: "https://app.test/settings/billing" });
  });
});

describe("syncBillingSeatQuantity", () => {
  it("is a no-op when billing isn't configured", async () => {
    const prisma = fakePrisma();
    await syncBillingSeatQuantity(prisma, "org_1", {});
    expect(prisma.organization.findUnique).not.toHaveBeenCalled();
  });

  it("is a no-op when the org has no active subscription", async () => {
    const prisma = fakePrisma();
    prisma.organization.findUnique.mockResolvedValue({ stripeSubscriptionId: null });
    await syncBillingSeatQuantity(prisma, "org_1", TEST_ENV);
    expect(stripeMocks.subscriptionsRetrieve).not.toHaveBeenCalled();
  });

  it("updates the Stripe subscription item quantity when it differs from the real seat count", async () => {
    const prisma = fakePrisma();
    prisma.organization.findUnique.mockResolvedValue({ stripeSubscriptionId: "sub_1" });
    prisma.membership.count.mockResolvedValue(7);
    stripeMocks.subscriptionsRetrieve.mockResolvedValue({ items: { data: [{ id: "si_1", quantity: 4 }] } });

    await syncBillingSeatQuantity(prisma, "org_1", TEST_ENV);
    expect(stripeMocks.subscriptionItemsUpdate).toHaveBeenCalledWith("si_1", { quantity: 7 });
  });

  it("does not call Stripe again when the quantity already matches", async () => {
    const prisma = fakePrisma();
    prisma.organization.findUnique.mockResolvedValue({ stripeSubscriptionId: "sub_1" });
    prisma.membership.count.mockResolvedValue(4);
    stripeMocks.subscriptionsRetrieve.mockResolvedValue({ items: { data: [{ id: "si_1", quantity: 4 }] } });

    await syncBillingSeatQuantity(prisma, "org_1", TEST_ENV);
    expect(stripeMocks.subscriptionItemsUpdate).not.toHaveBeenCalled();
  });
});

describe("handleStripeWebhookEvent", () => {
  it("checkout.session.completed sets the subscription id and plan tier from metadata", async () => {
    const prisma = fakePrisma();
    const event = {
      type: "checkout.session.completed",
      data: { object: { metadata: { vaettirOrganizationId: "org_1", vaettirPlanTierId: "tier_1" }, subscription: "sub_new" } },
    } as unknown as Parameters<typeof handleStripeWebhookEvent>[1];

    const result = await handleStripeWebhookEvent(prisma, event);
    expect(result.handled).toBe(true);
    expect(prisma.organization.update).toHaveBeenCalledWith({ where: { id: "org_1" }, data: { stripeSubscriptionId: "sub_new", planTierId: "tier_1" } });
  });

  it("checkout.session.completed with topup metadata creates a TOPUP transaction instead of updating the org's plan", async () => {
    const prisma = fakePrisma();
    const event = {
      type: "checkout.session.completed",
      data: { object: { id: "cs_1", metadata: { vaettirOrganizationId: "org_1", vaettirTopupCredits: "2000" } } },
    } as unknown as Parameters<typeof handleStripeWebhookEvent>[1];

    const result = await handleStripeWebhookEvent(prisma, event);
    expect(result.handled).toBe(true);
    expect(prisma.aiCreditTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ organizationId: "org_1", type: "TOPUP", amount: 2000 }),
    });
    expect(prisma.organization.update).not.toHaveBeenCalled();
  });

  it("checkout.session.completed reports unhandled when metadata is missing", async () => {
    const prisma = fakePrisma();
    const event = { type: "checkout.session.completed", data: { object: { metadata: {} } } } as unknown as Parameters<typeof handleStripeWebhookEvent>[1];
    const result = await handleStripeWebhookEvent(prisma, event);
    expect(result.handled).toBe(false);
    expect(prisma.organization.update).not.toHaveBeenCalled();
  });

  it("customer.subscription.deleted reverts the org to the Free tier", async () => {
    const prisma = fakePrisma();
    prisma.planTier.findUnique.mockResolvedValue({ id: "tier_free", key: "free" });
    const event = {
      type: "customer.subscription.deleted",
      data: { object: { metadata: { vaettirOrganizationId: "org_1" } } },
    } as unknown as Parameters<typeof handleStripeWebhookEvent>[1];

    const result = await handleStripeWebhookEvent(prisma, event);
    expect(result.handled).toBe(true);
    expect(prisma.organization.update).toHaveBeenCalledWith({ where: { id: "org_1" }, data: { stripeSubscriptionId: null, planTierId: "tier_free" } });
  });

  it("ignores an event type this pass doesn't act on", async () => {
    const prisma = fakePrisma();
    const event = { type: "invoice.paid", data: { object: {} } } as unknown as Parameters<typeof handleStripeWebhookEvent>[1];
    const result = await handleStripeWebhookEvent(prisma, event);
    expect(result.handled).toBe(false);
    expect(result.reason).toMatch(/ignored event type/);
  });
});
