import * as Sentry from "@sentry/node";
import { prisma } from "@vaettir/db";
import { getOrgOverview } from "../services/orgReadiness.js";
import { postSlackDigest } from "../services/readinessDigest.js";

// P7-09: no queue/cron infra exists (see reverseEngineerWorker.ts's same
// note) -- an in-process interval checks every org with digestEnabled at
// a coarse 15-minute grain and fires when the current UTC hour matches its
// configured digestHourUtc and it hasn't already sent today. Coarse grain
// is fine here: unlike the reverse-engineer queue, a digest a few minutes
// late is a non-event.
const CHECK_INTERVAL_MS = 15 * 60 * 1000;
let checkHandle: NodeJS.Timeout | undefined;

function isSameUtcDay(a: Date, b: Date): boolean {
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() === b.getUTCDate();
}

export async function sendReadinessDigestForOrg(organizationId: string): Promise<void> {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
  if (!org.slackWebhookUrl) {
    throw new Error("No Slack webhook configured for this organization");
  }
  const overview = await getOrgOverview(prisma, organizationId);
  await postSlackDigest(org.slackWebhookUrl, org.name, overview);
  await prisma.organization.update({ where: { id: organizationId }, data: { lastDigestSentAt: new Date() } });
}

async function checkOnce(): Promise<void> {
  const now = new Date();
  const candidates = await prisma.organization.findMany({
    where: { digestEnabled: true, slackWebhookUrl: { not: null }, digestHourUtc: now.getUTCHours() },
    select: { id: true, name: true, lastDigestSentAt: true },
  });
  for (const org of candidates) {
    if (org.lastDigestSentAt && isSameUtcDay(org.lastDigestSentAt, now)) continue;
    try {
      await sendReadinessDigestForOrg(org.id);
    } catch (e) {
      // Swallow -- a bad/revoked webhook shouldn't crash the shared
      // interval or block other orgs' digests; next check tick (still
      // today, since lastDigestSentAt wasn't touched) will retry. Still
      // reported so a persistently-broken webhook doesn't go unnoticed.
      Sentry.captureException(e);
    }
  }
}

export function startReadinessDigestScheduler(): void {
  if (checkHandle) return;
  checkHandle = setInterval(() => void checkOnce(), CHECK_INTERVAL_MS);
  checkHandle.unref();
}
