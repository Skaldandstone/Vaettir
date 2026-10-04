import { createHash } from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { Prisma } from "@vaettir/db";
import {
  protectedProcedure,
  requireProjectAccess,
  router,
  type Context,
} from "../trpc.js";
import { liveEditor } from "./jiraConnections.js";
import { reportCatalogInput } from "../services/reportCatalogSchema.js";
import { readReportCatalog } from "../services/reportCatalog.js";
import { reportDefinitionSchema } from "../services/reportDefinitionSchema.js";
import {
  compareApprovedReports,
  reportComparisonInput,
} from "../services/reportComparison.js";
import {
  reportDefinitionListInput,
  reportDefinitionHistoryInput,
  reportDefinitionManageInput,
} from "../services/reportDefinitionLifecycleSchema.js";
import {
  reportDefinitionList,
  reportDefinitionHistory,
  manageReportDefinition,
  retainedReportDefinitionState,
} from "../services/reportDefinitionLifecycle.js";
import {
  reportExecutionScopeSchema,
  reportRunWhere,
  reportWindow,
} from "./reportSnapshotScope.js";
import { testPlanExecutionTemplateSchema } from "../services/qualityExperienceProfile.js";
import {
  capturedReportEvidence,
  reportEvidenceSchema,
} from "./reportSnapshotEvidence.js";

const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const projectInput = z
  .object({ projectId: z.string().min(1).max(120) })
  .strict();
export { reportDefinitionSchema };
const counts = z.array(
  z.object({ key: z.string(), count: z.number().int().nonnegative() }),
);
const payloadSchema = z.object({
  state: z.enum(["preview", "approved"]),
  projectName: z.string(),
  title: z.string(),
  definition: reportDefinitionSchema,
  asOf: z.string().datetime(),
  windowStart: z.string().datetime(),
  windowEnd: z.string().datetime().optional(),
  scope: z
    .object({
      kind: z.enum(["project", "recorded-execution"]),
      filters: reportExecutionScopeSchema.optional(),
      planName: z.string().nullable(),
      contributingRunIds: z.array(z.string()).max(20000),
      cohortBasis: z.string(),
    })
    .optional(),
  inventory: z.object({
    active: z.number(),
    riskAssessed: z.number(),
    flaky: z.number(),
    automation: counts,
    priority: counts,
  }),
  execution: z.object({
    runs: z.number(),
    results: z.number(),
    outcomes: counts,
    distinctCases: z.number(),
    highPriorityCases: z.number(),
    highPriorityExecuted: z.number(),
    matchedResults: z.number().optional(),
    unmatchedResults: z.number().optional(),
    plannedCaseRunPairs: z.number().optional(),
    notRecordedCaseRunPairs: z.number().optional(),
  }),
  traceability: z.object({
    requirements: z.number(),
    coveredRequirements: z.number(),
    casesWithLinks: z.number(),
    links: z.number(),
  }),
  defects: z
    .object({
      clusters: z.number(),
      confirmed: z.number(),
      suggested: z.number(),
      unavailableSources: z.number(),
    })
    .nullable(),
  cohort: z.array(z.object({ id: z.string(), status: z.string() })).max(20000),
  evidence: reportEvidenceSchema.optional(),
  automationChange: z
    .object({
      baselineId: z.string(),
      baselineAsOf: z.string(),
      commonCases: z.number(),
      becameAutomated: z.number(),
      noLongerAutomated: z.number(),
      addedCases: z.number(),
      removedCases: z.number(),
      elapsedDays: z.number(),
    })
    .nullable(),
  limitations: z.array(z.string()),
});
export type FrozenReportPayload = z.infer<typeof payloadSchema>;
type Actor = Context & { user: NonNullable<Context["user"]> };
const conflict = () =>
  new TRPCError({
    code: "CONFLICT",
    message: "The report changed. Refresh before saving.",
  });

