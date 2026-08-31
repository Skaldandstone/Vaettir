import * as Sentry from "@sentry/node";
import { prisma } from "@vaettir/db";
import { grantMonthlyCreditsIfNeeded } from "../services/aiCredits.js";
import { recordHeartbeat } from "../services/heartbeat.js";

// Once-a-day is plenty of grain for "grant once per calendar month" --
// unlike the reverse-engineer queue or the readiness digest, there's no
// user-visible latency concern to a grant landing up to a day into the
// month. Mirrors readinessDigestScheduler.ts's in-process-interval
// approach (no queue/cron infra exists yet).
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
let checkHandle: NodeJS.Timeout | undefined;

function reportCheckFailure(error: unknown): void {
  try {
    Sentry.captureException(error);
  } catch {
    // Reporting must not turn a handled failure into an unhandled rejection.
    // Do not fall back to logging potentially sensitive database error text.
  }
}

async function checkOnce(): Promise<void> {
  recordHeartbeat("aiCreditGrantScheduler");
  const orgs = await prisma.organization.findMany({ select: { id: true } });
  for (const org of orgs) {
    await grantMonthlyCreditsIfNeeded(prisma, org.id).catch(reportCheckFailure);
  }
}

export function startAiCreditGrantScheduler(): void {
  if (checkHandle) return;
  void checkOnce().catch(reportCheckFailure);
  checkHandle = setInterval(() => void checkOnce().catch(reportCheckFailure), CHECK_INTERVAL_MS);
  checkHandle.unref();
}
