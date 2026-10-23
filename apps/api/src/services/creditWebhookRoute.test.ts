import Fastify from "fastify";
import Stripe from "stripe";
import type { PrismaClient } from "@vaettir/db";
import { describe, it, expect, vi, afterEach } from "vitest";
const mocks = vi.hoisted(() => ({ runtime: vi.fn(), settle: vi.fn() }));
vi.mock("./creditStripeConfig.js", () => ({
  getCreditStripeRuntime: mocks.runtime,
}));
vi.mock("./creditCheckout.js", () => ({
  handleCreditPaymentEvent: mocks.settle,
}));
const { registerCreditWebhookRoute } = await import("./creditWebhookRoute.js");
const secret = "whsec_syntheticOnly";
const stripe = new Stripe("rk_test_syntheticOnly");
const payload =
  ' { "id": "evt_synthetic", "type": "checkout.session.completed", "data": {"object":{"id":"cs_test_synthetic"}} } ';
const signature = () =>
  stripe.webhooks.generateTestHeaderString({ payload, secret });
const applications: ReturnType<typeof Fastify>[] = [];
async function app(prefix = "") {
  const server = Fastify({ logger: false });
  applications.push(server);
  await server.register(
    async (child) => {
      child.addContentTypeParser(
        "application/json",
        { parseAs: "buffer" },
        (_req, body, done) => done(null, body),
      );
      await registerCreditWebhookRoute(child, {} as PrismaClient);
    },
    { prefix },
  );
  return server;
}
afterEach(async () => {
  for (const server of applications.splice(0)) await server.close();
  vi.resetAllMocks();
});
describe("credit webhook HTTP boundary", () => {
  it.each(["", "/api"])(
    "verifies exact signed bytes under %s",
    async (prefix) => {
      mocks.runtime.mockReturnValue({
        stripe,
        webhookSecret: secret,
        mode: "sandbox",
        accountId: "sandbox",
      });
      mocks.settle.mockResolvedValue({ handled: true });
      const server = await app(prefix);
      const response = await server.inject({
        method: "POST",
        url: prefix + "/webhooks/stripe/credits",
        headers: {
          "content-type": "application/json",
          "stripe-signature": signature(),
        },
        payload,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ handled: true });
      expect(mocks.settle).toHaveBeenCalledOnce();
    },
  );
  it("refuses missing or tampered signatures before settlement", async () => {
    mocks.runtime.mockReturnValue({
      stripe,
      webhookSecret: secret,
      mode: "sandbox",
      accountId: "sandbox",
    });
    const server = await app();
    for (const headers of [
      { "content-type": "application/json" },
      { "content-type": "application/json", "stripe-signature": signature() },
    ]) {
      const response = await server.inject({
        method: "POST",
        url: "/webhooks/stripe/credits",
        headers,
        payload: payload + " ",
      });
      expect(response.statusCode).toBe(400);
      expect(response.body).not.toContain(secret);
    }
    expect(mocks.settle).not.toHaveBeenCalled();
  });
  it("preserves provider retries on configuration or native settlement failure, without leaking errors", async () => {
    const server = await app();
    mocks.runtime.mockReturnValue(null);
    expect(
      (
        await server.inject({
          method: "POST",
          url: "/webhooks/stripe/credits",
          headers: { "content-type": "application/json" },
          payload,
        })
      ).statusCode,
    ).toBe(503);
    mocks.runtime.mockReturnValue({
      stripe,
      webhookSecret: secret,
      mode: "sandbox",
      accountId: "sandbox",
    });
    mocks.settle.mockRejectedValue(Error("private-provider-error-" + secret));
    const response = await server.inject({
      method: "POST",
      url: "/webhooks/stripe/credits",
      headers: {
        "content-type": "application/json",
        "stripe-signature": signature(),
      },
      payload,
    });
    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain(secret);
    expect(response.body).not.toContain("private-provider");
  });
  it("rejects oversized deliveries before processing", async () => {
    const server = await app();
    const response = await server.inject({
      method: "POST",
      url: "/webhooks/stripe/credits",
      headers: { "content-type": "application/json" },
      payload: " ".repeat(262145),
    });
    expect(response.statusCode).toBe(413);
    expect(mocks.settle).not.toHaveBeenCalled();
  });
});