async function access<T>(
  ctx: Actor,
  projectId: string,
  write: boolean,
  action: (tx: Prisma.TransactionClient, orgId: string) => Promise<T>,
) {
  const { project } = await requireProjectAccess(
    ctx,
    projectId,
    write ? "EDITOR" : "VIEWER",
  );
  return ctx.prisma.$transaction(
    async (tx) => {
      if (write) await liveEditor(tx, project.organizationId, ctx.user.id);
      else {
        await tx.$queryRaw`SELECT id FROM "Organization" WHERE id=${project.organizationId} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM "Membership" WHERE "organizationId"=${project.organizationId} AND "userId"=${ctx.user.id} FOR UPDATE`;
        const member = await tx.membership.findUnique({
          where: {
            organizationId_userId: {
              organizationId: project.organizationId,
              userId: ctx.user.id,
            },
          },
        });
        const org = await tx.organization.findUnique({
          where: { id: project.organizationId },
          select: { suspendedAt: true },
        });
        if (!member || !org || org.suspendedAt)
          throw new TRPCError({ code: "FORBIDDEN" });
      }
      const rows = await tx.$queryRaw<
        Array<{ organizationId: string }>
      >`SELECT "organizationId" FROM "Project" WHERE id=${projectId} FOR UPDATE`;
      if (rows[0]?.organizationId !== project.organizationId)
        throw new TRPCError({ code: "FORBIDDEN" });
      return action(tx, project.organizationId);
    },
    { isolationLevel: "RepeatableRead", timeout: 20000 },
  );
}
function buckets(
  rows: Array<{
    _count: { _all: number };
    status?: string;
    priority?: string;
    automationStatus?: string;
  }>,
  field: "status" | "priority" | "automationStatus",
) {
  return rows
    .map((row) => ({ key: row[field]!, count: row._count._all }))
    .sort((a, b) => a.key.localeCompare(b.key));
}
const output = (row: {
  id: string;
  payload: Prisma.JsonValue;
  asOf: Date;
}) => ({
  id: row.id,
  asOf: row.asOf,
  payload: payloadSchema.parse(row.payload),
});

