import { randomUUID } from "node:crypto";
import { prisma, type PrismaClient } from "@vaettir/db";
import { testCasesRouter } from "../routers/testCases.js";
import { testDesignRouter } from "../routers/testDesign.js";
import {
  analysisAccess,
  approvedAnalysisContext,
} from "../services/caseAnalysisQueue.js";
import {
  withApprovedAnalysisSpend,
  isDefinitiveAnalysisSpendRefusal,
  assertApprovedAnalysisReservation,
} from "../services/approvedAnalysisSpend.js";
import { InsufficientAiCreditsError } from "../services/aiCredits.js";
import { recordHeartbeat } from "../services/heartbeat.js";
import { createSafeSchedulerRunner } from "./safeSchedulerRunner.js";

export const ANALYSIS_POLL_INTERVAL_MS = 5000;
export const analysisPollLivenessTick = (
  heartbeat: () => void,
  guardedPoll: () => Promise<void>,
) => {
  heartbeat();
  void guardedPoll();
};
const LEASE_MS = 120000;
let processing = false;
let timer: ReturnType<typeof setInterval> | undefined;

export async function runCaseAnalysisQueueOnce(
  db: PrismaClient = prisma,
): Promise<void> {
  const candidate = await db.caseAnalysisQueue.findFirst({
    where: {
      OR: [
        { status: "QUEUED" },
        { status: "RUNNING", leaseExpiresAt: { lt: new Date() } },
      ],
    },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
  });
  if (!candidate) return;
  const leaseOwner = randomUUID();
  const claimed = await db.$transaction(async (tx) => {
    try {
      await analysisAccess(
        tx,
        candidate.projectId,
        candidate.requestedById,
        true,
        candidate.organizationId,
      );
    } catch {
      await tx.caseAnalysisQueue.updateMany({
        where: { id: candidate.id, status: { in: ["QUEUED", "RUNNING"] } },
        data: {
          status: "STOPPED",
          reason:
            "Current full editor access is unavailable. No new case will be charged.",
        },
      });
      return null;
    }
    await tx.$queryRaw`SELECT id FROM "CaseAnalysisQueue" WHERE id=${candidate.id} FOR UPDATE`;
    const job = await tx.caseAnalysisQueue.findUniqueOrThrow({
      where: { id: candidate.id },
    });
    if (job.status === "RUNNING") {
      if (!job.leaseExpiresAt || job.leaseExpiresAt >= new Date()) return null;
      // A lost worker never authorizes another provider attempt. Saved child
      // output is independently recoverable through the case's paid history.
      if (job.activeItemId)
        await tx.caseAnalysisQueueItem.updateMany({
          where: { id: job.activeItemId, status: "RUNNING" },
          data: {
            status: "UNKNOWN",
            reason:
              "Worker lease expired. Check saved case review; administrator reconciliation is required, not an automatic paid retry.",
            completedAt: new Date(),
          },
        });
      await tx.caseAnalysisQueue.update({
        where: { id: job.id },
        data: {
          status: "STOPPED",
          activeItemId: null,
          leaseOwner: null,
          leaseExpiresAt: null,
          reason:
            "Interrupted case outcome needs reconciliation. Unclaimed cases were not charged.",
        },
      });
      return null;
    }
    if (job.status !== "QUEUED" || job.cancelledAt || !job.approvedAt)
      return null;
    const item = await tx.caseAnalysisQueueItem.findFirst({
      where: { queueId: job.id, status: "QUEUED" },
      orderBy: { position: "asc" },
    });
    if (!item) {
      await tx.caseAnalysisQueue.update({
        where: { id: job.id },
        data: { status: "COMPLETE" },
      });
      return null;
    }
    await tx.caseAnalysisQueueItem.update({
      where: { id: item.id },
      data: { status: "RUNNING", startedAt: new Date() },
    });
    const owned = await tx.caseAnalysisQueue.update({
      where: { id: job.id },
      data: {
        status: "RUNNING",
        activeItemId: item.id,
        leaseOwner,
        leaseExpiresAt: new Date(Date.now() + LEASE_MS),
      },
    });
    return { job: owned, item };
  });
  if (!claimed) return;
  const { job, item } = claimed;
  const renew = setInterval(() => {
    // Cancellation does not pretend the already claimed provider work vanished.
    void db.caseAnalysisQueue
      .updateMany({
        where: {
          id: job.id,
          leaseOwner,
          activeItemId: item.id,
          status: { in: ["RUNNING", "CANCELLED"] },
        },
        data: { leaseExpiresAt: new Date(Date.now() + LEASE_MS) },
      })
      .catch(() => {});
  }, 30000);
  renew.unref();
  let status = "READY",
    reason: string | null = null;
  try {
    const user = await db.user.findUniqueOrThrow({
      where: { id: job.requestedById },
      include: { memberships: true },
    });
    const ctx = {
      prisma: db,
      user,
      staff: null,
      securityLogger: { warn: () => {} },
      staffAttempt: {
        tokenConfigured: false,
        tokenPresented: false,
        actorHeaderPresented: false,
      },
    };
    await withApprovedAnalysisSpend<unknown>(
      approvedAnalysisContext(job, item, leaseOwner),
      async () => {
        await assertApprovedAnalysisReservation(
          db,
          item.caseId,
          item.inputHash,
        );
        return job.action === "RISK"
          ? testCasesRouter.createCaller(ctx).assessRisk({
              id: item.caseId,
              expectedHash: item.inputHash,
              approved: true,
            })
          : testDesignRouter.createCaller(ctx).review({
              id: item.caseId,
              expectedHash: item.inputHash,
              approved: true,
            });
      },
    );
  } catch (error) {
    const actual = await db.caseAnalysisQueueItem.findUniqueOrThrow({
      where: { id: item.id },
    });
    const unpaid =
      isDefinitiveAnalysisSpendRefusal(error) ||
      error instanceof InsufficientAiCreditsError ||
      (error instanceof Error &&
        error.cause instanceof InsufficientAiCreditsError);
    status = actual.chargeId || !unpaid ? "UNKNOWN" : "FAILED";
    // Do not copy provider errors, prompts, paths or customer data into receipts.
    reason = unpaid
      ? "Stopped before charge: approval, current access, case baseline or balance is no longer valid."
      : "The attempt may have been charged or accepted. Check saved case review; administrator reconciliation is required. No automatic retry.";
  } finally {
    clearInterval(renew);
  }
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Organization" WHERE id=${job.organizationId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "CaseAnalysisQueue" WHERE id=${job.id} FOR UPDATE`;
    const current = await tx.caseAnalysisQueue.findUnique({
      where: { id: job.id },
    });
    if (
      !current ||
      current.leaseOwner !== leaseOwner ||
      current.activeItemId !== item.id
    )
      return;
    await tx.caseAnalysisQueueItem.updateMany({
      where: { id: item.id, status: "RUNNING" },
      data: { status, reason, completedAt: new Date() },
    });
    const remaining = await tx.caseAnalysisQueueItem.count({
      where: { queueId: job.id, status: "QUEUED" },
    });
    await tx.caseAnalysisQueue.update({
      where: { id: job.id },
      data: {
        status: current.cancelledAt
          ? "CANCELLED"
          : status === "UNKNOWN"
            ? "STOPPED"
            : remaining
              ? "QUEUED"
              : "COMPLETE",
        reason: status === "UNKNOWN" ? reason : current.reason,
        activeItemId: null,
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    });
  });
}

const poll = createSafeSchedulerRunner("caseAnalysisQueueWorker", async () => {
  recordHeartbeat("caseAnalysisQueueWorker");
  if (processing) return;
  processing = true;
  try {
    await runCaseAnalysisQueueOnce();
  } finally {
    processing = false;
  }
});
export function startCaseAnalysisQueuePoller() {
  if (timer) return;
  timer = setInterval(
    () =>
      analysisPollLivenessTick(
        () => recordHeartbeat("caseAnalysisQueueWorker"),
        poll,
      ),
    ANALYSIS_POLL_INTERVAL_MS,
  );
  timer.unref();
}
