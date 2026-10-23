import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@vaettir/db";
import { getCreditStripeRuntime } from "./creditStripeConfig.js";
import { handleCreditPaymentEvent } from "./creditCheckout.js";

// Register inside the existing raw-body Stripe scope, never JSON reserialized.
export async function registerCreditWebhookRoute(
  instance: FastifyInstance,
  db: PrismaClient,
) {
  instance.post(
    "/webhooks/stripe/credits",
    { bodyLimit: 262144 },
    async (req, reply) => {
      try {
        const runtime = getCreditStripeRuntime();
        if (!runtime)
          return reply
            .code(503)
            .send({ error: "Credit payment settlement is unavailable." });
        const signature = req.headers["stripe-signature"];
        if (typeof signature !== "string")
          return reply.code(400).send({ error: "Missing webhook signature." });
        let event;
        try {
          event = runtime.stripe.webhooks.constructEvent(
            req.body as Buffer,
            signature,
            runtime.webhookSecret,
          );
        } catch {
          return reply.code(400).send({ error: "Invalid webhook signature." });
        }
        return reply.send(await handleCreditPaymentEvent(db, event, runtime));
      } catch {
        req.log.error(
          { code: "CREDIT_SETTLEMENT_UNCONFIRMED" },
          "Credit settlement requires review; provider delivery will retry.",
        );
        return reply
          .code(503)
          .send({ error: "Credit settlement could not be confirmed." });
      }
    },
  );
}
