import { createHash, randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { Prisma } from "@vaettir/db";
import { buildQualityVisualReport } from "@vaettir/core";
import {
  protectedProcedure,
  router,
  requireProjectAccess,
  type Context,
} from "../trpc.js";
import {
  lockedProcessingEditor,
  lockedProcessingReader,
} from "../services/repositoryProcessingApproval.js";
import { readReportMetric } from "../services/reportMetricQuery.js";
import { captureReportPreview } from "./reportSnapshots.js";
import {
  dashboardConfigSchema,
  dashboardPreviewInput,
  dashboardReadInput,
  dashboardSaveInput,
  nextReportOccurrence,
  reportScheduleConfigSchema,
  reportWorkflowListInput,
  scheduleSaveInput,
} from "../services/reportWorkflowSchema.js";

type Actor = Context & { user: NonNullable<Context["user"]> };
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function access<T>(
  ctx: Actor,
  input: { projectId: string; expectedClerkActorId: string },
  write: boolean,
  action: (tx: Prisma.TransactionClient, orgId: string) => Promise<T>,
) {
  if (
    !ctx.authenticatedClerkSubject ||
    ctx.authenticatedApiKeyId ||
    ctx.authenticatedClerkSubject !== input.expectedClerkActorId
  )
    throw new TRPCError({ code: "FORBIDDEN" });
  const { project } = await requireProjectAccess(
    ctx,
    input.projectId,
    write ? "EDITOR" : "VIEWER",
  );
  return ctx.prisma.$transaction(
    async (tx) => {
      await (write ? lockedProcessingEditor : lockedProcessingReader)(
        tx,
        project.organizationId,
        ctx.user.id,
        input.projectId,
      );
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${ctx.user.id} FOR SHARE`;
      const user = await tx.user.findUnique({
        where: { id: ctx.user.id },
        select: { clerkUserId: true },
      });
      if (user?.clerkUserId !== ctx.authenticatedClerkSubject)
        throw new TRPCError({ code: "FORBIDDEN" });
      return action(tx, project.organizationId);
    },
    { isolationLevel: "RepeatableRead", timeout: 20000 },
  );
}
async function liveDashboard(
  tx: Prisma.TransactionClient,
  orgId: string,
  actorId: string,
  projectId: string,
  raw: unknown,
) {
  const config = dashboardConfigSchema.parse(raw);
  const report = await captureReportPreview(
    tx,
    orgId,
    actorId,
    {
      projectId,
      requestId: randomUUID(),
      title: "Live dashboard",
      definition: config.definition,
    },
    false,
  );
  const visuals = buildQualityVisualReport(report.payload);
  return {
    asOf: report.asOf,
    columns: config.columns,
    widgets: await Promise.all(
      config.widgets.map(async (widget) => ({
        ...widget,
        visual: widget.query
          ? await readReportMetric(
              tx,
              projectId,
              widget.query,
              config.definition.windowDays,
              report.asOf,
              widget.id,
            )
          : (visuals.charts.find((chart) => chart.id === widget.id) ?? null),
      })),
    ),
    limitations: report.payload.limitations,
  };
}
export const reportWorkflowsRouter = router({
  list: protectedProcedure
    .input(reportWorkflowListInput)
    .query(({ ctx, input }) =>
      access(ctx, input, false, async (tx, orgId) => {
        const [dashboards, schedules] = await Promise.all([
          tx.projectReportDashboard.findMany({
            where: {
              projectId: input.projectId,
              organizationId: orgId,
              OR: [
                { ownerId: ctx.user.id },
                { visibility: "project", archived: false },
              ],
            },
            orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
            take: 101,
          }),
          tx.projectReportSchedule.findMany({
            where: {
              projectId: input.projectId,
              organizationId: orgId,
              ownerId: ctx.user.id,
            },
            orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
            take: 101,
            include: { runs: { orderBy: { scheduledFor: "desc" }, take: 10 } },
          }),
        ]);
        if (dashboards.length > 100 || schedules.length > 100)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Reporting catalog exceeds its supported size.",
          });
        return {
          projectId: input.projectId,
          organizationId: orgId,
          clerkActorId: ctx.authenticatedClerkSubject!,
          dashboards: dashboards.map((row) => ({
            ...row,
            editable: row.ownerId === ctx.user.id,
            config: dashboardConfigSchema.parse(row.config),
          })),
          schedules: schedules.map((row) => ({
            ...row,
            config: reportScheduleConfigSchema.parse(row.config),
          })),
        };
      }),
    ),
  preview: protectedProcedure
    .input(dashboardPreviewInput)
    .query(({ ctx, input }) =>
      access(ctx, input, false, async (tx, orgId) => ({
        projectId: input.projectId,
        organizationId: orgId,
        clerkActorId: ctx.authenticatedClerkSubject!,
        configKey: hash(input.config),
        ...(await liveDashboard(
          tx,
          orgId,
          ctx.user.id,
          input.projectId,
          input.config,
        )),
      })),
    ),
  read: protectedProcedure.input(dashboardReadInput).query(({ ctx, input }) =>
    access(ctx, input, false, async (tx, orgId) => {
      const row = await tx.projectReportDashboard.findFirst({
        where: {
          id: input.id,
          projectId: input.projectId,
          organizationId: orgId,
          archived: false,
          OR: [{ ownerId: ctx.user.id }, { visibility: "project" }],
        },
      });
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      return {
        projectId: input.projectId,
        organizationId: orgId,
        clerkActorId: ctx.authenticatedClerkSubject!,
        id: row.id,
        version: row.version,
        name: row.name,
        ...(await liveDashboard(
          tx,
          orgId,
          ctx.user.id,
          input.projectId,
          row.config,
        )),
      };
    }),
  ),
  saveDashboard: protectedProcedure
    .input(dashboardSaveInput)
    .mutation(({ ctx, input }) =>
      access(ctx, input, true, async (tx, orgId) => {
        const previous = await tx.projectReportDashboard.findUnique({
            where: { id: input.id },
          }),
          requestHash = hash(input);
        if (
          previous &&
          (previous.projectId !== input.projectId ||
            previous.organizationId !== orgId ||
            previous.ownerId !== ctx.user.id)
        )
          throw new TRPCError({ code: "NOT_FOUND" });
        if (previous?.lastRequestId === input.requestId) {
          if (previous.lastRequestHash !== requestHash)
            throw new TRPCError({ code: "CONFLICT" });
          return { id: previous.id, version: previous.version };
        }
        if ((previous?.version ?? 0) !== input.expectedVersion)
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "This dashboard changed. Reload before saving your changes.",
          });
        if (
          !previous &&
          (await tx.projectReportDashboard.count({
            where: { projectId: input.projectId },
          })) >= 100
        )
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Dashboard limit reached.",
          });
        const data = {
          name: input.name,
          config: input.config,
          visibility: input.visibility,
          archived: input.archived,
          lastRequestId: input.requestId,
          lastRequestHash: requestHash,
          version: input.expectedVersion + 1,
        };
        const row = previous
          ? await tx.projectReportDashboard.update({
              where: { id: input.id },
              data,
            })
          : await tx.projectReportDashboard.create({
              data: {
                ...data,
                id: input.id,
                projectId: input.projectId,
                organizationId: orgId,
                ownerId: ctx.user.id,
              },
            });
        await tx.auditLog.create({
          data: {
            organizationId: orgId,
            projectId: input.projectId,
            actorId: ctx.user.id,
            summary: "Updated reporting workflow",
            action: "UPDATE",
            entityType: "ProjectReportDashboard",
            entityId: row.id,
            metadata: {
              version: row.version,
              requestId: input.requestId,
              visibility: row.visibility,
              archived: row.archived,
            },
          },
        });
        return { id: row.id, version: row.version };
      }),
    ),
  saveSchedule: protectedProcedure
    .input(scheduleSaveInput)
    .mutation(({ ctx, input }) =>
      access(ctx, input, true, async (tx, orgId) => {
        const previous = await tx.projectReportSchedule.findUnique({
            where: { id: input.id },
          }),
          requestHash = hash(input);
        if (
          previous &&
          (previous.projectId !== input.projectId ||
            previous.organizationId !== orgId ||
            previous.ownerId !== ctx.user.id)
        )
          throw new TRPCError({ code: "NOT_FOUND" });
        if (previous?.lastRequestId === input.requestId) {
          if (previous.lastRequestHash !== requestHash)
            throw new TRPCError({ code: "CONFLICT" });
          return {
            id: previous.id,
            version: previous.version,
            enabled: previous.enabled,
            pauseReason: previous.pauseReason,
          };
        }
        if ((previous?.version ?? 0) !== input.expectedVersion)
          throw new TRPCError({
            code: "CONFLICT",
            message: "This schedule changed. Reload before saving.",
          });
        if (
          !previous &&
          (await tx.projectReportSchedule.count({
            where: { projectId: input.projectId },
          })) >= 100
        )
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Schedule limit reached.",
          });
        const [clock] = await tx.$queryRaw<
          Array<{ now: Date }>
        >`SELECT transaction_timestamp() AS now`;
        if (!clock) throw new Error("Clock unavailable");
        const member = await tx.membership.findUniqueOrThrow({
          where: {
            organizationId_userId: {
              organizationId: orgId,
              userId: ctx.user.id,
            },
          },
        });
        const data = {
          pauseReason: null,
          membershipId: member.id,
          name: input.name,
          config: input.config,
          enabled: input.enabled,
          nextRunAt: nextReportOccurrence(input.config, clock.now),
          version: input.expectedVersion + 1,
          lastRequestId: input.requestId,
          lastRequestHash: requestHash,
        };
        const row = previous
          ? await tx.projectReportSchedule.update({
              where: { id: input.id },
              data,
            })
          : await tx.projectReportSchedule.create({
              data: {
                ...data,
                id: input.id,
                projectId: input.projectId,
                organizationId: orgId,
                ownerId: ctx.user.id,
              },
            });
        await tx.auditLog.create({
          data: {
            organizationId: orgId,
            projectId: input.projectId,
            actorId: ctx.user.id,
            summary: "Updated reporting workflow",
            action: "UPDATE",
            entityType: "ProjectReportSchedule",
            entityId: row.id,
            metadata: {
              version: row.version,
              enabled: row.enabled,
              requestId: input.requestId,
              publication: "private-preview",
            },
          },
        });
        return {
          id: row.id,
          version: row.version,
          enabled: row.enabled,
          pauseReason: row.pauseReason,
        };
      }),
    ),
});
