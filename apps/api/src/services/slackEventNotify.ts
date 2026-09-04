import type { PrismaClient } from "@vaettir/db";
import type { WebhookEventType } from "./webhookDelivery.js";

// P9-03: the first "configurable event notifications" slice named in
// ROADMAP.md - reuses the exact same webhook URL P7-09's digest already
// posts to (Slack incoming webhooks are already bound to one channel at
// creation on Slack's own side, so there's no separate "channel" to pick),
// gated by a new per-org subset of WEBHOOK_EVENT_TYPES rather than the
// digest's all-or-nothing toggle. Fire-and-forget from the same three real
// call sites P9-06's dispatchWebhookEvent already fires from - this is a
// second real subscriber of those events, not a replacement for the
// generic webhook system.

interface RiskFlagCreatedData {
  projectName: string;
  releaseName: string | null;
  count: number;
  files: { filePath: string; severity: string }[];
}

interface ComplianceSignOffData {
  projectName: string;
  controlName: string;
  period: string;
  signedByEmail: string;
}

interface ReviewRequestedData {
  projectName: string;
  filePath: string;
  count: number;
}

const SEVERITY_EMOJI: Record<string, string> = { CRITICAL: "🔴", HIGH: "🟠", MEDIUM: "🟡", LOW: "⚪" };

function buildRiskFlagBlocks(data: RiskFlagCreatedData): { text: string; blocks: unknown[] } {
  const text = `${data.count} new risk flag(s) in ${data.projectName}${data.releaseName ? ` (${data.releaseName})` : ""}`;
  const fileLines = data.files
    .slice(0, 10)
    .map((f) => `${SEVERITY_EMOJI[f.severity] ?? "⚪"} \`${f.filePath}\``)
    .join("\n");
  return {
    text,
    blocks: [
      { type: "header", text: { type: "plain_text", text: "New risk flag(s)", emoji: true } },
      {
        type: "section",
        text: { type: "mrkdwn", text: `*${data.projectName}*${data.releaseName ? ` — ${data.releaseName}` : ""}\n${text}` },
      },
      { type: "section", text: { type: "mrkdwn", text: fileLines || "_No file details available._" } },
    ],
  };
}

function buildSignOffBlocks(data: ComplianceSignOffData): { text: string; blocks: unknown[] } {
  const text = `${data.signedByEmail} signed off ${data.controlName} for ${data.projectName} (${data.period})`;
  return {
    text,
    blocks: [
      { type: "header", text: { type: "plain_text", text: "Compliance sign-off recorded", emoji: true } },
      { type: "section", text: { type: "mrkdwn", text } },
    ],
  };
}

function buildReviewRequestedBlocks(data: ReviewRequestedData): { text: string; blocks: unknown[] } {
  const text = `${data.count} test case(s) from \`${data.filePath}\` in ${data.projectName} need review`;
  return {
    text,
    blocks: [
      { type: "header", text: { type: "plain_text", text: "Test cases need review", emoji: true } },
      { type: "section", text: { type: "mrkdwn", text } },
    ],
  };
}

async function postToSlack(webhookUrl: string, message: { text: string; blocks: unknown[] }): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(message),
  });
  if (!res.ok) {
    throw new Error(`Slack webhook post failed: ${res.status} ${await res.text()}`);
  }
}

export async function notifySlackEvent(
  prisma: PrismaClient,
  organizationId: string,
  eventType: WebhookEventType,
  data: RiskFlagCreatedData | ComplianceSignOffData | ReviewRequestedData,
): Promise<void> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { slackWebhookUrl: true, slackEventTypes: true },
  });
  if (!org?.slackWebhookUrl || !org.slackEventTypes.includes(eventType)) return;

  const message =
    eventType === "risk_flag.created"
      ? buildRiskFlagBlocks(data as RiskFlagCreatedData)
      : eventType === "compliance.sign_off_recorded"
        ? buildSignOffBlocks(data as ComplianceSignOffData)
        : buildReviewRequestedBlocks(data as ReviewRequestedData);

  await postToSlack(org.slackWebhookUrl, message);
}
