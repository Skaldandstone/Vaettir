import * as Sentry from "@sentry/node";
import { prisma } from "@vaettir/db";
import { reverseEngineerTestFile } from "@vaettir/ai-agent";
import { persistReverseEngineerResult } from "../services/reverseEngineerPersist.js";
import { hashFileContent } from "../services/repoScan.js";
import { getMostRecentHeuristic, recordHeuristicUsage } from "../services/customFrameworkHeuristic.js";
import { chargeAiCredits, InsufficientAiCreditsError, meterAiCall } from "../services/aiCredits.js";
import { recordHeartbeat } from "../services/heartbeat.js";
import { linkExternalTestResult, validateTriggeringResult } from "../services/externalTestMapping.js";
import { createSafeSchedulerRunner } from "./safeSchedulerRunner.js";

// Single-instance, in-process poller -- no Redis/queue infra exists yet, and
// running one API instance is the actual current deployment shape (see
// TRO-229, AWS deferred). Concurrency is deliberately 1: `processing` guards
// against overlapping poll ticks running two jobs at once. If this ever
// needs to scale beyond one API process, replace this file with a real
// queue (BullMQ+Redis) -- the job model and runJob's logic don't change,
// only how a job gets picked up.
export const POLL_INTERVAL_MS = 5000;
// A job stuck RUNNING longer than this almost certainly means the process
// that claimed it (this poller, or a one-off script calling runJob/kick
// directly) died or was killed mid-call rather than the LLM call actually
// still being in flight -- reclaim it so it isn't stuck PENDING-forever's
// evil twin: RUNNING-forever with nothing left to ever pick it back up.
const STALE_RUNNING_MS = 10 * 60 * 1000;
let processing = false;
let pollHandle: NodeJS.Timeout | undefined;

async function reclaimStaleRunningJobs(): Promise<void> {
  await prisma.reverseEngineerJob.updateMany({
    where: { status: "RUNNING", startedAt: { lt: new Date(Date.now() - STALE_RUNNING_MS) } },
    data: { status: "PENDING", startedAt: null },
  });
}

export async function runReverseEngineerJob(jobId: string): Promise<void> {
  // Re-fetch and gate on PENDING so a job already claimed by another tick
  // (or run directly via kickReverseEngineerQueue racing the poll loop)
  // isn't processed twice.
  const claimed = await prisma.reverseEngineerJob.updateMany({
    where: { id: jobId, status: "PENDING" },
    data: { status: "RUNNING", startedAt: new Date() },
  });
  if (claimed.count === 0) return;

  const job = await prisma.reverseEngineerJob.findUniqueOrThrow({ where: { id: jobId } });

  try {
    if (job.content === null) {
      throw new Error(`Job ${job.id} has no content to reverse-engineer (inputType ${job.inputType})`);
    }
    if (job.inputType === "CI_UNMATCHED_RESULT" && !job.triggeringResultId) throw new Error("CI job has no triggering result");
    const triggeringResult = job.triggeringResultId
      ? await validateTriggeringResult(prisma, job.projectId, job.triggeringResultId)
      : null;
    const content = job.content;
    const project = await prisma.project.findUniqueOrThrow({ where: { id: job.projectId }, select: { organizationId: true } });
    const charge = await chargeAiCredits(prisma, project.organizationId, "reverseEngineerTestFile", `job ${job.id} (${job.inputRef})`);
    const heuristic = await getMostRecentHeuristic(prisma, job.projectId);
    const result = await meterAiCall(prisma, charge, () =>
      reverseEngineerTestFile({
        filePath: job.inputRef,
        content,
        customFrameworkHint: heuristic?.description,
      }),
    );
    if (heuristic && result.detectedFrameworkFamily === "CUSTOM") {
      await recordHeuristicUsage(prisma, heuristic.id);
    }
    const created = await persistReverseEngineerResult(prisma, {
      projectId: job.projectId,
      filePath: job.inputRef,
      contentHash: hashFileContent(job.content),
      result,
    });
    await prisma.reverseEngineerJob.update({
      where: { id: job.id },
      data: {
        resultTestCaseIds: created.map((tc) => tc.id),
        framework: result.detectedFramework,
      },
    });

    // P5-14: this job exists because a CI result arrived with no matching
    // TestCaseSource -- on success, link the produced TestCase's source
    // back to that result's externalTestId so the *next* run of the same
    // test auto-matches (P5-01's exact-externalTestId lookup) instead of
    // re-triggering this whole path. Only auto-links when the match is
    // unambiguous: the produced case whose sourceFunctionName matches the
    // reported test's name, or the sole case if the file only produced one.
    // Multiple candidates with no name match falls back to manual linking
    // (P5-04) rather than guessing which one the CI result actually meant.
    if (job.inputType === "CI_UNMATCHED_RESULT" && job.triggeringResultId) {
      const reportedName = triggeringResult?.externalTestId?.split("::").pop();
      const namedMatches = reportedName ? created.filter((tc) => tc.source?.functionName === reportedName) : [];
      if (namedMatches.length > 1) throw new Error("Generated cases ambiguously match the CI result; manual review is required");
      const match = namedMatches[0] ?? (created.length === 1 ? created[0] : undefined);
      if (match?.source && triggeringResult) {
        await linkExternalTestResult(prisma, {
          projectId: job.projectId,
          testResultId: triggeringResult.id,
          testCaseId: match.id,
          jobId: job.id,
        });
      }
    }
    await prisma.reverseEngineerJob.update({
      where: { id: job.id },
      data: { status: "SUCCEEDED", completedAt: new Date() },
    });
  } catch (e) {
    // Insufficient credits is an expected, user-actionable outcome (the org
    // ran out, not a bug) -- everything else here (a bad LLM response, a DB
    // failure, malformed job content) is worth alerting on.
    if (!(e instanceof InsufficientAiCreditsError)) Sentry.captureException(e);
    await prisma.reverseEngineerJob.update({
      where: { id: job.id },
      data: { status: "FAILED", completedAt: new Date(), error: e instanceof Error ? e.message : String(e) },
    });
  }
}

async function pollOnce(): Promise<void> {
  recordHeartbeat("reverseEngineerWorker");
  if (processing) return;
  processing = true;
  try {
    await reclaimStaleRunningJobs();
    // Process every job currently PENDING, oldest first, one at a time --
    // not just the first one -- so a burst of submissions between poll
    // ticks doesn't wait multiple intervals to drain.
    for (;;) {
      const next = await prisma.reverseEngineerJob.findFirst({
        where: { status: "PENDING" },
        orderBy: { createdAt: "asc" },
      });
      if (!next) break;
      await runReverseEngineerJob(next.id);
    }
  } finally {
    processing = false;
  }
}

const runScheduledPollSafely = createSafeSchedulerRunner("reverseEngineerWorker", pollOnce);

// Called by agent.submitJob to nudge the queue immediately instead of
// waiting up to POLL_INTERVAL_MS for the next tick. Errors are swallowed --
// the next scheduled tick will retry, and the caller (a fire-and-forget
// mutation) has no way to surface them anyway; a failure lands on the job
// row itself via runReverseEngineerJob's catch. A failure here means the
// poll loop itself broke (e.g. the DB was unreachable), not a single job --
// that's worth alerting on, so it's still reported to Sentry even though
// it's not rethrown.
export async function kickReverseEngineerQueue(): Promise<void> {
  await pollOnce().catch((e) => Sentry.captureException(e));
}

export function startReverseEngineerJobPoller(): void {
  if (pollHandle) return;
  pollHandle = setInterval(() => void runScheduledPollSafely(), POLL_INTERVAL_MS);
  pollHandle.unref();
}
