import { createHash } from "node:crypto";
import {
  SESv2Client,
  SendEmailCommand,
  type SendEmailCommandInput,
} from "@aws-sdk/client-sesv2";
import type { EmailJSON } from "@clerk/backend";
import type { PrismaClient, TransactionalEmailDelivery } from "@vaettir/db";

const INVITATION_TEMPLATE_SLUG = "invitation";
const STALE_SENDING_MS = 2 * 60 * 1000;

type DeliveryStatus = TransactionalEmailDelivery["status"];

export type ClerkEmailCreatedEvent = {
  type: "email.created";
  data: EmailJSON;
};

type DeliveryClaim = {
  id: string;
  status: DeliveryStatus;
  updatedAt: Date;
};

export interface ClerkEmailDeliveryRepository {
  receive(input: {
    clerkEmailId: string;
    webhookId: string;
    templateSlug: string;
    recipientHash: string;
    recipientDomain: string;
  }): Promise<DeliveryClaim>;
  claim(id: string): Promise<boolean>;
  markSent(id: string, providerMessageId: string): Promise<void>;
  markFailed(id: string, errorCode: string): Promise<void>;
  markUnknown(id: string): Promise<void>;
}

export interface TransactionalEmailSender {
  send(input: {
    to: string;
    subject: string;
    html: string;
    text?: string;
  }): Promise<{ messageId: string }>;
}

export type ClerkEmailDeliveryResult =
  | { status: "ignored"; reason: "delivered_by_clerk" | "unsupported_template" }
  | { status: "duplicate" | "in_progress" | "unknown" }
  | { status: "sent"; providerMessageId: string };

function recipientIdentity(address: string) {
  const normalized = address.trim().toLowerCase();
  if (
    normalized.length > 320 ||
    normalized.includes("\r") ||
    normalized.includes("\n") ||
    !normalized.includes("@")
  ) {
    throw new Error("invalid_recipient");
  }
  const domain = normalized.slice(normalized.lastIndexOf("@") + 1);
  if (!domain || !domain.includes(".")) throw new Error("invalid_recipient");
  return {
    normalized,
    domain,
    hash: createHash("sha256").update(normalized).digest("hex"),
  };
}

function requiredText(
  value: string | null | undefined,
  field: string,
  max: number,
) {
  const text = value?.trim();
  if (
    !text ||
    text.length > max ||
    text.includes("\r") ||
    text.includes("\n")
  ) {
    throw new Error(`invalid_${field}`);
  }
  return text;
}

function errorCode(error: unknown) {
  if (error && typeof error === "object" && "name" in error) {
    const name = String(error.name)
      .replace(/[^A-Za-z0-9_.-]/g, "_")
      .slice(0, 100);
    if (name) return name;
  }
  return "TransactionalEmailSendError";
}

export function createPrismaClerkEmailDeliveryRepository(
  prisma: PrismaClient,
): ClerkEmailDeliveryRepository {
  return {
    async receive(input) {
      return prisma.transactionalEmailDelivery.upsert({
        where: { clerkEmailId: input.clerkEmailId },
        create: input,
        update: {},
        select: { id: true, status: true, updatedAt: true },
      });
    },
    async claim(id) {
      const result = await prisma.transactionalEmailDelivery.updateMany({
        where: { id, status: { in: ["RECEIVED", "FAILED"] } },
        data: {
          status: "SENDING",
          attemptCount: { increment: 1 },
          lastErrorCode: null,
        },
      });
      return result.count === 1;
    },
    async markSent(id, providerMessageId) {
      await prisma.transactionalEmailDelivery.update({
        where: { id },
        data: {
          status: "SENT",
          providerMessageId,
          sentAt: new Date(),
          lastErrorCode: null,
        },
      });
    },
    async markFailed(id, lastErrorCode) {
      await prisma.transactionalEmailDelivery.update({
        where: { id },
        data: { status: "FAILED", lastErrorCode },
      });
    },
    async markUnknown(id) {
      await prisma.transactionalEmailDelivery.updateMany({
        where: { id, status: "SENDING" },
        data: { status: "UNKNOWN", lastErrorCode: "stale_sending_outcome" },
      });
    },
  };
}

export function createSesTransactionalEmailSender(input: {
  region: string;
  from: string;
  replyTo?: string;
  configurationSet?: string;
  client?: SESv2Client;
  maxAttempts?: number;
}): TransactionalEmailSender {
  const from = requiredText(input.from, "from", 320);
  const replyTo = input.replyTo
    ? requiredText(input.replyTo, "reply_to", 320)
    : undefined;
  const client =
    input.client ?? new SESv2Client({ region: input.region, maxAttempts: input.maxAttempts ?? 3,
      requestHandler: { connectionTimeout: 6000, requestTimeout: 15000 } });

  return {
    async send(message) {
      const command: SendEmailCommandInput = {
        FromEmailAddress: from,
        Destination: { ToAddresses: [message.to] },
        ReplyToAddresses: replyTo ? [replyTo] : undefined,
        ConfigurationSetName: input.configurationSet,
        EmailTags: [
          { Name: "vaettir_template", Value: INVITATION_TEMPLATE_SLUG },
        ],
        Content: {
          Simple: {
            Subject: { Data: message.subject, Charset: "UTF-8" },
            Body: {
              Html: { Data: message.html, Charset: "UTF-8" },
              Text: message.text
                ? { Data: message.text, Charset: "UTF-8" }
                : undefined,
            },
          },
        },
      };
      const response = await client.send(new SendEmailCommand(command));
      if (!response.MessageId) throw new Error("ses_missing_message_id");
      return { messageId: response.MessageId };
    },
  };
}

export async function deliverClerkEmail(
  event: ClerkEmailCreatedEvent,
  webhookId: string,
  repository: ClerkEmailDeliveryRepository,
  sender: TransactionalEmailSender,
  now = new Date(),
): Promise<ClerkEmailDeliveryResult> {
  if (event.data.delivered_by_clerk) {
    return { status: "ignored", reason: "delivered_by_clerk" };
  }
  if (event.data.slug !== INVITATION_TEMPLATE_SLUG) {
    return { status: "ignored", reason: "unsupported_template" };
  }

  const to = recipientIdentity(event.data.to_email_address ?? "");
  const subject = requiredText(event.data.subject, "subject", 998);
  const html = event.data.body?.trim();
  if (!html || html.length > 500_000) throw new Error("invalid_body");
  const text = event.data.body_plain?.trim() || undefined;
  if (text && text.length > 500_000) throw new Error("invalid_body_plain");

  const delivery = await repository.receive({
    clerkEmailId: event.data.id,
    webhookId,
    templateSlug: event.data.slug,
    recipientHash: to.hash,
    recipientDomain: to.domain,
  });

  if (delivery.status === "SENT") return { status: "duplicate" };
  if (delivery.status === "UNKNOWN") return { status: "unknown" };
  if (delivery.status === "SENDING") {
    if (now.getTime() - delivery.updatedAt.getTime() >= STALE_SENDING_MS) {
      await repository.markUnknown(delivery.id);
      return { status: "unknown" };
    }
    return { status: "in_progress" };
  }

  const claimed = await repository.claim(delivery.id);
  if (!claimed) return { status: "in_progress" };

  try {
    const sent = await sender.send({
      to: to.normalized,
      subject,
      html,
      text,
    });
    await repository.markSent(delivery.id, sent.messageId);
    return { status: "sent", providerMessageId: sent.messageId };
  } catch (error) {
    await repository.markFailed(delivery.id, errorCode(error));
    throw error;
  }
}
