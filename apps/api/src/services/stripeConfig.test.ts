import { describe, it, expect } from "vitest";
import { getStripeRuntime } from "./stripeConfig.js";

describe("getStripeRuntime", () => {
  it("returns null when neither env var is set (billing not configured, not an error)", () => {
    expect(getStripeRuntime({})).toBeNull();
  });

  it("throws in production even with a valid test key", () => {
    expect(() =>
      getStripeRuntime({
        NODE_ENV: "production",
        STRIPE_SECRET_KEY: "sk_test_abc123",
        STRIPE_WEBHOOK_SECRET: "whsec_abc123",
      }),
    ).toThrow(/test-mode-only/i);
  });

  it("rejects a live-mode key even outside production", () => {
    expect(() =>
      getStripeRuntime({ STRIPE_SECRET_KEY: "sk_live_abc123", STRIPE_WEBHOOK_SECRET: "whsec_abc123" }),
    ).toThrow(/test-mode key/i);
  });

  it("rejects a malformed webhook secret", () => {
    expect(() =>
      getStripeRuntime({ STRIPE_SECRET_KEY: "sk_test_abc123", STRIPE_WEBHOOK_SECRET: "not-a-real-secret" }),
    ).toThrow(/webhook signing secret/i);
  });

  it("accepts a valid test-mode key + webhook secret and returns a real Stripe client", () => {
    const runtime = getStripeRuntime({ STRIPE_SECRET_KEY: "sk_test_abc123", STRIPE_WEBHOOK_SECRET: "whsec_abc123" });
    expect(runtime).not.toBeNull();
    expect(runtime?.webhookSecret).toBe("whsec_abc123");
    expect(runtime?.stripe).toBeDefined();
  });

  it("also accepts a restricted (rk_test_) key", () => {
    const runtime = getStripeRuntime({ STRIPE_SECRET_KEY: "rk_test_abc123", STRIPE_WEBHOOK_SECRET: "whsec_abc123" });
    expect(runtime).not.toBeNull();
  });
});
