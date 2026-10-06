import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createHash } from "node:crypto";
import { Prisma } from "@vaettir/db";
import {
  datasetPreviewInputSchema,
  datasetStartInputSchema,
  prepareDatasetExecution,
  datasetPreviewOutput,
  startDatasetExecution,
} from "../services/datasetExecution.js";
import { router, protectedProcedure, requireProjectAccess } from "../trpc.js";
import { recomputeFlaky } from "../services/flakyDetection.js";
import { resolveHealingSuggestionsOnPass } from "../services/healingSuggestion.js";
import { resolveStepFieldLabels } from "@vaettir/core";
import { lockManualExecutionReadScope } from "../services/manualExecutionReadScope.js";
import {
  manualExecutionReadScopeInputSchema,
  manualExecutionReadScopeOutputSchema,
} from "../services/manualExecutionReadScopeSchema.js";
import {
  planReferenceSchema,
  requireCurrentPlanAccess,
  reviewPlanExecution,
} from "../services/testPlanExecution.js";
import {
  boundedRunSnapshot,
  qualityProfileHash,
  readQualityExperience,
  readRunExperienceSnapshot,
  runConfigurationSchema,
  runExperienceSnapshotSchema,
} from "../services/qualityExperienceProfile.js";
import {
  manualRunStatus,
  measurementVerdict,
  observationsSchema,
  verificationProfileSchema,
  validationDomainSchema,
} from "../services/physicalValidation.js";
import {
  boundedCurrentStepBytes,
  frozenStructuredCase,
  protectExecutedDependents,
  recordManualStepResult,
  recordStepResultInputSchema,
  safeEvidenceFileName,
  stepEvidenceSchema,
  stepRevisionOutput,
  stepRevisionOutputSchema,
  stepStatusSchema,
} from "../services/manualStepExecution.js";