export const reportSnapshotsRouter = router({
  definitionCatalog: protectedProcedure
    .input(reportDefinitionListInput)
    .query(({ ctx, input }) =>
      access(ctx, input.projectId, false, (tx, orgId) =>
        reportDefinitionList(
          tx,
          input.projectId,
          orgId,
          ctx.user.id,
          input.page,
          input.includeArchived,
        ),
      ),
    ),
  definitionHistory: protectedProcedure
    .input(reportDefinitionHistoryInput)
    .query(({ ctx, input }) =>
      access(ctx, input.projectId, false, (tx, orgId) =>
        reportDefinitionHistory(
          tx,
          input.projectId,
          orgId,
          ctx.user.id,
          input.id,
          input.page,
          (value) => reportDefinitionSchema.parse(value),
        ),
      ),
    ),
  manageDefinition: protectedProcedure
    .input(reportDefinitionManageInput)
    .mutation(({ ctx, input }) =>
      access(ctx, input.projectId, true, (tx, orgId) =>
        manageReportDefinition(tx, orgId, ctx.user.id, input, (value) =>
          reportDefinitionSchema.parse(value),
        ),
      ),
    ),
  compare: protectedProcedure
    .input(reportComparisonInput)
    .query(({ ctx, input }) =>
      access(ctx, input.projectId, false, async (tx, orgId) => {
        const rows = await tx.projectReportSnapshot.findMany({
          where: {
            id: { in: [input.baselineId, input.targetId] },
            projectId: input.projectId,
            organizationId: orgId,
            payload: { path: ["state"], equals: "approved" },
          },
          select: { id: true, payload: true },
        });
        if (rows.length !== 2)
          throw new TRPCError({
            code: "NOT_FOUND",
            message:
              "Both approved snapshots must be available in this project.",
          });
        const before = rows.find((row) => row.id === input.baselineId)!;
        const after = rows.find((row) => row.id === input.targetId)!;
        try {
          return {
            projectId: input.projectId,
            ...compareApprovedReports(
              { id: before.id, payload: payloadSchema.parse(before.payload) },
              { id: after.id, payload: payloadSchema.parse(after.payload) },
            ),
          };
        } catch {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Cannot compare these captures: choose an earlier approved baseline with the same exact scope and at least one selected section in common. Unsupported legacy metrics must be reviewed in their original reports.",
          });
        }
      }),
    ),
  catalog: protectedProcedure
    .input(reportCatalogInput)
    .query(({ ctx, input }) =>
      access(ctx, input.projectId, false, (tx, orgId) =>
        readReportCatalog(tx, orgId, input),
      ),
    ),
  scopeOptions: protectedProcedure.input(projectInput).query(({ ctx, input }) =>
    access(ctx, input.projectId, false, async (tx) => {
      const [plans, runs] = await Promise.all([
        tx.$queryRaw<Array<{ id: string; name: string; nameExcerpt: boolean }>>`
          SELECT id, left(name, 160) AS name, length(name) > 160 AS "nameExcerpt"
          FROM "TestPlan" WHERE "projectId" = ${input.projectId}
          ORDER BY name ASC, id ASC LIMIT 101`,
        tx.$queryRaw<
          Array<{
            id: string;
            startedAt: Date;
            ciProvider: string;
            providerExcerpt: boolean;
            build: string | null;
            platform: string | null;
            environment: string | null;
          }>
        >`
          SELECT id, "startedAt", left("ciProvider", 100) AS "ciProvider",
            length("ciProvider") > 100 AS "providerExcerpt",
            CASE WHEN "ciProvider" = 'manual' THEN
              CASE WHEN "executionContext"->'version' = '1'::jsonb THEN left("executionContext"->'configuration'->>'build', 300) END
              ELSE left("commitSha", 300) END AS build,
            CASE WHEN "executionContext"->'version' = '1'::jsonb THEN left("executionContext"->'configuration'->>'platform', 300) END AS platform,
            CASE WHEN "executionContext"->'version' = '1'::jsonb THEN left("executionContext"->'configuration'->>'environment', 2000) END AS environment
          FROM "TestRun" WHERE "projectId" = ${input.projectId}
          ORDER BY "startedAt" DESC, id DESC LIMIT 101`,
      ]);
      return {
        plans: plans.slice(0, 100),
        runs: runs.slice(0, 100),
        plansLimited: plans.length > 100,
        runsLimited: runs.length > 100,
      };
    }),
  ),
  definitions: protectedProcedure.input(projectInput).query(({ ctx, input }) =>
    access(ctx, input.projectId, false, async (tx, orgId) => {
      const rows = await tx.projectReportDefinition.findMany({
        where: {
          projectId: input.projectId,
          organizationId: orgId,
          OR: [{ userId: ctx.user.id }, { visibility: "project" }],
          archivedAt: null,
        },
        orderBy: { updatedAt: "desc" },
        take: 100,
      });
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        version: row.version,
        visibility: row.visibility,
        definition: reportDefinitionSchema.parse(row.definition),
      }));
    }),
  ),
  saveDefinition: protectedProcedure
    .input(
      projectInput
        .extend({
          requestId: z.string().uuid(),
          id: z.string().optional(),
          version: z.number().int().positive().optional(),
          name: z.string().trim().min(1).max(80),
          definition: reportDefinitionSchema,
        })
        .refine(
          (v) => !!v.id === !!v.version,
          "Updating needs the original version",
        ),
    )
    .mutation(({ ctx, input }) =>
      access(ctx, input.projectId, true, async (tx, orgId) => {
        const key = hash([input.projectId, ctx.user.id, input.requestId]);
        const requestHash = hash([
          input.id ?? null,
          input.version ?? null,
          input.name,
          input.definition,
        ]);
        const receipt = await tx.projectReportDefinitionWrite.findUnique({
          where: { key },
        });
        if (receipt) {
          if (
            receipt.organizationId !== orgId ||
            receipt.requestHash !== requestHash
          )
            throw conflict();
          return { id: receipt.definitionId, version: receipt.appliedVersion };
        }
        if (
          (await tx.projectReportDefinitionWrite.count({
            where: { projectId: input.projectId },
          })) >= 2000
        )
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "Definition retry retention limit reached. Existing definitions remain saved.",
          });
        const record = async (
          id: string,
          version: number,
          beforeState?: ReturnType<typeof retainedReportDefinitionState>,
        ) => {
          const saved = await tx.projectReportDefinition.findFirstOrThrow({
            where: { id, projectId: input.projectId, organizationId: orgId },
          });
          await tx.projectReportDefinitionWrite.create({
            data: {
              key,
              projectId: input.projectId,
              organizationId: orgId,
              actorId: ctx.user.id,
              requestHash,
              definitionId: id,
              appliedVersion: version,
              ...(beforeState ? { beforeState } : {}),
              afterState: retainedReportDefinitionState(saved, (value) =>
                reportDefinitionSchema.parse(value),
              ),
            },
          });
          return { id, version };
        };
        if (input.id) {
          const priorBody = await tx.projectReportDefinition.findFirst({
            where: {
              id: input.id,
              projectId: input.projectId,
              organizationId: orgId,
              userId: ctx.user.id,
              visibility: "private",
              archivedAt: null,
              version: input.version,
            },
          });
          if (!priorBody) throw conflict();
          const changed = await tx.projectReportDefinition.updateMany({
            where: {
              id: input.id,
              projectId: input.projectId,
              organizationId: orgId,
              userId: ctx.user.id,
              version: input.version,
              visibility: "private",
              archivedAt: null,
            },
            data: {
              name: input.name,
              definition: input.definition,
              version: { increment: 1 },
            },
          });
          if (changed.count !== 1) throw conflict();
          return record(
            input.id,
            input.version! + 1,
            retainedReportDefinitionState(priorBody, (value) =>
              reportDefinitionSchema.parse(value),
            ),
          );
        }
        const id = hash([
          "definition",
          input.projectId,
          ctx.user.id,
          input.requestId,
        ]);
        const prior = await tx.projectReportDefinition.findUnique({
          where: { id },
        });
        if (prior) {
          if (
            prior.organizationId !== orgId ||
            prior.visibility !== "private" ||
            prior.archivedAt !== null ||
            prior.name !== input.name ||
            hash(reportDefinitionSchema.parse(prior.definition)) !==
              hash(input.definition)
          )
            throw conflict();
          return record(id, prior.version);
        }
        if (
          (await tx.projectReportDefinition.count({
            where: { projectId: input.projectId, userId: ctx.user.id },
          })) >= 50
        )
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "Keep at most 50 retained report definitions per author, including archives.",
          });
        await tx.projectReportDefinition.create({
          data: {
            id,
            projectId: input.projectId,
            organizationId: orgId,
            userId: ctx.user.id,
            name: input.name,
            definition: input.definition,
          },
        });
        return record(id, 1);
      }),
    ),
  drafts: protectedProcedure.input(projectInput).query(({ ctx, input }) =>
    access(ctx, input.projectId, false, async (tx, orgId) =>
      tx.projectReportSnapshot.findMany({
        where: {
          projectId: input.projectId,
          organizationId: orgId,
          createdById: ctx.user.id,
          payload: { path: ["state"], equals: "preview" },
        },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        take: 25,
        select: { id: true, title: true, asOf: true },
      }),
    ),
  ),
  list: protectedProcedure.input(projectInput).query(({ ctx, input }) =>
    access(ctx, input.projectId, false, async (tx, orgId) =>
      tx.projectReportSnapshot.findMany({
        where: {
          projectId: input.projectId,
          organizationId: orgId,
          payload: { path: ["state"], equals: "approved" },
        },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        take: 50,
        select: { id: true, title: true, asOf: true, createdAt: true },
      }),
    ),
  ),
  get: protectedProcedure
    .input(projectInput.extend({ id: z.string().max(64) }))
    .query(({ ctx, input }) =>
      access(ctx, input.projectId, false, async (tx, orgId) => {
        const row = await tx.projectReportSnapshot.findFirst({
          where: {
            id: input.id,
            projectId: input.projectId,
            organizationId: orgId,
          },
        });
        if (!row) throw new TRPCError({ code: "NOT_FOUND" });
        const result = output(row);
        if (
          result.payload.state === "preview" &&
          row.createdById !== ctx.user.id
        )
          throw new TRPCError({ code: "NOT_FOUND" });
        return {
          ...result,
          projectId: row.projectId,
          organizationId: row.organizationId,
        };
      }),
    ),
  evidence: protectedProcedure
    .input(
      projectInput.extend({
        id: z.string().length(64),
        kind: z.enum(["cases", "runs"]),
        page: z.number().int().min(0).max(400).default(0),
      }),
    )
    .query(({ ctx, input }) =>
      access(ctx, input.projectId, false, async (tx, orgId) => {
        const row = await tx.projectReportSnapshot.findFirst({
          where: {
            id: input.id,
            projectId: input.projectId,
            organizationId: orgId,
          },
        });
        if (!row) throw new TRPCError({ code: "NOT_FOUND" });
        const payload = payloadSchema.parse(row.payload);
        if (payload.state === "preview" && row.createdById !== ctx.user.id)
          throw new TRPCError({ code: "NOT_FOUND" });
        const start = input.page * 50;
        if (input.kind === "cases") {
          const all =
            payload.evidence?.cases ??
            payload.cohort.map((c) => ({
              id: c.id,
              displayId: "",
              automationStatus: c.status,
              priority: null,
              outcomes: null,
              plannedRuns: null,
              notRecordedRuns: null,
            }));
          const items = all.slice(start, start + 50);
          const current = await tx.testCase.findMany({
            where: {
              projectId: input.projectId,
              id: { in: items.map((c) => c.id) },
            },
            select: { id: true },
          });
          const available = new Set(current.map((c) => c.id));
          return {
            kind: "cases" as const,
            total: all.length,
            page: input.page,
            complete: !!payload.evidence,
            asOf: payload.asOf,
            items: items.map((c, index) => ({
              ...c,
              id: available.has(c.id) ? c.id : null,
              referenceIndex: start + index + 1,
              available: available.has(c.id),
            })),
          };
        }
        const all =
          payload.evidence?.runs ??
          (payload.scope?.contributingRunIds ?? []).map((id) => ({
            id,
            startedAt: null,
            provider: null,
            outcomes: null,
            plannedCases: null,
            notRecordedCases: null,
          }));
        const items = all.slice(start, start + 50);
        const current = await tx.testRun.findMany({
          where: {
            projectId: input.projectId,
            id: { in: items.map((r) => r.id) },
          },
          select: { id: true },
        });
        const available = new Set(current.map((r) => r.id));
        return {
          kind: "runs" as const,
          total: all.length,
          page: input.page,
          complete: !!payload.evidence,
          asOf: payload.asOf,
          items: items.map((r, index) => ({
            ...r,
            id: available.has(r.id) ? r.id : null,
            referenceIndex: start + index + 1,
            available: available.has(r.id),
          })),
        };
      }),
    ),
  preview: protectedProcedure
    .input(
      projectInput.extend({
        requestId: z.string().uuid(),
        title: z.string().trim().min(1).max(120),
        definition: reportDefinitionSchema,
        definitionId: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      access(ctx, input.projectId, true, async (tx, orgId) => {
        const id = hash([input.projectId, ctx.user.id, input.requestId]);
        const inputHash = hash([
          input.title,
          input.definition,
          input.definitionId ?? null,
        ]);
        const prior = await tx.projectReportSnapshot.findUnique({
          where: { id },
        });
        if (prior) {
          if (prior.organizationId !== orgId || prior.inputHash !== inputHash)
            throw conflict();
          return output(prior);
        }
        if (
          (await tx.projectReportSnapshot.count({
            where: { projectId: input.projectId },
          })) >= 500
        )
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "This project reached its 500 retained preview/snapshot limit. Existing reports are retained.",
          });
        if (input.definitionId) {
          const saved = await tx.projectReportDefinition.findFirst({
            where: {
              id: input.definitionId,
              projectId: input.projectId,
              organizationId: orgId,
              OR: [{ userId: ctx.user.id }, { visibility: "project" }],
              archivedAt: null,
            },
          });
          if (
            !saved ||
            hash(reportDefinitionSchema.parse(saved.definition)) !==
              hash(input.definition)
          )
            throw conflict();
        }
        const [clock] = await tx.$queryRaw<
          Array<{ asOf: Date }>
        >`SELECT transaction_timestamp() AS "asOf"`;
        if (!clock) throw new Error("Report clock unavailable");
        const asOf = clock.asOf;
        const traceState = await tx.caseTraceabilityState.findUnique({
          where: { projectId: input.projectId },
          select: { organizationId: true },
        });
        if (traceState && traceState.organizationId !== orgId)
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Traceability evidence belongs to a previous workspace.",
          });
        let window;
        try {
          window = reportWindow(
            asOf,
            input.definition.windowDays,
            input.definition.dateInterval,
          );
        } catch {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Report dates cannot be in the future.",
          });
        }
        const windowStart = window.start;
        const scope = input.definition.executionScope;
        const selectedPlan = scope?.planId
          ? await tx.testPlan.findFirst({
              where: { id: scope.planId, projectId: input.projectId },
              select: {
                name: true,
                executionTemplate: true,
                testCases: { select: { id: true }, take: 20001 },
              },
            })
          : null;
        if (scope?.planId && !selectedPlan)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Plan not found in this project.",
          });
        if (
          scope?.runId &&
          !(await tx.testRun.findFirst({
            where: { id: scope.runId, projectId: input.projectId },
            select: { id: true },
          }))
        )
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Run not found in this project.",
          });
        const runWhere = reportRunWhere(
          input.projectId,
          window.start,
          window.end,
          scope,
        );
        const matchingRuns = await tx.testRun.findMany({
          where: runWhere,
          select: { id: true },
          orderBy: { id: "asc" },
          take: 20001,
        });
        if (matchingRuns.length > 20000)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "Run scope exceeds 20,000 runs; narrow the window. No partial report retained.",
          });
        const runIds = matchingRuns.map((row) => row.id);
        const plannedSize = runIds.length
          ? await tx.$queryRaw<Array<{ count: bigint; providerBytes: number }>>(
              Prisma.sql`SELECT COALESCE(sum(cardinality("manualTestCaseIds")), 0)::bigint AS count, COALESCE(max(octet_length("ciProvider")),0)::integer AS "providerBytes" FROM "TestRun" WHERE id IN (${Prisma.join(runIds)})`,
            )
          : [{ count: 0n, providerBytes: 0 }];
        if (plannedSize[0]!.providerBytes > 200)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "Recorded provider label exceeds the report evidence bound. Review the imported metadata; no partial report retained.",
          });
        if (plannedSize[0]!.count > 100000n)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "Planned case scope exceeds 100,000 pairs; narrow the window.",
          });
        const contributingRuns = await tx.testRun.findMany({
          where: { projectId: input.projectId, id: { in: runIds } },
          select: {
            id: true,
            manualTestCaseIds: true,
            startedAt: true,
            ciProvider: true,
          },
          orderBy: { id: "asc" },
        });
        const scopedIds = new Set(
          contributingRuns.flatMap((run) => run.manualTestCaseIds),
        );
        if (scope) {
          const linked = await tx.testResult.groupBy({
            by: ["testCaseId"],
            where: {
              testRun: runWhere,
              testCase: { projectId: input.projectId },
            },
            orderBy: { testCaseId: "asc" },
            take: 20001,
          });
          for (const row of linked)
            if (row.testCaseId) scopedIds.add(row.testCaseId);
          if (selectedPlan) {
            for (const row of selectedPlan.testCases) scopedIds.add(row.id);
            const template = testPlanExecutionTemplateSchema.safeParse(
              selectedPlan.executionTemplate,
            );
            if (template.success)
              for (const id of template.data.testCaseIds) scopedIds.add(id);
            else if (
              !selectedPlan.executionTemplate ||
              typeof selectedPlan.executionTemplate !== "object" ||
              Array.isArray(selectedPlan.executionTemplate) ||
              Object.keys(selectedPlan.executionTemplate).length > 0
            )
              throw new TRPCError({
                code: "PRECONDITION_FAILED",
                message:
                  "The selected plan's saved case scope is unsupported; review it before reporting.",
              });
          }
          if (scopedIds.size > 20000 || linked.length > 20000)
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message:
                "Case scope exceeds 20,000 identities; no partial report retained.",
            });
        }
        const where: Prisma.TestCaseWhereInput = {
          projectId: input.projectId,
          archived: false,
          ...(scope ? { id: { in: [...scopedIds] } } : {}),
        };
        const resultIdentities = await tx.testResult.groupBy({
          by: ["testRunId", "testCaseId"],
          where: { testRun: runWhere, testCaseId: { not: null } },
          orderBy: [{ testRunId: "asc" }, { testCaseId: "asc" }],
          take: 100001,
        });
        if (resultIdentities.length > 100000)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "Planned-result scope exceeds 100,000 pairs; narrow the window.",
          });
        const recordedPairs = new Set(
          resultIdentities.map((row) => `${row.testRunId}:${row.testCaseId}`),
        );
        const plannedPairs = contributingRuns.flatMap((run) =>
          [...new Set(run.manualTestCaseIds)].map((id) => `${run.id}:${id}`),
        );
        if (plannedPairs.length > 100000)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "Planned case scope exceeds 100,000 pairs; narrow the window.",
          });
        const requirementWhere: Prisma.RequirementWhereInput = {
          projectId: input.projectId,
          ...(scope
            ? {
                caseTraceabilityLinks: {
                  some: { removedAt: null, testCase: where },
                },
              }
            : {}),
        };
        const [
          project,
          cohort,
          riskAssessed,
          flaky,
          priority,
          runs,
          results,
          outcomes,
          executed,
          highPriorityCases,
          highPriorityExecuted,
          requirements,
          coveredRequirements,
          links,
          linkedCases,
          defectState,
          baseline,
        ] = await Promise.all([
          tx.project.findUniqueOrThrow({
            where: { id: input.projectId },
            select: { name: true },
          }),
          tx.testCase.findMany({
            where,
            orderBy: { id: "asc" },
            take: 20001,
            select: {
              id: true,
              automationStatus: true,
              displayId: true,
              priority: true,
            },
          }),
          tx.testCase.count({
            where: { ...where, riskAssessedAt: { not: null } },
          }),
          tx.testCase.count({ where: { ...where, isFlaky: true } }),
          tx.testCase.groupBy({
            by: ["priority"],
            where,
            _count: { _all: true },
          }),
          tx.testRun.count({ where: runWhere }),
          tx.testResult.count({ where: { testRun: runWhere } }),
          tx.testResult.groupBy({
            by: ["status"],
            where: { testRun: runWhere },
            _count: { _all: true },
          }),
          tx.testCase.count({
            where: {
              ...where,
              results: {
                some: {
                  testRun: runWhere,
                  status: { in: ["PASS", "FAIL", "FLAKY"] },
                },
              },
            },
          }),
          tx.testCase.count({
            where: { ...where, priority: { in: ["CRITICAL", "HIGH"] } },
          }),
          tx.testCase.count({
            where: {
              ...where,
              priority: { in: ["CRITICAL", "HIGH"] },
              results: {
                some: {
                  testRun: runWhere,
                  status: { in: ["PASS", "FAIL", "FLAKY"] },
                },
              },
            },
          }),
          tx.requirement.count({ where: requirementWhere }),
          tx.requirement.count({
            where: {
              ...requirementWhere,
              caseTraceabilityLinks: {
                some: { removedAt: null, testCase: where },
              },
            },
          }),
          tx.caseTraceabilityLink.count({
            where: {
              projectId: input.projectId,
              removedAt: null,
              testCase: where,
            },
          }),
          tx.testCase.count({
            where: {
              ...where,
              traceabilityLinks: { some: { removedAt: null } },
            },
          }),
          tx.defectMapState.findUnique({
            where: { projectId: input.projectId },
          }),
          tx.$queryRaw<Array<{ id: string; payload: Prisma.JsonValue }>>`
            SELECT id, payload FROM "ProjectReportSnapshot"
            WHERE "projectId" = ${input.projectId} AND "organizationId" = ${orgId}
              AND payload->>'state' = 'approved'
              AND COALESCE(payload->'definition'->'executionScope', 'null'::jsonb) = ${JSON.stringify(scope ?? null)}::jsonb
            ORDER BY "createdAt" DESC, id ASC LIMIT 1`.then(
            (rows) => rows[0] ?? null,
          ),
        ]);
        if (cohort.length > 20000)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "Snapshot case limit exceeded; no partial report was retained.",
          });
        const statusCounts = new Map<string, number>();
        for (const row of cohort)
          statusCounts.set(
            row.automationStatus,
            (statusCounts.get(row.automationStatus) ?? 0) + 1,
          );
        const previous = baseline
          ? payloadSchema.parse(baseline.payload)
          : null;
        // Never call a change of case selection an automation gain/loss.
        const old =
          previous &&
          hash(previous.definition.executionScope ?? null) ===
            hash(scope ?? null)
            ? previous
            : null;
        const oldStatuses = new Map(
          old?.cohort.map((row) => [row.id, row.status]) ?? [],
        );
        const common = cohort.filter((row) => oldStatuses.has(row.id));
        // Comparable stable identities, not a difference between drifting totals.
        const automationChange = old
          ? {
              baselineId: baseline!.id,
              baselineAsOf: old.asOf,
              commonCases: common.length,
              becameAutomated: common.filter(
                (row) =>
                  row.automationStatus === "AUTOMATED" &&
                  oldStatuses.get(row.id) !== "AUTOMATED",
              ).length,
              noLongerAutomated: common.filter(
                (row) =>
                  row.automationStatus !== "AUTOMATED" &&
                  oldStatuses.get(row.id) === "AUTOMATED",
              ).length,
              addedCases: cohort.length - common.length,
              removedCases: old.cohort.length - common.length,
              elapsedDays: Math.max(
                0,
                (asOf.getTime() - Date.parse(old.asOf)) / 86400000,
              ),
            }
          : null;
        let defects: FrozenReportPayload["defects"] = null;
        if (defectState && !scope) {
          if (defectState.organizationId !== orgId)
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "Defect evidence belongs to a previous workspace.",
            });
          const { buildDefectMap, defectDocumentSchema } =
            await import("@vaettir/core");
          const map = buildDefectMap(
            defectDocumentSchema.parse(defectState.document),
          );
          defects = {
            clusters: map.clusters.length,
            confirmed: map.clusters.filter((row) => row.tracking === "tracked")
              .length,
            suggested: map.suggested,
            unavailableSources: map.unavailableSources,
          };
        }
        const [caseOutcomes, runOutcomes] = await Promise.all([
          tx.testResult.groupBy({
            by: ["testCaseId", "status"],
            where: { testRun: runWhere, testCase: where },
            _count: { _all: true },
            orderBy: [{ testCaseId: "asc" }, { status: "asc" }],
            take: 200001,
          }),
          tx.testResult.groupBy({
            by: ["testRunId", "status"],
            where: { testRun: runWhere },
            _count: { _all: true },
            orderBy: [{ testRunId: "asc" }, { status: "asc" }],
            take: 200001,
          }),
        ]);
        if (caseOutcomes.length > 200000 || runOutcomes.length > 200000)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "Evidence scope exceeds bounded outcome groups; narrow the report. No partial report retained.",
          });
        const payload = payloadSchema.parse({
          state: "preview",
          projectName: project.name,
          title: input.title,
          definition: input.definition,
          asOf: asOf.toISOString(),
          windowStart: windowStart.toISOString(),
          windowEnd: window.end.toISOString(),
          scope: {
            kind: scope ? "recorded-execution" : "project",
            ...(scope ? { filters: scope } : {}),
            planName: selectedPlan?.name ?? null,
            contributingRunIds: contributingRuns.map((row) => row.id),
            cohortBasis: scope
              ? "Current active cases in the selected plan's saved/linked case scope plus planned or linked identities in matching recorded runs. Cases without results remain in the denominator."
              : "All current active project cases.",
          },
          inventory: {
            active: cohort.length,
            riskAssessed,
            flaky,
            automation: [...statusCounts].map(([key, count]) => ({
              key,
              count,
            })),
            priority: buckets(priority, "priority"),
          },
          execution: {
            runs,
            results,
            outcomes: buckets(outcomes, "status"),
            distinctCases: executed,
            highPriorityCases,
            highPriorityExecuted,
            matchedResults: await tx.testResult.count({
              where: {
                testRun: runWhere,
                testCase: { projectId: input.projectId },
              },
            }),
            unmatchedResults: await tx.testResult.count({
              where: {
                testRun: runWhere,
                OR: [
                  { testCaseId: null },
                  { testCase: { projectId: { not: input.projectId } } },
                ],
              },
            }),
            plannedCaseRunPairs: plannedPairs.length,
            notRecordedCaseRunPairs: plannedPairs.filter(
              (pair) => !recordedPairs.has(pair),
            ).length,
          },
          traceability: {
            requirements,
            coveredRequirements,
            links,
            casesWithLinks: linkedCases,
          },
          defects,
          cohort: cohort.map((row) => ({
            id: row.id,
            status: row.automationStatus,
          })),
          evidence: capturedReportEvidence(
            cohort,
            contributingRuns,
            caseOutcomes,
            runOutcomes,
            recordedPairs,
          ),
          automationChange,
          limitations: [
            scope
              ? "Scoped metrics from one database snapshot. Execution uses exact recorded filters and run start times in the UTC window. Inventory, priority and plan case selection are current at capture, not historical inventory."
              : "Project-wide metrics from one database snapshot; execution is limited to the selected window. Inventory and links are current at capture.",
            "UTC dates are inclusive calendar days; today's end is capped at capture. Runs are selected by start time, not result observation time. Planned not-recorded case/run pairs are distinct from SKIP, BLOCKED and unmatched results.",
            ...(scope
              ? [
                  "Platform, environment and manual build filters use recorded version-1 execution context; missing/unsupported context does not match. CI build uses the exact recorded commit reference. Labels are not provider/device verification.",
                  "Scoped traceability includes only requirements with explicit active-case links in the scoped cohort; project requirements without such links are excluded, not declared covered. Defect aggregates are excluded because imported signals lack a verified matching run scope.",
                ]
              : []),
            "An executed case has PASS, FAIL or FLAKY recorded in the window. SKIP and BLOCKED do not count as executed. Coverage does not imply passing or readiness.",
            "Automation changes compare the same active case identities between approved snapshots. Labels are recorded inventory, not verified automation runs or time saved.",
            "Defect metadata is a reviewed export, not live synchronization. Closed tasks and traceability links do not prove deployed fixes.",
            "Escape rate, reopened defects, code coverage, planned-versus-actual effort and root-cause resolution time are unavailable without the corresponding evidence.",
          ],
        });
        if (
          Buffer.byteLength(JSON.stringify(payload), "utf8") >
          8 * 1024 * 1024
        )
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "Captured report exceeds 8 MiB; narrow the scope. No partial report retained.",
          });
        return output(
          await tx.projectReportSnapshot.create({
            data: {
              id,
              projectId: input.projectId,
              organizationId: orgId,
              createdById: ctx.user.id,
              inputHash,
              title: input.title,
              definitionId: input.definitionId,
              asOf,
              payload,
            },
          }),
        );
      }),
    ),
  approve: protectedProcedure
    .input(
      projectInput.extend({
        previewId: z.string().length(64),
        approveSharing: z.literal(true),
      }),
    )
    .mutation(({ ctx, input }) =>
      access(ctx, input.projectId, true, async (tx, orgId) => {
        const preview = await tx.projectReportSnapshot.findFirst({
          where: {
            id: input.previewId,
            projectId: input.projectId,
            organizationId: orgId,
            createdById: ctx.user.id,
          },
        });
        if (
          !preview ||
          payloadSchema.parse(preview.payload).state !== "preview"
        )
          throw new TRPCError({ code: "NOT_FOUND" });
        const id = hash([preview.id, "approved"]);
        const prior = await tx.projectReportSnapshot.findUnique({
          where: { id },
        });
        if (prior) return output(prior);
        if (
          (await tx.projectReportSnapshot.count({
            where: { projectId: input.projectId },
          })) >= 500
        )
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Report retention limit reached. Preview remains saved.",
          });
        const payload = payloadSchema.parse({
          ...payloadSchema.parse(preview.payload),
          state: "approved",
        });
        return output(
          await tx.projectReportSnapshot.create({
            data: {
              id,
              projectId: input.projectId,
              organizationId: orgId,
              createdById: ctx.user.id,
              inputHash: preview.inputHash,
              title: preview.title,
              definitionId: preview.definitionId,
              asOf: preview.asOf,
              payload,
            },
          }),
        );
      }),
    ),
});
