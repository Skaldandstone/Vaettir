import { prisma } from "@vaettir/db";
import { reverseEngineerTestFile } from "@vaettir/ai-agent";
import { persistReverseEngineerResult } from "../services/reverseEngineerPersist.js";

// Single-instance, in-process poller -- no Redis/queue infra exists yet, and
// running one API instance is the actual current deployment shape (see
// TRO-229, AWS deferred). Concurrency is deliberately 1: `processing` guards
// against overlapping poll ticks running two jobs at once. If this ever
// needs to scale beyond one API process, replace this file with a real
// queue (BullMQ+Redis) -- the job model and runJob's logic don't change,
// only how a job gets picked up.
const POLL_INTERVAL_MS = 5000;
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
    const result = await reverseEngineerTestFile({ filePath: job.inputRef, content: job.content });
    const created = await persistReverseEngineerResult(prisma, {
      projectId: job.projectId,
      filePath: job.inputRef,
      result,
    });
    await prisma.reverseEngineerJob.update({
      where: { id: job.id },
      data: {
        status: "SUCCEEDED",
        completedAt: new Date(),
        resultTestCaseIds: created.map((tc) => tc.id),
        framework: result.detectedFramework,
      },
    });
  } catch (e) {
    await prisma.reverseEngineerJob.update({
      where: { id: job.id },
      data: { status: "FAILED", completedAt: new Date(), error: e instanceof Error ? e.message : String(e) },
    });
  }
}

async function pollOnce(): Promise<void> {
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

// Called by agent.submitJob to nudge the queue immediately instead of
// waiting up to POLL_INTERVAL_MS for the next tick. Errors are swallowed --
// the next scheduled tick will retry, and the caller (a fire-and-forget
// mutation) has no way to surface them anyway; a failure lands on the job
// row itself via runReverseEngineerJob's catch.
export async function kickReverseEngineerQueue(): Promise<void> {
  await pollOnce().catch(() => undefined);
}

export function startReverseEngineerJobPoller(): void {
  if (pollHandle) return;
  pollHandle = setInterval(() => void pollOnce(), POLL_INTERVAL_MS);
  pollHandle.unref();
}
