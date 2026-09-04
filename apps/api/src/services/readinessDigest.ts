import type { OrgOverview } from "./orgReadiness.js";
import { assertPublicHttpUrl } from "./urlGuard.js";

const LABEL_EMOJI: Record<string, string> = { READY: "🟢", AT_RISK: "🟡", BLOCKED: "🔴" };

// P7-09: Slack Block Kit payload for an org's readiness digest -- one
// section per project with an active release, skipping projects with
// nothing in flight rather than padding the message with "no release"
// noise (the summary counts still account for them).
export function buildDigestBlocks(orgName: string, overview: OrgOverview): unknown[] {
  const { projects, summary } = overview;
  const blocks: unknown[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `${orgName} release readiness`, emoji: true },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `🟢 ${summary.ready} ready · 🟡 ${summary.atRisk} at risk · 🔴 ${summary.blocked} blocked · ${summary.noActiveRelease} no active release`,
        },
      ],
    },
  ];

  const active = projects.filter((p) => p.release !== null);
  if (active.length === 0) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: "_No projects have a release in flight right now._" } });
    return blocks;
  }

  blocks.push({ type: "divider" });
  for (const p of active) {
    const r = p.release!;
    const emoji = LABEL_EMOJI[r.readiness.label] ?? "⚪";
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${emoji} *${p.projectName}* — ${r.name} (${r.status})\n${r.readiness.score}/100 · ${r.readiness.criteria.met}/${r.readiness.criteria.total} criteria met · ${r.readiness.riskFlags.openTotal} open risk flag(s)`,
      },
    });
  }
  return blocks;
}

export function buildDigestFallbackText(orgName: string, overview: OrgOverview): string {
  const { summary } = overview;
  return `${orgName} release readiness: ${summary.ready} ready, ${summary.atRisk} at risk, ${summary.blocked} blocked, ${summary.noActiveRelease} with no active release.`;
}

export async function postSlackDigest(webhookUrl: string, orgName: string, overview: OrgOverview): Promise<void> {
  // Re-checked here, not just when the URL was saved: DNS can change (or be
  // rebound) between then and this scheduled send.
  const url = await assertPublicHttpUrl(webhookUrl);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: buildDigestFallbackText(orgName, overview),
      blocks: buildDigestBlocks(orgName, overview),
    }),
  });
  if (!res.ok) {
    throw new Error(`Slack webhook post failed: ${res.status} ${await res.text()}`);
  }
}
