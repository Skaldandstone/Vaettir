import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { prisma, type PrismaClient } from "@vaettir/db";
import { lockedProcessingEditor } from "../services/repositoryProcessingApproval.js";
import {
  nextReportOccurrence,
  reportScheduleConfigSchema,
} from "../services/reportWorkflowSchema.js";
import { captureReportPreview } from "../routers/reportSnapshots.js";
import { createSafeSchedulerRunner } from "./safeSchedulerRunner.js";
import { recordHeartbeat } from "../services/heartbeat.js";
import { deliverPendingReports } from "../services/reportDelivery.js";

export const REPORT_SCHEDULE_INTERVAL_MS = 60000;
const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");
/** Database-only capture and receipt commit atomically. No network delivery or
 * simulated Clerk context. A stored mandate is reauthorized against its owner. */
export async function runDueReportSchedules(
  db: PrismaClient = prisma,
  now = new Date(),
) {
  const candidates = await db.projectReportSchedule.findMany({
    where: { enabled: true, nextRunAt: { lte: now } },
    select: {
      id: true,
      organizationId: true,
      projectId: true,
      ownerId: true,
      version: true,
      nextRunAt: true,
    },
    orderBy: [{ nextRunAt: "asc" }, { id: "asc" }],
    take: 10,
  });
  for (const candidate of candidates) {
    try {
      await db.$transaction(
        async (tx) => {
          // Same parent lock order as save/pause; permission changes cannot race a capture.
          await lockedProcessingEditor(
            tx,
            candidate.organizationId,
            candidate.ownerId,
            candidate.projectId,
          );
          const locked = await tx.$queryRaw<
            Array<{ id: string }>
          >`SELECT id FROM "ProjectReportSchedule" WHERE id=${candidate.id} FOR UPDATE SKIP LOCKED`;
          if (!locked.length) return;
          const current = await tx.projectReportSchedule.findUnique({
            where: { id: candidate.id },
          });
          if (
            !current ||
            !current.enabled ||
            current.version !== candidate.version ||
            current.nextRunAt.getTime() !== candidate.nextRunAt.getTime()
          )
            return;
          const membership = await tx.membership.findUnique({
            where: {
              organizationId_userId: {
                organizationId: current.organizationId,
                userId: current.ownerId,
              },
            },
          });
          if (membership?.id !== current.membershipId)
            throw new TRPCError({ code: "FORBIDDEN" });
          const runId = digest(
            `${current.id}:${current.nextRunAt.toISOString()}`,
          );
          if (
            await tx.projectReportScheduleRun.findUnique({
              where: { id: runId },
            })
          )
            return;
          const config = reportScheduleConfigSchema.parse(current.config);
          const report = await captureReportPreview(
            tx,
            current.organizationId,
            current.ownerId,
            {
              projectId: current.projectId,
              requestId: runId,
              title: current.name,
              definition: config.definition,
            },
          );
          await tx.projectReportScheduleRun.create({
            data: {
              id: runId,
              scheduleId: current.id,
              scheduledFor: current.nextRunAt,
              scheduleVersion: current.version,
              status: "CAPTURED",
              deliveryStatus: config.delivery === "slack" ? "PENDING" : "NOT_REQUESTED",
              snapshotId: report.id,
              completedAt: now,
            },
          });
          // One catch-up capture represents current data. Never fabricate historical reports.
          await tx.projectReportSchedule.update({
            where: { id: current.id },
            data: { nextRunAt: nextReportOccurrence(config, now) },
          });
          await tx.auditLog.create({
            data: {
              organizationId: current.organizationId,
              projectId: current.projectId,
              actorId: current.ownerId,
              summary: "Captured scheduled private report",
              action: "CREATE",
              entityType: "ProjectReportScheduleRun",
              entityId: runId,
              metadata: {
                snapshotId: report.id,
                scheduledFor: current.nextRunAt.toISOString(),
                scheduleVersion: current.version,
                approval: "private-preview",
              },
            },
          });
        },
        { isolationLevel: "RepeatableRead", timeout: 20000 },
      );
    } catch (error) {
      // Serialization/deadlock/unique races are retried on the next tick without disabling the mandate.
      const code =
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : "";
      if (["P2034", "P2002"].includes(code)) continue;
      const failureCode =
        error instanceof TRPCError && error.code === "FORBIDDEN"
          ? "ACCESS_CHANGED"
          : "CAPTURE_FAILED";
      await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Organization" WHERE id=${candidate.organizationId} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM "ProjectReportSchedule" WHERE id=${candidate.id} FOR UPDATE`;
        const current = await tx.projectReportSchedule.findUnique({
          where: { id: candidate.id },
        });
        if (
          !current ||
          !current.enabled ||
          current.version !== candidate.version ||
          current.nextRunAt.getTime() !== candidate.nextRunAt.getTime()
        )
          return;
        const runId = digest(
          `${current.id}:${current.nextRunAt.toISOString()}`,
        );
        if (
          await tx.projectReportScheduleRun.findUnique({ where: { id: runId } })
        )
          return;
        await tx.projectReportScheduleRun.create({
          data: {
            id: runId,
            scheduleId: current.id,
            scheduledFor: current.nextRunAt,
            scheduleVersion: current.version,
            status: "FAILED",
            failureCode,
            completedAt: now,
          },
        });
        await tx.projectReportSchedule.update({
          where: { id: current.id },
          data: {
            enabled: false,
            pauseReason: failureCode,
            version: { increment: 1 },
          },
        });
      });
    }
  }
}

export function startReportScheduleWorker() {
  let busy = false;
  const tick = createSafeSchedulerRunner("report-schedule", async () => {
    if (busy) return;
    busy = true;
    try {
      recordHeartbeat("reportScheduleWorker");
      await runDueReportSchedules();
      await deliverPendingReports(prisma);
    } catch {
      throw new Error(
        "Scheduled reporting is unavailable; inspect the private run receipts.",
      );
    } finally {
      busy = false;
    }
  });
  const timer = setInterval(() => {
    void tick();
  }, REPORT_SCHEDULE_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
