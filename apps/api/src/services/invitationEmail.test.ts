import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@vaettir/db";
import { invitationEmailContent, sendInvitationEmail } from "./invitationEmail.js";

function fixture(status = "PENDING") {
  let state = "RECEIVED";
  const update = vi.fn(async ({ data }) => { state = data.emailStatus; });
  const db = { invitation: {
    findUniqueOrThrow: vi.fn(async () => ({ id: "fixture", email: "recipient@example.com", token: "synthetic", organization: { name: "Example" }, status, expiresAt: new Date(Date.now() + 60000) })),
    updateMany: vi.fn(async () => { if (state !== "RECEIVED") return { count: 0 }; state = "SENDING"; return { count: 1 }; }), update,
  } };
  const sender = { send: vi.fn(async () => ({ messageId: "synthetic-message" })) };
  return { prisma: db as unknown as PrismaClient, sender, db, delivery: { origin: "https://example.com", sender } };
}
describe("workspace invitation mail", () => {
  it("escapes organization markup and creates the local acceptance link", () => {
    const mail = invitationEmailContent({ name: '<img src=x onerror="bad">', token: "a/b", expiresAt: new Date(0) }, "https://example.com");
    expect(mail.html).not.toContain("<img");
    expect(mail.html).toContain("https://example.com/invite/a%2Fb");
    expect(() => invitationEmailContent({ name: "test", token: "a", expiresAt: new Date(0) }, "http://example.com")).toThrow();
  });
  it("records provider acceptance and blocks concurrent/retried sends", async () => {
    const f = fixture();
    const results = await Promise.all([sendInvitationEmail(f.prisma, "fixture", f.delivery), sendInvitationEmail(f.prisma, "fixture", f.delivery)]);
    expect(results.sort()).toEqual(["ALREADY_ATTEMPTED", "SENT"]);
    expect(f.sender.send).toHaveBeenCalledTimes(1);
    expect(f.db.invitation.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ emailStatus: "SENT", emailMessageId: "synthetic-message" }) }));
  });
  it("does not send when disabled or revoked", async () => {
    const f = fixture();
    expect(await sendInvitationEmail(f.prisma, "fixture", null)).toBe("NOT_CONFIGURED");
    expect(f.sender.send).not.toHaveBeenCalled();
    const revoked = fixture("REVOKED");
    expect(await sendInvitationEmail(revoked.prisma, "fixture", revoked.delivery)).toBe("INACTIVE");
    expect(revoked.sender.send).not.toHaveBeenCalled();
  });
  it("retains ambiguous sends and never automatically retries", async () => {
    const f = fixture(); f.sender.send.mockRejectedValue(new Error("timeout"));
    expect(await sendInvitationEmail(f.prisma, "fixture", f.delivery)).toBe("UNKNOWN");
    expect(await sendInvitationEmail(f.prisma, "fixture", f.delivery)).toBe("ALREADY_ATTEMPTED");
    expect(f.sender.send).toHaveBeenCalledTimes(1);
  });
  it("does not resend after mail acceptance followed by a database failure", async () => {
    const f = fixture(); f.db.invitation.update.mockRejectedValue(new Error("database unavailable"));
    await expect(sendInvitationEmail(f.prisma, "fixture", f.delivery)).rejects.toThrow("database unavailable");
    expect(await sendInvitationEmail(f.prisma, "fixture", f.delivery)).toBe("ALREADY_ATTEMPTED");
    expect(f.sender.send).toHaveBeenCalledTimes(1);
  });
});
