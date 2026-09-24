import * as Sentry from "@sentry/node";
import { prisma } from "@vaettir/db";
import { recordReadinessSnapshot } from "../services/releaseReadiness.js";
import { recordHeartbeat } from "../services/heartbeat.js";
import { createSafeSchedulerRunner } from "./safeSchedulerRunner.js";

// P8-04 (release-readiness state changes): same in-process interval shape
// as readinessDigestScheduler.ts - no queue/cron infra exists. Every 5
// minutes, every non-SHIPPED release gets its readiness recomputed and
// compared against its last snapshot; a label change is what fires the
// notifications (see services/releaseReadiness.ts). Polling rather than
// hooking every mutation that could move readiness (criterion status,
// risk flag create/resolve, test-run ingestion updating auto-computed
// criteria, plan attach/detach...) - that's five-plus call sites today and
// a guaranteed-missed one tomorrow, and "within five minutes" is fine for
// a readiness change.
export const CHECK_INTERVAL_MS = 5 * 60 * 1000;
let checkHandle: NodeJS.Timeout | undefined;

export async function checkReadinessChangesOnce(): Promise<void> {
  recordHeartbeat("readinessChangeScheduler");
  const releases = await prisma.release.findMany({
    where: { status: { not: "SHIPPED" } },
    select: { id: true },
  });
  for (const release of releases) {
    try {
      await recordReadinessSnapshot(prisma, release.id);
    } catch (e) {
      // One release's failure (e.g. deleted mid-tick) must not stop the
      // rest of the sweep; still reported so a persistent failure shows.
      Sentry.captureException(e);
    }
  }
}

const runCheckSafely = createSafeSchedulerRunner("readinessChangeScheduler", checkReadinessChangesOnce);

export function startReadinessChangeScheduler(): void {
  if (checkHandle) return;
  checkHandle = setInterval(() => void runCheckSafely(), CHECK_INTERVAL_MS);
  checkHandle.unref();
}
