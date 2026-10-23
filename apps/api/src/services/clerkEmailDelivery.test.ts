import { describe, expect, it, vi } from "vitest";
import {
  deliverClerkEmail,
  type ClerkEmailCreatedEvent,
  type ClerkEmailDeliveryRepository,
  type TransactionalEmailSender,
} from "./clerkEmailDelivery.js";

function emailEvent(
  overrides: Partial<ClerkEmailCreatedEvent["data"]> = {},
): ClerkEmailCreatedEvent {
  return {
    type: "email.created",
    data: {
      id: "ema_test",
      object: "email",
      slug: "invitation",
      from_email_name: "welcome",
      to_email_address: "Invitee@Example.com",
      email_address_id: null,
      subject: "Your invitation to Vaettir",
      body: "<p>Invitation</p>",
      body_plain: "Invitation",
      delivered_by_clerk: false,
      ...overrides,
    } as ClerkEmailCreatedEvent["data"],
  };
}

function harness() {
  let record:
    | {
        id: string;
        status: "RECEIVED" | "SENDING" | "SENT" | "FAILED" | "UNKNOWN";
        updatedAt: Date;
      }
    | undefined;
  let attempts = 0;
  let lastErrorCode: string | undefined;
  let providerMessageId: string | undefined;

  const repository: ClerkEmailDeliveryRepository = {
    async receive() {
      record ??= {
        id: "delivery_1",
        status: "RECEIVED",
        updatedAt: new Date(),
      };
      return record;
    },
    async claim() {
      if (!record || !["RECEIVED", "FAILED"].includes(record.status))
        return false;
      record.status = "SENDING";
      record.updatedAt = new Date();
      attempts += 1;
      return true;
    },
    async markSent(_id, messageId) {
      if (!record) throw new Error("missing record");
      record.status = "SENT";
      providerMessageId = messageId;
    },
    async markFailed(_id, errorCode) {
      if (!record) throw new Error("missing record");
      record.status = "FAILED";
      lastErrorCode = errorCode;
    },
    async markUnknown() {
      if (!record) throw new Error("missing record");
      record.status = "UNKNOWN";
    },
  };
  const send = vi.fn(async () => ({ messageId: "ses_message_1" }));
  const sender: TransactionalEmailSender = { send };
  return {
    repository,
    sender,
    send,
    state: () => ({ record, attempts, lastErrorCode, providerMessageId }),
  };
}

describe("Clerk transactional email delivery", () => {
  it("does not duplicate messages that Clerk still delivers", async () => {
    const h = harness();
    await expect(
      deliverClerkEmail(
        emailEvent({ delivered_by_clerk: true }),
        "msg_1",
        h.repository,
        h.sender,
      ),
    ).resolves.toEqual({ status: "ignored", reason: "delivered_by_clerk" });
    expect(h.send).not.toHaveBeenCalled();
    expect(h.state().record).toBeUndefined();
  });

  it("sends one invitation and deduplicates a webhook retry", async () => {
    const h = harness();
    await expect(
      deliverClerkEmail(emailEvent(), "msg_1", h.repository, h.sender),
    ).resolves.toEqual({ status: "sent", providerMessageId: "ses_message_1" });
    await expect(
      deliverClerkEmail(emailEvent(), "msg_1", h.repository, h.sender),
    ).resolves.toEqual({ status: "duplicate" });
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.send).toHaveBeenCalledWith({
      to: "invitee@example.com",
      subject: "Your invitation to Vaettir",
      html: "<p>Invitation</p>",
      text: "Invitation",
    });
    expect(h.state()).toMatchObject({
      attempts: 1,
      providerMessageId: "ses_message_1",
    });
  });

  it("records a sanitized failure and allows the provider retry to recover", async () => {
    const h = harness();
    h.send.mockRejectedValueOnce(
      Object.assign(new Error("secret provider text"), {
        name: "TooManyRequestsException",
      }),
    );
    await expect(
      deliverClerkEmail(emailEvent(), "msg_1", h.repository, h.sender),
    ).rejects.toThrow("secret provider text");
    expect(h.state()).toMatchObject({
      attempts: 1,
      lastErrorCode: "TooManyRequestsException",
    });

    await expect(
      deliverClerkEmail(emailEvent(), "msg_1", h.repository, h.sender),
    ).resolves.toEqual({ status: "sent", providerMessageId: "ses_message_1" });
    expect(h.send).toHaveBeenCalledTimes(2);
    expect(h.state().attempts).toBe(2);
  });

  it("fails closed on header injection and unsupported templates", async () => {
    const h = harness();
    await expect(
      deliverClerkEmail(
        emailEvent({
          to_email_address: "victim@example.com\r\nBcc: attacker@example.com",
        }),
        "msg_1",
        h.repository,
        h.sender,
      ),
    ).rejects.toThrow("invalid_recipient");
    await expect(
      deliverClerkEmail(
        emailEvent({ slug: "verification_code" }),
        "msg_2",
        h.repository,
        h.sender,
      ),
    ).resolves.toEqual({ status: "ignored", reason: "unsupported_template" });
    expect(h.send).not.toHaveBeenCalled();
  });

  it("marks a stale in-flight outcome unknown instead of risking a duplicate", async () => {
    const h = harness();
    await h.repository.receive({
      clerkEmailId: "ema_test",
      webhookId: "msg_1",
      templateSlug: "invitation",
      recipientHash: "hash",
      recipientDomain: "example.com",
    });
    await h.repository.claim("delivery_1");
    const future = new Date(Date.now() + 3 * 60 * 1000);
    await expect(
      deliverClerkEmail(emailEvent(), "msg_1", h.repository, h.sender, future),
    ).resolves.toEqual({ status: "unknown" });
    expect(h.send).not.toHaveBeenCalled();
    expect(h.state().record?.status).toBe("UNKNOWN");
  });
});
