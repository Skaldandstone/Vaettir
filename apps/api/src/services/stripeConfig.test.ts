import { describe, expect, it } from "vitest";
import { readBillingConfig } from "./stripeConfig.js";

const configured = () => ({ NODE_ENV: "test", VAETTIR_BILLING_MODE: "test", DATABASE_URL: "postgresql://tester@127.0.0.1:55439/vaettir_billing_test?connection_limit=5",
  VAETTIR_STRIPE_ENVIRONMENT: "test-isolated", VAETTIR_BILLING_RETURN_ORIGIN: "http://localhost:3000", VAETTIR_STRIPE_PORTAL_CONFIGURATION: "bpc_example",
  VAETTIR_STRIPE_OFFERS_JSON: JSON.stringify([{ planKey: "team", priceId: "price_example", productId: "prod_example", currency: "usd" }]) });
describe("disabled-by-default billing configuration", () => {
  it("does not require or read secrets while disabled", () => {
    expect(readBillingConfig({})).toBeNull();
    expect(readBillingConfig({ VAETTIR_BILLING_MODE: "disabled", DATABASE_URL: "invalid" })).toBeNull();
  });
  it("accepts isolated test config without inventing an amount", () => {
    expect(readBillingConfig(configured())?.offers[0]).toEqual({ planKey: "team", priceId: "price_example", productId: "prod_example", currency: "usd" });
  });
  it.each([
    { VAETTIR_BILLING_MODE: "live" }, { NODE_ENV: "production" }, { DATABASE_URL: "postgresql://tester@remote/vaettir_billing_test" },
    { DATABASE_URL: "postgresql://tester@localhost/vaettir" }, { DATABASE_URL: "postgresql://tester@localhost/vaettir_billing_test?schema=production" },
    { VAETTIR_STRIPE_ENVIRONMENT: "live-main" }, { VAETTIR_BILLING_RETURN_ORIGIN: "https://evil.example" },
    { VAETTIR_BILLING_RETURN_ORIGIN: "http://localhost:3000/redirect?next=https://evil.example" }, { VAETTIR_STRIPE_PORTAL_CONFIGURATION: "" },
    { VAETTIR_STRIPE_OFFERS_JSON: '[{"planKey":"private-beta","priceId":"price_example","productId":"prod_example","currency":"usd"}]' },
    { VAETTIR_STRIPE_OFFERS_JSON: '[{"planKey":"team","priceId":"price_example","productId":"prod_example","currency":"usd","amount":100}]' },
  ])("fails closed for unsafe config %j", override => expect(() => readBillingConfig({ ...configured(), ...override })).toThrow());
  it("rejects duplicate price bindings", () => {
    const env = configured(); const offer = JSON.parse(env.VAETTIR_STRIPE_OFFERS_JSON)[0];
    env.VAETTIR_STRIPE_OFFERS_JSON = JSON.stringify([offer, { ...offer, planKey: "business", productId: "prod_other" }]);
    expect(() => readBillingConfig(env)).toThrow();
  });
});
