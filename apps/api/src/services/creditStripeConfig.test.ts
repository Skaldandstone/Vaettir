import { describe, it, expect } from "vitest";
import {
  creditPurchasesEnabled,
  getCreditStripeRuntime,
} from "./creditStripeConfig.js";
import { getBillingAvailability } from "./stripeConfig.js";
const live = {
  NODE_ENV: "production",
  VAETTIR_STRIPE_CREDITS_LIVE_KEY: "rk_live_fixtureOnly",
  VAETTIR_STRIPE_CREDITS_WEBHOOK_SECRET: "whsec_fixtureOnly",
  VAETTIR_STRIPE_CREDITS_ACCOUNT_ID: "acct_fixtureOnly",
  VAETTIR_BILLING_RETURN_ORIGIN: "https://vaettir.skaldandstone.com",
  VAETTIR_LIVE_CREDIT_PURCHASES_ENABLED: "true",
  VAETTIR_LIVE_CREDIT_ORGANIZATIONS: "synthetic",
  PRODUCTION_SIGNAL_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString("base64"),
};
describe("separate credit-only payment controls", () => {
  it("accepts underscore-separated restricted credentials without weakening the live-only prefix", () => {
    expect(
      creditPurchasesEnabled("synthetic", {
        ...live,
        VAETTIR_STRIPE_CREDITS_LIVE_KEY: "rk_live_fixture_only_with_segments",
      }),
    ).toBe(true);
  });
  it("enables explicitly selected workspace without enabling subscriptions", () => {
    expect(creditPurchasesEnabled("synthetic", live)).toBe(true);
    expect(creditPurchasesEnabled("outsider", live)).toBe(false);
    expect(getBillingAvailability(live).purchasesEnabled).toBe(false);
  });
  it("turns off new sales without turning off owed settlement", () => {
    const env = { ...live, VAETTIR_LIVE_CREDIT_PURCHASES_ENABLED: "false" };
    expect(creditPurchasesEnabled("synthetic", env)).toBe(false);
    expect(getCreditStripeRuntime(env)?.mode).toBe("live");
  });
  it.each([
    "VAETTIR_STRIPE_CREDITS_LIVE_KEY",
    "VAETTIR_STRIPE_CREDITS_WEBHOOK_SECRET",
    "VAETTIR_STRIPE_CREDITS_ACCOUNT_ID",
    "PRODUCTION_SIGNAL_ENCRYPTION_KEY",
  ])("refuses missing %s", (name) => {
    expect(creditPurchasesEnabled("synthetic", { ...live, [name]: "" })).toBe(
      false,
    );
  });
  it.each([
    "http://vaettir.skaldandstone.com",
    "https://vaettir.skaldandstone.com/",
    "https://other.example",
    "https://user@vaettir.skaldandstone.com",
  ])("refuses unrelated/unsafe return origin %s", (origin) => {
    expect(
      creditPurchasesEnabled("synthetic", {
        ...live,
        VAETTIR_BILLING_RETURN_ORIGIN: origin,
      }),
    ).toBe(false);
  });
  it("rejects general, test or cross-environment keys", () => {
    for (const key of ["sk_live_fixtureOnly", "rk_test_fixtureOnly"])
      expect(() =>
        getCreditStripeRuntime({
          ...live,
          VAETTIR_STRIPE_CREDITS_LIVE_KEY: key,
        }),
      ).toThrow();
    expect(() =>
      getCreditStripeRuntime({ ...live, NODE_ENV: "test" }),
    ).toThrow();
  });
});
