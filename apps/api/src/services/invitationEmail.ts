import type { PrismaClient } from "@vaettir/db";
import { createSesTransactionalEmailSender, type TransactionalEmailSender } from "./clerkEmailDelivery.js";

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function invitationEmailContent(input: { name: string; token: string; expiresAt: Date }, origin: string) {
  const base = new URL(origin);
  if (base.protocol !== "https:" || base.username || base.password || base.pathname !== "/" || base.search || base.hash) throw new Error("Invalid invitation web origin");
  const url = `${base.origin}/invite/${encodeURIComponent(input.token)}`;
  const text = `You have been invited to join ${input.name} on Vaettir.\n\nAccept your invitation: ${url}\n\nThis invitation expires ${input.expiresAt.toISOString()}. Sign in with the email address that received this invitation. If you did not expect this invitation, you can ignore it.`;
  return { subject: "Your Vaettir workspace invitation", text,
    html: `<p>You have been invited to join <strong>${escapeHtml(input.name)}</strong> on Vaettir.</p><p><a href="${escapeHtml(url)}">Accept invitation</a></p><p>Expires ${input.expiresAt.toISOString()}. Sign in with the email address that received this invitation. If you did not expect this invitation, you can ignore it.</p>` };
}

function configuredDelivery() {
  const { SES_TRANSACTIONAL_EMAIL_ENABLED, AWS_REGION, TRANSACTIONAL_EMAIL_FROM, WEB_APP_URL } = process.env;
  if (SES_TRANSACTIONAL_EMAIL_ENABLED !== "true" || !AWS_REGION || !TRANSACTIONAL_EMAIL_FROM || !WEB_APP_URL) return null;
  return { origin: WEB_APP_URL, sender: createSesTransactionalEmailSender({ region: AWS_REGION, from: TRANSACTIONAL_EMAIL_FROM, maxAttempts: 1,
    replyTo: process.env.TRANSACTIONAL_EMAIL_REPLY_TO, configurationSet: process.env.SES_CONFIGURATION_SET }) };
}

// A durable claim prevents double sends across request retries/API replicas.
// Timeouts or process crashes are ambiguous: never automatically resend them.
export async function sendInvitationEmail(prisma: PrismaClient, invitationId: string,
  delivery: { origin: string; sender: TransactionalEmailSender } | null = configuredDelivery()) {
  const invitation = await prisma.invitation.findUniqueOrThrow({ where: { id: invitationId }, include: { organization: { select: { name: true } } } });
  if (invitation.status !== "PENDING" || invitation.expiresAt <= new Date()) return "INACTIVE" as const;
  if (!delivery) return "NOT_CONFIGURED" as const;
  const content = invitationEmailContent({ name: invitation.organization.name, token: invitation.token, expiresAt: invitation.expiresAt }, delivery.origin);
  const claimed = await prisma.invitation.updateMany({ where: { id: invitation.id, status: "PENDING", expiresAt: { gt: new Date() }, emailStatus: { in: ["RECEIVED", "FAILED"] } },
    data: { emailStatus: "SENDING", emailAttemptedAt: new Date() } });
  if (!claimed.count) return "ALREADY_ATTEMPTED" as const;
  let messageId: string;
  try {
    ({ messageId } = await delivery.sender.send({ to: invitation.email, ...content }));
  } catch {
    await prisma.invitation.update({ where: { id: invitation.id }, data: { emailStatus: "UNKNOWN" } });
    return "UNKNOWN" as const;
  }
  // Database failure here leaves SENDING, never a retryable state.
  await prisma.invitation.update({ where: { id: invitation.id }, data: { emailStatus: "SENT", emailMessageId: messageId, emailSentAt: new Date() } });
  return "SENT" as const;
}