// Closes the single biggest gap found in the 2026-08-27 competitor parity
// audit (see COMPETITIVE_ANALYSIS.md): every competitor researched
// (TestRail, Zephyr, qTest, Xray, PractiTest) has a native manual
// execution UI as a core feature - a person works through a run's test
// cases and records PASS/FAIL/BLOCKED/SKIP per case. Phase 5 (ingestJUnit)
// only ever ingested what CI already produced; nothing in Vaettir let a
// human BE the one producing a real TestResult.
//
// Deliberately reuses the existing TestRun/TestResult models (ciProvider:
// "manual", commitSha/branch: "manual" sentinels - not tied to a real
// commit, and changing those columns to nullable would ripple through
// every existing CI-run query/output schema for no real benefit) rather
// than a parallel model - a manual run and a CI run are the same shape of
// fact ("these cases ran, here's what happened"), just produced by a
// different actor. This is exactly why P7-02's acceptance-criteria
// rollup, P5-05's flaky detection, and P7-07's trend charts all work on
// manually-recorded results with zero changes needed anywhere else in the
// codebase - they were already source-agnostic.
//
// Scoped to test-case-level results (one status + note per case per run),
// matching the granularity every other part of this schema already uses -
// step-by-step pass/fail within a single case (which some competitors
// also support) is a real, separate increment, not attempted here.
export const manualExecutionRouter = router({
  previewDatasetExecution: protectedProcedure
    .input(datasetPreviewInputSchema)
    .query(({ ctx, input }) =>
      ctx.prisma.$transaction(
        async (tx) =>
          datasetPreviewOutput(
            await prepareDatasetExecution(tx, ctx.user.id, input),
          ),
        { isolationLevel: "RepeatableRead", timeout: 20000 },
      ),
    ),
  startDatasetExecution: protectedProcedure
    .input(datasetStartInputSchema)
    .mutation(({ ctx, input }) =>
      startDatasetExecution(ctx.prisma, ctx.user.id, input),
    ),
  recordStepResult: protectedProcedure
    .input(recordStepResultInputSchema)
    .output(
      z.object({
        revisionId: z.string(),
        caseStatus: stepStatusSchema.nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await recordManualStepResult(ctx.prisma, ctx.user, input);
      if (!result.recovered) {
        await recomputeFlaky(ctx.prisma, input.testCaseId);
        if (result.caseStatus === "PASS")
          await resolveHealingSuggestionsOnPass(ctx.prisma, input.testCaseId);
      }
      return result;
    }),

  stepResultHistory: protectedProcedure
    .input(
      z.object({
        testRunId: z.string().min(1).max(200),
        testCaseId: z.string().min(1).max(200),
        stepIndex: z.number().int().min(0).max(499),
        cursor: z.string().min(1).max(200).optional(),
        limit: z.number().int().min(1).max(25).default(25),
      }),
    )
    .output(
      z.object({
        revisions: z.array(stepRevisionOutputSchema).max(25),
        nextCursor: z.string().nullable(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const run = await ctx.prisma.testRun.findUnique({
        where: { id: input.testRunId },
      });
      if (!run)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Test run not found",
        });
      await requireProjectAccess(ctx, run.projectId);
      await requireCurrentPlanAccess(ctx.prisma, ctx.user.id, run.projectId);
      const definition = frozenStructuredCase(run, input.testCaseId);
      if (input.stepIndex >= definition.steps.length)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "That step is not part of this run's frozen procedure.",
        });
      const scope = {
        testRunId: run.id,
        testCaseId: input.testCaseId,
        stepIndex: input.stepIndex,
      };
      const cursor = input.cursor
        ? await ctx.prisma.manualStepResultRevision.findFirst({
            where: { ...scope, id: input.cursor },
            select: { revisionNumber: true },
          })
        : null;
      if (input.cursor && !cursor)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This history cursor does not belong to the selected step.",
        });
      const rows = await ctx.prisma.manualStepResultRevision.findMany({
        where: {
          ...scope,
          revisionNumber: cursor ? { lt: cursor.revisionNumber } : undefined,
        },
        orderBy: { revisionNumber: "desc" },
        take: input.limit + 1,
      });
      const revisions = rows.slice(0, input.limit).map(stepRevisionOutput);
      return {
        revisions,
        nextCursor:
          rows.length > input.limit
            ? revisions[revisions.length - 1]!.id
            : null,
      };
    }),

  listStepEvidence: protectedProcedure
    .input(
      z.object({
        testRunId: z.string().min(1).max(200),
        search: z.string().trim().max(200).optional(),
        cursor: z.string().min(1).max(200).optional(),
      }),
    )
    .output(
      z.object({
        attachments: z.array(stepEvidenceSchema).max(25),
        nextCursor: z.string().nullable(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const run = await ctx.prisma.testRun.findUnique({
        where: { id: input.testRunId },
        select: { projectId: true },
      });
      if (!run)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Test run not found",
        });
      await requireProjectAccess(ctx, run.projectId);
      await requireCurrentPlanAccess(ctx.prisma, ctx.user.id, run.projectId);
      const rows = await ctx.prisma.testCaseAttachment.findMany({
        where: {
          testCase: { projectId: run.projectId },
          uploadCompletedAt: { not: null },
          id: input.cursor ? { gt: input.cursor } : undefined,
          fileName: input.search
            ? { contains: input.search, mode: "insensitive" }
            : undefined,
        },
        orderBy: { id: "asc" },
        select: { id: true, fileName: true },
        take: 26,
      });
      const attachments = rows
        .slice(0, 25)
        .map((a) => ({ id: a.id, fileName: safeEvidenceFileName(a.fileName) }));
      return {
        attachments,
        nextCursor:
          rows.length > 25 ? attachments[attachments.length - 1]!.id : null,
      };
    }),

  start: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        testCaseIds: z.array(z.string()).min(1).max(1000),
        expectedProfileHash: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
        executionContext: runConfigurationSchema.optional(),
        idempotencyKey: z.string().uuid().optional(),
        planReference: planReferenceSchema.optional(),
        originalOrganizationId: z.string().min(1).max(200).optional(),
        expectedClerkActorId: z.string().min(1).max(200).optional(),
      }).refine(input => Boolean(input.originalOrganizationId) === Boolean(input.expectedClerkActorId) && (!input.originalOrganizationId || !!input.idempotencyKey), {
        message: "Provide both original workspace and signed-in account with a durable key for a reviewed run start.",
      }),
    )
    .output(z.object({ testRunId: z.string(), originalOrganizationId: z.string().optional(), expectedClerkActorId: z.string().optional(), idempotencyKey: z.string().uuid().optional() }))
    .mutation(async ({ ctx, input }) => {
      const { membership } = await requireProjectAccess(
        ctx,
        input.projectId,
        "EDITOR",
      );
      if (membership.seatType !== "FULL")
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "A full editor seat is required.",
        });
      await requireCurrentPlanAccess(
        ctx.prisma,
        ctx.user.id,
        input.projectId,
        true,
      );
      if (new Set(input.testCaseIds).size !== input.testCaseIds.length) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Choose each test case only once.",
        });
      }
      const configuration = runConfigurationSchema.parse(
        input.executionContext ?? {},
      );
      const startRequestHash = qualityProfileHash({
        testCaseIds: input.planReference
          ? input.testCaseIds
          : [...input.testCaseIds].sort(),
        expectedProfileHash: input.expectedProfileHash ?? null,
        configuration,
        ...(input.planReference ? { planReference: input.planReference } : {}),
        ...(input.originalOrganizationId ? { originalOrganizationId: input.originalOrganizationId, expectedClerkActorId: input.expectedClerkActorId } : {}),
      });
      function acknowledgeRun(testRunId: string) {
        return { testRunId, ...(input.originalOrganizationId ? {
          originalOrganizationId: input.originalOrganizationId,
          expectedClerkActorId: input.expectedClerkActorId,
          idempotencyKey: input.idempotencyKey,
        } : {}) };
      }
      if (
        input.planReference &&
        (!input.idempotencyKey ||
          !input.expectedProfileHash ||
          !input.executionContext)
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Review project context and the saved plan configuration with a durable run-start key before starting.",
        });
      }
      const durableId = input.idempotencyKey
        ? `manual_${createHash("sha256")
            .update(
              JSON.stringify([
                input.projectId,
                ctx.user.id,
                input.idempotencyKey,
              ]),
            )
            .digest("hex")}`
        : undefined;
      async function lockCurrentStartAccess(tx: Prisma.TransactionClient) {
        await tx.$executeRaw(Prisma.sql`SET LOCAL statement_timeout='8000ms'`);
        const found = await tx.project.findUnique({
          where: { id: input.projectId },
          select: { organizationId: true },
        });
        if (!found)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Project not found",
          });
        // Same organization-first order as the manual read boundary. Do not
        // acquire the prerequisite advisory lock before tenant/actor locks.
        const [org] = await tx.$queryRaw<Array<{ suspendedAt: Date | null }>>`
          SELECT "suspendedAt" FROM "Organization" WHERE id=${found.organizationId} FOR SHARE`;
        const [member] = await tx.$queryRaw<
          Array<{ role: string; seatType: string }>
        >`
          SELECT role::text AS role,"seatType"::text AS "seatType" FROM "Membership"
          WHERE "organizationId"=${found.organizationId} AND "userId"=${ctx.user.id} FOR SHARE`;
        const [project] = await tx.$queryRaw<Array<{ organizationId: string }>>`
          SELECT "organizationId" FROM "Project" WHERE id=${input.projectId} FOR SHARE`;
        const [actor] = await tx.$queryRaw<
          Array<{ clerkUserId: string | null }>
        >`
          SELECT "clerkUserId" FROM "User" WHERE id=${ctx.user.id} FOR SHARE`;
        if (
          !org ||
          org.suspendedAt ||
          !member ||
          member.seatType !== "FULL" ||
          !["OWNER", "ADMIN", "EDITOR"].includes(member.role) ||
          project?.organizationId !== found.organizationId ||
          !actor?.clerkUserId ||
          actor.clerkUserId !== ctx.user.clerkUserId
          || (input.originalOrganizationId !== undefined && input.originalOrganizationId !== found.organizationId)
          || (input.expectedClerkActorId !== undefined && input.expectedClerkActorId !== actor.clerkUserId)
        )
          throw new TRPCError({
            code: "FORBIDDEN",
            message:
              "A current signed-in full editor seat in this project is required.",
          });
        await requireCurrentPlanAccess(tx, ctx.user.id, input.projectId, true);
      }
      async function previousRunInTransaction(tx: Prisma.TransactionClient) {
        if (!durableId) return null;
        await tx.$queryRaw`SELECT id FROM "TestRun" WHERE id=${durableId} FOR SHARE`;
        const existing = await tx.testRun.findUnique({
          where: { id: durableId },
          select: {
            id: true,
            projectId: true,
            startedById: true,
            executionContext: true,
          },
        });
        if (!existing) return null;
        const frozen = readRunExperienceSnapshot(existing.executionContext);
        if (
          existing.projectId !== input.projectId ||
          existing.startedById !== ctx.user.id ||
          frozen?.startRequestHash !== startRequestHash
        ) {
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "This run-start key was used for a different request. Review the changed scope and start with a new key.",
          });
        }
        return acknowledgeRun(existing.id);
      }
      async function previousRun() {
        if (!durableId) return null;
        return ctx.prisma.$transaction(
          async (tx) => {
            await lockCurrentStartAccess(tx);
            return previousRunInTransaction(tx);
          },
          { timeout: 20000, isolationLevel: "RepeatableRead" },
        );
      }
      // A lost response must not produce another execution or replace the
      // original baseline with newer project/case data on retry.
      const previous = await previousRun();
      if (previous) return previous;
      try {
        return await ctx.prisma.$transaction(
          async (tx) => {
            await lockCurrentStartAccess(tx);
            // Serialize with prerequisite edits, then freeze the graph for this
            // run. Historical runs never change when a case's graph is edited.
            await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${input.projectId}))::text`;
            const replay = await previousRunInTransaction(tx);
            if (replay) return replay;
            const project = await tx.project.findUnique({
              where: { id: input.projectId },
              select: {
                qualityProfile: true,
                organization: { select: { stepFieldLabels: true } },
              },
            });
            if (!project)
              throw new TRPCError({
                code: "NOT_FOUND",
                message: "Project not found",
              });
            const experience = readQualityExperience(project.qualityProfile);
            if (
              input.expectedProfileHash !== undefined &&
              input.expectedProfileHash !== experience.profileHash
            ) {
              throw new TRPCError({
                code: "CONFLICT",
                message:
                  "Project context changed. Refresh and review the run configuration before starting.",
              });
            }
            const plan = input.planReference
              ? await tx.testPlan.findUnique({
                  where: { id: input.planReference.testPlanId },
                })
              : null;
            if (input.planReference && !plan)
              throw new TRPCError({
                code: "NOT_FOUND",
                message: "Test plan not found",
              });
            const planSnapshot =
              input.planReference && plan
                ? reviewPlanExecution(
                    plan,
                    input.projectId,
                    input.planReference,
                    input.testCaseIds,
                    configuration,
                  )
                : undefined;
            const links = await tx.testCasePrerequisite.findMany({
              where: { projectId: input.projectId },
              select: { dependentId: true, prerequisiteId: true },
              take: 10001,
            });
            if (links.length > 10000)
              throw new TRPCError({
                code: "BAD_REQUEST",
                message:
                  "Project has too many prerequisite links to start safely.",
              });
            const graph = new Map<string, string[]>();
            for (const link of links)
              graph.set(link.dependentId, [
                ...(graph.get(link.dependentId) ?? []),
                link.prerequisiteId,
              ]);
            const ordered: string[] = [];
            const visited = new Set<string>();
            const visiting = new Set<string>();
            for (const rootId of input.testCaseIds) {
              if (visited.has(rootId)) continue;
              const stack = [{ id: rootId, nextIndex: 0 }];
              while (stack.length) {
                const frame = stack[stack.length - 1]!;
                visiting.add(frame.id);
                const next = (graph.get(frame.id) ?? [])[frame.nextIndex++];
                if (next) {
                  if (visiting.has(next))
                    throw new TRPCError({
                      code: "CONFLICT",
                      message: "Test case prerequisites contain a cycle.",
                    });
                  if (!visited.has(next))
                    stack.push({ id: next, nextIndex: 0 });
                  if (visited.size + stack.length > 1000)
                    throw new TRPCError({
                      code: "BAD_REQUEST",
                      message:
                        "Run would include more than 1,000 cases with prerequisites. Split the reviewed scope into separate runs.",
                    });
                  continue;
                }
                stack.pop();
                visiting.delete(frame.id);
                visited.add(frame.id);
                ordered.push(frame.id);
                if (ordered.length > 1000)
                  throw new TRPCError({
                    code: "BAD_REQUEST",
                    message:
                      "Run would include more than 1,000 cases with prerequisites. Split the reviewed scope into separate runs.",
                  });
              }
            }
            const cases = await tx.testCase.findMany({
              where: {
                id: { in: ordered },
                projectId: input.projectId,
                archived: false,
              },
              include: {
                steps: { orderBy: { order: "asc" } },
                sharedStepGroup: true,
                dataset: { select: { id: true } },
              },
            });
            if (cases.length !== ordered.length) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message:
                  "A selected case or prerequisite is missing, archived, or outside this project.",
              });
            }
            if (cases.some((c) => c.reviewStatus !== "APPROVED"))
              throw new TRPCError({
                code: "BAD_REQUEST",
                message:
                  "A selected case or prerequisite has not been approved. Review and approve the complete dependency scope before starting; nothing was started.",
              });
            if (cases.some((c) => c.dataset))
              throw new TRPCError({
                code: "BAD_REQUEST",
                message:
                  "A selected case or prerequisite has a dataset. Use Run dataset rows to review concrete procedures and create independently recorded row runs; nothing was started.",
              });
            const snapshot = Object.fromEntries(
              ordered.map((id) => [id, graph.get(id) ?? []]),
            );
            const casesById = new Map(cases.map((c) => [c.id, c]));
            const executionContext = boundedRunSnapshot({
              version: 1,
              ...experience,
              startRequestHash,
              configuration,
              ...(planSnapshot ? { plan: planSnapshot } : {}),
              stepFieldLabels: resolveStepFieldLabels(
                (project.organization.stepFieldLabels ?? {}) as never,
              ),
              caseDefinitions: ordered.map((id) => {
                const c = casesById.get(id)!;
                const verification = verificationProfileSchema.safeParse(
                  c.verificationProfile,
                );
                if (!verification.success)
                  throw new TRPCError({
                    code: "BAD_REQUEST",
                    message:
                      "A selected case has invalid procedure metadata. Review the case before starting a run; nothing was started.",
                  });
                return {
                  testCaseId: c.id,
                  title: c.title,
                  validationDomain: c.validationDomain,
                  reviewStatus: c.reviewStatus,
                  background: c.background,
                  given: c.given,
                  when: c.when,
                  then: c.then,
                  verificationProfile: verification.data,
                  steps: c.sharedStepGroup
                    ? c.sharedStepGroup.steps
                    : c.steps.map((s) => ({
                        order: s.order,
                        action: s.action,
                        expectedActionOrData: s.expectedActionOrData,
                        expectedResult: s.expectedResult,
                        expectedResponse: s.expectedResponse,
                        mediaAttachmentIds: s.mediaAttachmentIds,
                      })),
                };
              }),
            });
            const run = await tx.testRun.create({
              data: {
                id: durableId,
                projectId: input.projectId,
                ciProvider: "manual",
                commitSha: "manual",
                branch: "manual",
                startedAt: new Date(),
                status: "RUNNING",
                manualTestCaseIds: ordered,
                manualPrerequisites: snapshot,
                executionContext,
                startedById: ctx.user.id,
              },
              select: { id: true },
            });
            return acknowledgeRun(run.id);
          },
          { timeout: 20000, isolationLevel: "RepeatableRead" },
        );
      } catch (error) {
        if (
          durableId &&
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          const recovered = await previousRun();
          if (recovered) return recovered;
        }
        throw error;
      }
    }),

  // The execution screen's single data source: the run's planned cases,
  // each with its full authoring content (both BDD and structured-step
  // formats, matching P1-10's "supports either" model) plus whatever
  // result has already been recorded for it in THIS run, if any.
  getForExecution: protectedProcedure
    .input(manualExecutionReadScopeInputSchema)
    .output(
      manualExecutionReadScopeOutputSchema.extend({
        status: z.string(),
        stepFieldLabels: z.record(z.string()),
        executionContext: runExperienceSnapshotSchema.nullable(),
        datasetBatchRuns: z
          .array(
            z.object({
              testRunId: z.string(),
              rowIndex: z.number().int(),
              rowName: z.string(),
              status: z.string(),
            }),
          )
          .max(50)
          .default([]),
        cases: z
          .array(
            z.object({
              testCaseId: z.string(),
              displayId: z.string().nullable(),
              title: z.string(),
              background: z.string().nullable(),
              prerequisiteIds: z.array(z.string()),
              validationDomain: validationDomainSchema,
              verificationProfile: verificationProfileSchema,
              given: z.array(z.string()),
              when: z.array(z.string()),
              then: z.array(z.string()),
              steps: z.array(
                z.object({
                  order: z.number(),
                  action: z.string(),
                  expectedActionOrData: z.string().nullable(),
                  expectedResult: z.string().nullable(),
                  expectedResponse: z.string().nullable(),
                  mediaAttachmentIds: z.array(z.string()).default([]),
                }),
              ),
              stepExecutionAvailable: z.boolean(),
              stepResults: z
                .array(
                  z.object({
                    stepIndex: z.number(),
                    current: stepRevisionOutputSchema.nullable(),
                    revisionCount: z.number(),
                  }),
                )
                .max(500),
              currentResult: z
                .object({
                  status: z.string(),
                  note: z.string().nullable(),
                  observations: observationsSchema,
                })
                .nullable(),
            }),
          )
          .max(1000),
      }),
    )
    .query(async ({ ctx, input }) => {
      return ctx.prisma.$transaction(
        async (tx) => {
          const access = await lockManualExecutionReadScope(tx, ctx.user.id, ctx.user.clerkUserId, input);
          const run = await tx.testRun.findUniqueOrThrow({
            where: { id: input.testRunId },
            include: {
              project: {
                select: { organization: { select: { stepFieldLabels: true } } },
              },
            },
          });

          const [cases, results] = await Promise.all([
            tx.testCase.findMany({
              where: {
                id: { in: run.manualTestCaseIds },
                projectId: run.projectId,
              },
              include: {
                steps: { orderBy: { order: "asc" } },
                sharedStepGroup: true,
              },
            }),
            tx.testResult.findMany({
              where: {
                testRunId: run.id,
                testCaseId: { in: run.manualTestCaseIds },
              },
            }),
          ]);
          const casesById = new Map(cases.map((c) => [c.id, c]));
          const resultByCase = new Map(
            results.map((r) => [r.testCaseId as string, r]),
          );
          const prerequisites = z
            .record(z.array(z.string()))
            .parse(run.manualPrerequisites);
          const executionContext = readRunExperienceSnapshot(
            run.executionContext,
          );
          if (
            executionContext &&
            (executionContext.caseDefinitions.length !== run.manualTestCaseIds.length ||
              new Set(executionContext.caseDefinitions.map(c => c.testCaseId)).size !== executionContext.caseDefinitions.length ||
              executionContext.caseDefinitions.some(
                (c) => !run.manualTestCaseIds.includes(c.testCaseId),
              ))
          )
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "The saved procedure does not uniquely cover this exact manual run. No current case wording was substituted.",
            });
          const frozenCases = new Map(
            executionContext?.caseDefinitions.map((c) => [c.testCaseId, c]) ??
              [],
          );
          const datasetScope = executionContext?.datasetExecution;
          const datasetBatchRuns = [];
          if (datasetScope) {
            if (run.id !== `${datasetScope.batchId}_${datasetScope.rowIndex}`)
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "This row's frozen batch identity is inconsistent.",
              });
            const siblings = await tx.testRun.findMany({
              where: {
                projectId: run.projectId,
                id: {
                  in: Array.from(
                    { length: datasetScope.rowCount },
                    (_, index) => `${datasetScope.batchId}_${index}`,
                  ),
                },
              },
              select: { id: true, status: true, executionContext: true },
            });
            if (siblings.length !== datasetScope.rowCount)
              throw new TRPCError({
                code: "BAD_REQUEST",
                message:
                  "Some saved batch rows are unavailable. Existing execution evidence has not been replaced.",
              });
            for (const sibling of siblings) {
              const receipt = readRunExperienceSnapshot(
                sibling.executionContext,
              )?.datasetExecution;
              if (
                !receipt ||
                receipt.batchId !== datasetScope.batchId ||
                receipt.expansionHash !== datasetScope.expansionHash ||
                receipt.testCaseId !== datasetScope.testCaseId ||
                receipt.configurationHash !== datasetScope.configurationHash ||
                receipt.rowCount !== datasetScope.rowCount ||
                sibling.id !== `${receipt.batchId}_${receipt.rowIndex}`
              )
                throw new TRPCError({
                  code: "BAD_REQUEST",
                  message:
                    "Saved batch row provenance is inconsistent. No unrelated run was linked.",
                });
              datasetBatchRuns.push({
                testRunId: sibling.id,
                rowIndex: receipt.rowIndex,
                rowName: receipt.rowName,
                status: sibling.status,
              });
            }
            datasetBatchRuns.sort((a, b) => a.rowIndex - b.rowIndex);
          }
          await boundedCurrentStepBytes(tx, run.id);
          const stepHeads = await tx.manualStepResultHead.findMany({
            where: {
              testRunId: run.id,
              testCaseId: { in: run.manualTestCaseIds },
            },
            include: { currentRevision: true },
          });
          const stepsByCase = new Map<string, typeof stepHeads>();
          for (const head of stepHeads)
            stepsByCase.set(head.testCaseId, [
              ...(stepsByCase.get(head.testCaseId) ?? []),
              head,
            ]);

          const overrides =
            (run.project.organization.stepFieldLabels as Partial<
              Record<string, string>
            > | null) ?? {};

          const response = {
            ...access,
            testRunId: run.id,
            projectId: run.projectId,
            status: run.status,
            stepFieldLabels:
              executionContext?.stepFieldLabels ??
              resolveStepFieldLabels(overrides as never),
            executionContext,
            datasetBatchRuns,
            cases: run.manualTestCaseIds
              .map((id) => {
                const c = casesById.get(id);
                const frozen = frozenCases.get(id);
                if (!c && !frozen) return null;
                const result = resultByCase.get(id);
                const heads = stepsByCase.get(id) ?? [];
                return {
                  testCaseId: id,
                  displayId: c?.displayId ?? null,
                  title: frozen ? frozen.title : c!.title,
                  background: frozen ? frozen.background : c!.background,
                  prerequisiteIds: prerequisites[id] ?? [],
                  validationDomain: frozen
                    ? validationDomainSchema.parse(frozen.validationDomain)
                    : c!.validationDomain,
                  verificationProfile: frozen
                    ? frozen.verificationProfile
                    : verificationProfileSchema.parse(c!.verificationProfile),
                  given: frozen ? frozen.given : c!.given,
                  when: frozen ? frozen.when : c!.when,
                  then: frozen ? frozen.then : c!.then,
                  stepExecutionAvailable:
                    !!frozen?.steps.length && (!result || heads.length > 0),
                  stepResults:
                    frozen?.steps.map((_, stepIndex) => {
                      const head = heads.find((h) => h.stepIndex === stepIndex);
                      return {
                        stepIndex,
                        current: head
                          ? stepRevisionOutput(head.currentRevision)
                          : null,
                        revisionCount: head?.revisionCount ?? 0,
                      };
                    }) ?? [],
                  // Same shared-step-group resolution as testCases.ts's byId -
                  // a case deferring to a group has no steps of its own.
                  steps: frozen
                    ? frozen.steps
                    : c!.sharedStepGroup
                      ? (c!.sharedStepGroup.steps as Array<{
                          order: number;
                          action: string;
                          expectedActionOrData: string | null;
                          expectedResult: string | null;
                          expectedResponse: string | null;
                          mediaAttachmentIds: string[];
                        }>)
                      : c!.steps.map((s) => ({
                          order: s.order,
                          action: s.action,
                          expectedActionOrData: s.expectedActionOrData,
                          expectedResult: s.expectedResult,
                          expectedResponse: s.expectedResponse,
                          mediaAttachmentIds: s.mediaAttachmentIds,
                        })),
                  currentResult: result
                    ? {
                        status: result.status,
                        note: result.note,
                        observations: observationsSchema.parse(
                          result.observations,
                        ),
                      }
                    : null,
                };
              })
              .filter((c): c is NonNullable<typeof c> => c !== null),
          };
          if (
            Buffer.byteLength(JSON.stringify(response), "utf8") > 16 * 1024 * 1024
          )
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message:
                "This complete execution view exceeds its response bound. No partial procedure or evidence was substituted.",
            });
          return response;
        },
        { isolationLevel: "RepeatableRead", timeout: 20000 },
      );
    }),

  // Idempotent by design: re-recording a case already executed in this
  // run updates the existing TestResult in place rather than creating a
  // duplicate - a tester correcting a mis-click, or deliberately
  // re-verifying, shouldn't fork the run's own record of "what happened."
  recordResult: protectedProcedure
    .input(
      z.object({
        testRunId: z.string(),
        testCaseId: z.string(),
        status: z.enum(["PASS", "FAIL", "BLOCKED", "SKIP"]),
        note: z.string().optional(),
        observations: observationsSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const authorizedRun = await ctx.prisma.testRun.findUniqueOrThrow({
        where: { id: input.testRunId },
      });
      await requireProjectAccess(ctx, authorizedRun.projectId, "EDITOR");

      const result = await ctx.prisma.$transaction(async (tx) => {
        // Serialize result changes and completion for this run, including parallel
        // tabs. This also prevents duplicate first-result inserts.
        await tx.$queryRaw`SELECT id FROM "TestRun" WHERE id = ${input.testRunId} FOR UPDATE`;
        const run = await tx.testRun.findUniqueOrThrow({
          where: { id: input.testRunId },
        });
        await requireCurrentPlanAccess(tx, ctx.user.id, run.projectId, true);

        if (run.ciProvider !== "manual" || run.status !== "RUNNING") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Only an active manual run can accept results",
          });
        }

        if (!run.manualTestCaseIds.includes(input.testCaseId)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "That test case isn't part of this run's planned scope",
          });
        }

        // Current run lock serializes first history activation with legacy writes.
        // Refuse before loading the native observation body or changing its verdict.
        if (
          await tx.manualCaseResultHead.count({
            where: { testRunId: run.id, testCaseId: input.testCaseId },
          })
        )
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "This case has immutable whole-case observation history. Review its current result and record a reasoned correction instead of overwriting it.",
          });
        const existing = await tx.testResult.findFirst({
          where: { testRunId: input.testRunId, testCaseId: input.testCaseId },
        });
        if (
          await tx.manualStepResultHead.count({
            where: { testRunId: run.id, testCaseId: input.testCaseId },
          })
        )
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "This case is being executed per step. Record or correct its step outcomes; the derived case verdict cannot be overwritten.",
          });

        const prerequisites = z
          .record(z.array(z.string()))
          .parse(run.manualPrerequisites);
        const requiredIds = prerequisites[input.testCaseId] ?? [];
        if (
          input.status !== "BLOCKED" &&
          input.status !== "SKIP" &&
          requiredIds.length
        ) {
          const passed = await tx.testResult.findMany({
            where: {
              testRunId: run.id,
              testCaseId: { in: requiredIds },
              status: "PASS",
            },
            select: { testCaseId: true },
          });
          if (passed.length !== requiredIds.length) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "Complete all prerequisite cases with Pass before executing this case.",
            });
          }
        }
        if (existing?.status === "PASS" && input.status !== "PASS") {
          await protectExecutedDependents(tx, run, input.testCaseId);
          const dependents = Object.entries(prerequisites)
            .filter(([, ids]) => ids.includes(input.testCaseId))
            .map(([id]) => id);
          const executedDependents = await tx.testResult.count({
            where: {
              testRunId: run.id,
              testCaseId: { in: dependents },
              status: { in: ["PASS", "FAIL"] },
            },
          });
          if (executedDependents) {
            throw new TRPCError({
              code: "CONFLICT",
              message:
                "A dependent case has already run. Correct or reset it before changing this prerequisite result.",
            });
          }
        }

        const observations =
          input.observations ??
          observationsSchema.parse(existing?.observations ?? {});
        if (
          input.status === "PASS" &&
          observations.measurements.some(
            (m) => measurementVerdict(m) === "OUT_OF_RANGE",
          )
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "A reading is outside its recorded limits. Review the evidence or record Fail instead of Pass.",
          });
        }

        const result = existing
          ? await tx.testResult.update({
              where: { id: existing.id },
              data: {
                status: input.status,
                note: input.note ?? null,
                observations,
              },
            })
          : await tx.testResult.create({
              data: {
                testRunId: input.testRunId,
                testCaseId: input.testCaseId,
                status: input.status,
                note: input.note ?? null,
                observations,
              },
            });

        return result;
      });

      // Same real-time signals a CI-ingested result already triggers
      // (P5-05, P6.5-04) - a manually-recorded PASS/FAIL is just as real.
      await recomputeFlaky(ctx.prisma, input.testCaseId);
      if (input.status === "PASS") {
        await resolveHealingSuggestionsOnPass(ctx.prisma, input.testCaseId);
      }

      return { id: result.id, status: result.status };
    }),

  // Aggregate status mirrors ingestJUnit's own rollup rule exactly (any
  // FAIL/BLOCKED -> FAILED, any SKIP with no FAIL -> PARTIAL, else
  // PASSED) so a manual run's status means the same thing a CI run's
  // does everywhere else it's read (dashboards, release readiness).
  // Doesn't require every planned case to have been recorded - a tester
  // can stop partway and the run reflects whatever was actually done.
  complete: protectedProcedure
    .input(z.object({ testRunId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const authorizedRun = await ctx.prisma.testRun.findUniqueOrThrow({
        where: { id: input.testRunId },
      });
      await requireProjectAccess(ctx, authorizedRun.projectId, "EDITOR");
      return ctx.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "TestRun" WHERE id = ${input.testRunId} FOR UPDATE`;
        const run = await tx.testRun.findUniqueOrThrow({
          where: { id: input.testRunId },
        });
        await requireCurrentPlanAccess(tx, ctx.user.id, run.projectId, true);

        if (run.ciProvider !== "manual" || run.status !== "RUNNING") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Only an active manual run can be completed",
          });
        }

        const results = await tx.testResult.findMany({
          where: {
            testRunId: input.testRunId,
            testCaseId: { in: run.manualTestCaseIds },
          },
          select: { status: true },
        });

        const observedFailures = await tx.manualStepResultHead.findMany({
          where: {
            testRunId: run.id,
            currentRevision: { status: { in: ["FAIL", "BLOCKED"] } },
          },
          select: { currentRevision: { select: { status: true } } },
        });
        const status = manualRunStatus(run.manualTestCaseIds.length, [
          ...results.map((r) => r.status),
          ...observedFailures.map((h) => h.currentRevision.status),
        ]);

        // Allow only this reviewed aggregation path to finalize step-mode runs.
        // Transaction-local state is cleared immediately, never pooled globally.
        await tx.$queryRaw`SELECT set_config('vaettir.manual_step_finalize', ${run.id}, true)`;
        await tx.testRun.update({
          where: { id: input.testRunId },
          data: { status, finishedAt: new Date() },
        });
        // SQL failure propagates unchanged; enclosing rollback clears SET LOCAL.
        await tx.$queryRaw`SELECT set_config('vaettir.manual_step_finalize', '', true)`;
        return { status };
      });
    }),
});
