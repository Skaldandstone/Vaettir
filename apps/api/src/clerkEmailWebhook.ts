import { verifyWebhook } from "@clerk/backend/webhooks";
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@vaettir/db";
import {
  createPrismaClerkEmailDeliveryRepository,
  createSesTransactionalEmailSender,
  deliverClerkEmail,
  type ClerkEmailCreatedEvent,
  type TransactionalEmailSender,
} from "./services/clerkEmailDelivery.js";

let cachedSender: TransactionalEmailSender | null = null;

function configuredSender() {
  if (cachedSender) return cachedSender;
  const region = process.env.AWS_REGION?.trim();
  const from = process.env.TRANSACTIONAL_EMAIL_FROM?.trim();
  if (!region || !from) return null;
  cachedSender = createSesTransactionalEmailSender({
    region,
    from,
    replyTo: process.env.TRANSACTIONAL_EMAIL_REPLY_TO?.trim(),
    configurationSet: process.env.SES_CONFIGURATION_SET?.trim(),
  });
  return cachedSender;
}

function webhookRequest(rawBody: Buffer, headers: Record<string, unknown>) {
  const requestHeaders = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value === "string") requestHeaders.set(name, value);
    else if (Array.isArray(value)) {
      for (const item of value) requestHeaders.append(name, String(item));
    }
  }
  return new Request("https://vaettir.invalid/webhooks/clerk/email", {
    method: "POST",
    headers: requestHeaders,
    body: rawBody.toString("utf8"),
  });
}

export async function registerClerkEmailWebhookRoute(
  instance: FastifyInstance,
  prisma: PrismaClient,
) {
  instance.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (_req, body, done) => done(null, body),
  );

  instance.post("/webhooks/clerk/email", async (req, reply) => {
    const signingSecret = process.env.CLERK_WEBHOOK_SIGNING_SECRET?.trim();
    if (!signingSecret) {
      return reply
        .code(503)
        .send({ error: "Clerk email delivery is not configured" });
    }

    let event;
    try {
      event = await verifyWebhook(
        webhookRequest(
          req.body as Buffer,
          req.headers,
        ) as unknown as Parameters<typeof verifyWebhook>[0],
        { signingSecret },
      );
    } catch {
      return reply.code(401).send({ error: "invalid signature" });
    }

    if (event.type !== "email.created") {
      return reply.send({ handled: false, reason: "ignored event type" });
    }
    const webhookId = req.headers["svix-id"];
    if (typeof webhookId !== "string" || !webhookId) {
      return reply.code(400).send({ error: "missing webhook id" });
    }

    if (event.data.delivered_by_clerk) {
      return reply.send({ handled: false, reason: "delivered by Clerk" });
    }
    if (process.env.SES_TRANSACTIONAL_EMAIL_ENABLED !== "true") {
      return reply
        .code(503)
        .send({ error: "SES transactional delivery is disabled" });
    }
    const sender = configuredSender();
    if (!sender) {
      return reply
        .code(503)
        .send({ error: "SES transactional delivery is incomplete" });
    }

    const result = await deliverClerkEmail(
      event as unknown as ClerkEmailCreatedEvent,
      webhookId,
      createPrismaClerkEmailDeliveryRepository(prisma),
      sender,
    );
    if (result.status === "unknown") {
      req.log.error(
        { clerkEmailId: event.data.id },
        "Clerk email has an ambiguous SES outcome",
      );
    }
    return reply.send({
      handled: result.status === "sent",
      status: result.status,
    });
  });
}
