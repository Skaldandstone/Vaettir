import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@vaettir/db";
import { getBillingRuntime, type BillingRuntime } from "../services/stripeConfig.js";
import { processBillingEvent } from "../services/stripeBilling.js";

export function stripeWebhookPlugin(db: PrismaClient, runtimeProvider: () => BillingRuntime | null = getBillingRuntime) {
  return async (instance: FastifyInstance) => {
    // Encapsulated parser: signature verification receives the exact bytes.
    instance.addContentTypeParser("application/json", { parseAs: "buffer", bodyLimit: 256 * 1024 }, (_req, body, done) => done(null, body));
    instance.post("/webhooks/stripe", { bodyLimit: 256 * 1024 }, async (req, reply) => {
      let runtime: BillingRuntime | null;
      try { runtime = runtimeProvider(); } catch { return reply.code(503).send({ error: "Billing is unavailable" }); }
      if (!runtime) return reply.code(503).send({ error: "Billing is disabled" });
      const signature = req.headers["stripe-signature"];
      if (!Buffer.isBuffer(req.body) || typeof signature !== "string") return reply.code(400).send({ error: "Invalid webhook signature" });
      let event;
      try { event = runtime.stripe.webhooks.constructEvent(req.body, signature, runtime.webhookSecret); }
      catch { return reply.code(400).send({ error: "Invalid webhook signature" }); }
      try { await processBillingEvent(db, runtime, event); return reply.send({ received: true }); }
      catch {
        // Constant message only. No raw event, signature, Stripe error, or PII.
        req.log.warn("Billing webhook reconciliation failed; delivery must retry");
        return reply.code(503).send({ error: "Billing reconciliation unavailable; retry delivery" });
      }
    });
  };
}
