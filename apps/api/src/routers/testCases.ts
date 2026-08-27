import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { TestCaseStepInputSchema, resolveStepFieldLabels, type StepFieldKey } from "@vaettir/core";
import { assessTestCaseRisk } from "@vaettir/ai-agent";
import { Prisma } from "@vaettir/db";
import { router, protectedProcedure, requireProjectAccess } from "../trpc.js";
import { recordAudit } from "../services/auditLog.js";
import { chargeAiCredits, InsufficientAiCreditsError } from "../services/aiCredits.js";

const stepOutputSchema = z.object({
  order: z.number(),
  action: z.string(),
  expectedActionOrData: z.string().nullable(),
  expectedResult: z.string().nullable(),
  expectedResponse: z.string().nullable(),
});

// Shared by create and update: the fields that make up a test case's
// content, independent of which record it belongs to.
const testCaseContentSchema = z.object({
  testPlanId: z.string().optional(),
  title: z.string().min(1),
  background: z.string().optional(),
  given: z.array(z.string()).default([]),
  when: z.array(z.string()).default([]),
  then: z.array(z.string()).default([]),
  steps: z.array(TestCaseStepInputSchema).default([]),
  tags: z.array(z.string()).default([]),
  testType: z.string(),
  priority: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]).default("MEDIUM"),
  suitePath: z.string().optional(),
});

function requireAtLeastOneFormat(v: z.infer<typeof testCaseContentSchema>) {
  return (v.given.length > 0 && v.when.length > 0 && v.then.length > 0) || v.steps.length > 0;
}
const AT_LEAST_ONE_FORMAT_MESSAGE = "Provide either given/when/then or at least one structured step";

export const testCasesRouter = router({
  list: protectedProcedure
    .input(z.object({ projectId: z.string(), includeArchived: z.boolean().default(false) }))
    .output(
      z.array(
        z.object({
          id: z.string(),
          title: z.string(),
          testType: z.string(),
          priority: z.string(),
          tags: z.array(z.string()),
          origin: z.string(),
          reviewStatus: z.string(),
          sourceFilePath: z.string().nullable(),
          suitePath: z.string().nullable(),
          archived: z.boolean(),
          isFlaky: z.boolean(),
        }),
      ),
    )
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      const cases = await ctx.prisma.testCase.findMany({
        where: { projectId: input.projectId, ...(input.includeArchived ? {} : { archived: false }) },
        include: { source: true, testPlan: true },
        orderBy: { updatedAt: "desc" },
      });
      return cases.map((tc) => ({
        id: tc.id,
        title: tc.title,
        testType: tc.testType,
        priority: tc.priority,
        tags: tc.tags,
        origin: tc.origin,
        reviewStatus: tc.reviewStatus,
        sourceFilePath: tc.source?.filePath ?? null,
        suitePath: tc.suitePath,
        archived: tc.archived,
        isFlaky: tc.isFlaky,
      }));
    }),

  // .output() bounds the inferred type to this schema instead of Prisma's
  // deeply-nested `include` payload type, which otherwise blows past tsc's
  // structural inference limit (TS2589) for consumers of the AppRouter type.
  byId: protectedProcedure
    .input(z.object({ id: z.string() }))
    .output(
      z.object({
        id: z.string(),
        title: z.string(),
        background: z.string().nullable(),
        given: z.array(z.string()),
        when: z.array(z.string()),
        then: z.array(z.string()),
        steps: z.array(stepOutputSchema),
        stepFieldLabels: z.record(z.string()),
        tags: z.array(z.string()),
        testType: z.string(),
        priority: z.string(),
        origin: z.string(),
        confidence: z.number().nullable(),
        reviewStatus: z.string(),
        reviewedByName: z.string().nullable(),
        reviewedAt: z.date().nullable(),
        reviewNote: z.string().nullable(),
        riskSeverity: z.string().nullable(),
        riskScore: z.number().nullable(),
        riskRationale: z.string().nullable(),
        riskAssessedAt: z.date().nullable(),
        isFlaky: z.boolean(),
        flakyDetectedAt: z.date().nullable(),
        suitePath: z.string().nullable(),
        source: z
          .object({
            filePath: z.string(),
            functionName: z.string().nullable(),
            framework: z.string(),
          })
          .nullable(),
        // The frozen AI output this case last got from the agent -- see the
        // schema comment on TestCase.aiSnapshot. Null for AUTHORED/IMPORTED
        // cases, or any AI case created before this field existed.
        aiSnapshot: z
          .object({
            title: z.string(),
            background: z.string().nullable(),
            given: z.array(z.string()),
            when: z.array(z.string()),
            then: z.array(z.string()),
            tags: z.array(z.string()),
          })
          .nullable(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const tc = await ctx.prisma.testCase.findUniqueOrThrow({
        where: { id: input.id },
        include: {
          source: true,
          steps: { orderBy: { order: "asc" } },
          project: { include: { organization: { select: { stepFieldLabels: true } } } },
          reviewedBy: { select: { name: true, email: true } },
        },
      });
      await requireProjectAccess(ctx, tc.projectId);
      return {
        id: tc.id,
        title: tc.title,
        background: tc.background,
        given: tc.given,
        when: tc.when,
        then: tc.then,
        steps: tc.steps.map((s) => ({
          order: s.order,
          action: s.action,
          expectedActionOrData: s.expectedActionOrData,
          expectedResult: s.expectedResult,
          expectedResponse: s.expectedResponse,
        })),
        stepFieldLabels: resolveStepFieldLabels(
          tc.project.organization.stepFieldLabels as Partial<Record<StepFieldKey, string>> | null,
        ),
        tags: tc.tags,
        testType: tc.testType,
        priority: tc.priority,
        origin: tc.origin,
        confidence: tc.confidence,
        reviewStatus: tc.reviewStatus,
        reviewedByName: tc.reviewedBy ? (tc.reviewedBy.name ?? tc.reviewedBy.email) : null,
        reviewedAt: tc.reviewedAt,
        reviewNote: tc.reviewNote,
        riskSeverity: tc.riskSeverity,
        riskScore: tc.riskScore,
        riskRationale: tc.riskRationale,
        riskAssessedAt: tc.riskAssessedAt,
        isFlaky: tc.isFlaky,
        flakyDetectedAt: tc.flakyDetectedAt,
        suitePath: tc.suitePath,
        source: tc.source
          ? { filePath: tc.source.filePath, functionName: tc.source.functionName, framework: tc.source.framework }
          : null,
        aiSnapshot: tc.aiSnapshot as {
          title: string;
          background: string | null;
          given: string[];
          when: string[];
          then: string[];
          tags: string[];
        } | null,
      };
    }),

  // Test cases can be authored two ways -- BDD (given/when/then) and/or the
  // structured step table (steps) -- and a case may carry either, both, or
  // (per the AI reverse-engineering path) just BDD. At least one is
  // required; an empty test case isn't a valid one.
  // A queue of AI-reverse-engineered cases still awaiting a human decision,
  // ordered by confidence ascending -- lowest-confidence (most likely to
  // need a real look) first.
  pendingReview: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .output(
      z.array(
        z.object({
          id: z.string(),
          title: z.string(),
          confidence: z.number().nullable(),
          sourceFilePath: z.string().nullable(),
        }),
      ),
    )
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      const cases = await ctx.prisma.testCase.findMany({
        where: { projectId: input.projectId, reviewStatus: "PENDING_REVIEW" },
        include: { source: true },
        orderBy: { confidence: "asc" },
      });
      return cases.map((c) => ({ id: c.id, title: c.title, confidence: c.confidence, sourceFilePath: c.source?.filePath ?? null }));
    }),

  approve: protectedProcedure
    .input(z.object({ id: z.string(), note: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.testCase.findUniqueOrThrow({ where: { id: input.id }, select: { projectId: true, title: true } });
      const { project } = await requireProjectAccess(ctx, existing.projectId, "EDITOR");
      const updated = await ctx.prisma.testCase.update({
        where: { id: input.id },
        data: { reviewStatus: "APPROVED", reviewedById: ctx.user.id, reviewedAt: new Date(), reviewNote: input.note, updatedById: ctx.user.id },
      });
      await recordAudit(ctx.prisma, {
        organizationId: project.organizationId,
        projectId: existing.projectId,
        actorId: ctx.user.id,
        entityType: "TestCase",
        entityId: input.id,
        action: "UPDATE",
        summary: `Approved test case "${existing.title}"`,
        metadata: input.note ? { note: input.note } : undefined,
      });
      return updated;
    }),

  reject: protectedProcedure
    .input(z.object({ id: z.string(), note: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.testCase.findUniqueOrThrow({ where: { id: input.id }, select: { projectId: true, title: true } });
      const { project } = await requireProjectAccess(ctx, existing.projectId, "EDITOR");
      const updated = await ctx.prisma.testCase.update({
        where: { id: input.id },
        data: { reviewStatus: "REJECTED", reviewedById: ctx.user.id, reviewedAt: new Date(), reviewNote: input.note, updatedById: ctx.user.id },
      });
      await recordAudit(ctx.prisma, {
        organizationId: project.organizationId,
        projectId: existing.projectId,
        actorId: ctx.user.id,
        entityType: "TestCase",
        entityId: input.id,
        action: "UPDATE",
        summary: `Rejected test case "${existing.title}"`,
        metadata: input.note ? { note: input.note } : undefined,
      });
      return updated;
    }),

  assessRisk: protectedProcedure
    .input(z.object({ id: z.string() }))
    .output(z.object({ riskSeverity: z.string().nullable(), riskScore: z.number().nullable(), riskRationale: z.string().nullable() }))
    .mutation(async ({ ctx, input }) => {
      const tc = await ctx.prisma.testCase.findUniqueOrThrow({
        where: { id: input.id },
        include: { source: { select: { filePath: true } } },
      });
      const { project } = await requireProjectAccess(ctx, tc.projectId, "EDITOR");

      try {
        await chargeAiCredits(ctx.prisma, project.organizationId, "assessTestCaseRisk");
      } catch (e) {
        if (e instanceof InsufficientAiCreditsError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
        }
        throw e;
      }

      const assessment = await assessTestCaseRisk({
        title: tc.title,
        given: tc.given,
        when: tc.when,
        then: tc.then,
        testType: tc.testType,
        sourceFilePath: tc.source?.filePath,
      });

      const updated = await ctx.prisma.testCase.update({
        where: { id: input.id },
        data: {
          riskSeverity: assessment.severity,
          riskScore: Math.round(assessment.riskScore),
          riskRationale: assessment.rationale,
          riskAssessedAt: new Date(),
          updatedById: ctx.user.id,
        },
      });
      return { riskSeverity: updated.riskSeverity, riskScore: updated.riskScore, riskRationale: updated.riskRationale };
    }),

  // Assesses every not-yet-assessed case in a project, sequentially (not
  // Promise.all) to avoid firing a burst of concurrent LLM calls from one
  // click -- this is a manual bulk action from a settings-style page, not
  // latency-sensitive, so sequential + a sane cap is the simple, safe
  // choice over adding real concurrency control for no real benefit yet.
  assessProjectRisk: protectedProcedure
    .input(z.object({ projectId: z.string(), limit: z.number().min(1).max(50).default(20) }))
    .output(z.object({ assessedCount: z.number(), failedCount: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const { project } = await requireProjectAccess(ctx, input.projectId, "EDITOR");
      const unassessed = await ctx.prisma.testCase.findMany({
        where: { projectId: input.projectId, riskAssessedAt: null },
        include: { source: { select: { filePath: true } } },
        take: input.limit,
      });

      let assessedCount = 0;
      let failedCount = 0;
      for (const tc of unassessed) {
        try {
          // Charge (and stop the batch, not just this case) the moment
          // credits run out -- partial progress on the batch is kept
          // rather than the whole mutation failing outright.
          await chargeAiCredits(ctx.prisma, project.organizationId, "assessTestCaseRisk");
          const assessment = await assessTestCaseRisk({
            title: tc.title,
            given: tc.given,
            when: tc.when,
            then: tc.then,
            testType: tc.testType,
            sourceFilePath: tc.source?.filePath,
          });
          await ctx.prisma.testCase.update({
            where: { id: tc.id },
            data: {
              riskSeverity: assessment.severity,
              riskScore: Math.round(assessment.riskScore),
              riskRationale: assessment.rationale,
              riskAssessedAt: new Date(),
              updatedById: ctx.user.id,
            },
          });
          assessedCount++;
        } catch (e) {
          failedCount++;
          if (e instanceof InsufficientAiCreditsError) break;
        }
      }
      return { assessedCount, failedCount };
    }),

  // TestRail/Qase both let you type a title and hit Enter to capture a test
  // idea immediately, filling in given/when/then/steps later -- deliberately
  // skips requireAtLeastOneFormat, which the full create/update mutations
  // still enforce for a case someone is treating as finished. A
  // quick-created case is a legitimate draft, not an error state; the
  // detail view calls this out and links to the editor instead of hiding
  // the gap.
  quickCreate: protectedProcedure
    .input(z.object({ projectId: z.string(), title: z.string().min(1), suitePath: z.string().optional() }))
    .output(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { project } = await requireProjectAccess(ctx, input.projectId, "EDITOR");
      const created = await ctx.prisma.testCase.create({
        data: {
          projectId: input.projectId,
          title: input.title,
          testType: "FUNCTIONAL",
          suitePath: input.suitePath || undefined,
          createdById: ctx.user.id,
          updatedById: ctx.user.id,
        },
        select: { id: true },
      });
      await recordAudit(ctx.prisma, {
        organizationId: project.organizationId,
        projectId: input.projectId,
        actorId: ctx.user.id,
        entityType: "TestCase",
        entityId: created.id,
        action: "CREATE",
        summary: `Created test case "${input.title}"`,
      });
      return created;
    }),

  create: protectedProcedure
    .input(testCaseContentSchema.extend({ projectId: z.string() }).refine(requireAtLeastOneFormat, {
      message: AT_LEAST_ONE_FORMAT_MESSAGE,
    }))
    .mutation(async ({ ctx, input }) => {
      const { project } = await requireProjectAccess(ctx, input.projectId, "EDITOR");
      const created = await ctx.prisma.testCase.create({
        data: {
          projectId: input.projectId,
          testPlanId: input.testPlanId,
          title: input.title,
          background: input.background,
          given: input.given,
          when: input.when,
          then: input.then,
          tags: input.tags,
          testType: input.testType as never,
          priority: input.priority,
          suitePath: input.suitePath || undefined,
          createdById: ctx.user.id,
          updatedById: ctx.user.id,
          steps: {
            create: input.steps.map((s, i) => ({
              order: i,
              action: s.action,
              expectedActionOrData: s.expectedActionOrData ?? undefined,
              expectedResult: s.expectedResult ?? undefined,
              expectedResponse: s.expectedResponse ?? undefined,
            })),
          },
        },
      });
      await recordAudit(ctx.prisma, {
        organizationId: project.organizationId,
        projectId: input.projectId,
        actorId: ctx.user.id,
        entityType: "TestCase",
        entityId: created.id,
        action: "CREATE",
        summary: `Created test case "${created.title}"`,
      });
      return created;
    }),

  update: protectedProcedure
    .input(testCaseContentSchema.extend({ id: z.string() }).refine(requireAtLeastOneFormat, {
      message: AT_LEAST_ONE_FORMAT_MESSAGE,
    }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.testCase.findUniqueOrThrow({
        where: { id: input.id },
        select: { projectId: true },
      });
      const { project } = await requireProjectAccess(ctx, existing.projectId, "EDITOR");

      // Steps don't have stable client-side ids yet (the form just edits an
      // ordered list), so replace-all is simpler and correct here; revisit
      // if per-step history/comments ever need steps to persist identity
      // across an edit.
      const updated = await ctx.prisma.$transaction(async (tx) => {
        await tx.testCaseStep.deleteMany({ where: { testCaseId: input.id } });
        return tx.testCase.update({
          where: { id: input.id },
          data: {
            testPlanId: input.testPlanId,
            title: input.title,
            background: input.background,
            given: input.given,
            when: input.when,
            then: input.then,
            tags: input.tags,
            testType: input.testType as never,
            priority: input.priority,
            // Update (unlike create) needs to distinguish "field omitted,
            // leave alone" (undefined) from "field submitted empty, clear
            // the assignment" (null) -- the form always submits this field,
            // so an empty string here is a deliberate un-assign, not an
            // accidental no-op.
            suitePath: input.suitePath ? input.suitePath : null,
            updatedById: ctx.user.id,
            steps: {
              create: input.steps.map((s, i) => ({
                order: i,
                action: s.action,
                expectedActionOrData: s.expectedActionOrData ?? undefined,
                expectedResult: s.expectedResult ?? undefined,
                expectedResponse: s.expectedResponse ?? undefined,
              })),
            },
          },
        });
      });
      await recordAudit(ctx.prisma, {
        organizationId: project.organizationId,
        projectId: existing.projectId,
        actorId: ctx.user.id,
        entityType: "TestCase",
        entityId: input.id,
        action: "UPDATE",
        summary: `Updated test case "${updated.title}"`,
      });
      return updated;
    }),

  // Quick reassignment without opening the full edit form -- e.g. from the
  // tree's "Unassigned" bucket. Pass null/"" to clear back to unassigned
  // (or the derived source-file location, if it has one).
  setSuite: protectedProcedure
    .input(z.object({ id: z.string(), suitePath: z.string().nullable() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.testCase.findUniqueOrThrow({ where: { id: input.id }, select: { projectId: true } });
      await requireProjectAccess(ctx, existing.projectId, "EDITOR");
      await ctx.prisma.testCase.update({
        where: { id: input.id },
        data: { suitePath: input.suitePath || null, updatedById: ctx.user.id },
      });
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.testCase.findUniqueOrThrow({ where: { id: input.id }, select: { projectId: true, title: true } });
      const { project } = await requireProjectAccess(ctx, existing.projectId, "EDITOR");
      try {
        await ctx.prisma.testCase.delete({ where: { id: input.id } });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This test case is linked to a compliance control or a change-impact recommendation. Unlink those first.",
          });
        }
        throw e;
      }
      await recordAudit(ctx.prisma, {
        organizationId: project.organizationId,
        projectId: existing.projectId,
        actorId: ctx.user.id,
        entityType: "TestCase",
        entityId: input.id,
        action: "DELETE",
        summary: `Deleted test case "${existing.title}"`,
      });
    }),

  // Bulk select-and-act is the other half of the Qase-style ease-of-use
  // pattern (search/filter is client-side, this is the one part that
  // genuinely needs a server round trip). Scoped to projectId so a crafted
  // request can't delete ids from a project the caller doesn't have access
  // to -- ids outside the project are silently ignored, not an error, since
  // the caller only ever offers ids it already rendered from this project.
  bulkDelete: protectedProcedure
    .input(z.object({ projectId: z.string(), ids: z.array(z.string()).min(1).max(200) }))
    .output(z.object({ deletedCount: z.number(), blockedCount: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId, "EDITOR");
      let deletedCount = 0;
      let blockedCount = 0;
      for (const id of input.ids) {
        try {
          await ctx.prisma.testCase.delete({ where: { id, projectId: input.projectId } });
          deletedCount++;
        } catch {
          blockedCount++;
        }
      }
      return { deletedCount, blockedCount };
    }),

  bulkReview: protectedProcedure
    .input(z.object({ projectId: z.string(), ids: z.array(z.string()).min(1).max(200), decision: z.enum(["approve", "reject"]) }))
    .output(z.object({ updatedCount: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId, "EDITOR");
      const result = await ctx.prisma.testCase.updateMany({
        where: { id: { in: input.ids }, projectId: input.projectId },
        data: {
          reviewStatus: input.decision === "approve" ? "APPROVED" : "REJECTED",
          reviewedById: ctx.user.id,
          reviewedAt: new Date(),
          updatedById: ctx.user.id,
        },
      });
      return { updatedCount: result.count };
    }),

  bulkSetTestPlan: protectedProcedure
    .input(z.object({ projectId: z.string(), ids: z.array(z.string()).min(1).max(200), testPlanId: z.string().nullable() }))
    .output(z.object({ updatedCount: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId, "EDITOR");
      if (input.testPlanId) {
        const plan = await ctx.prisma.testPlan.findUniqueOrThrow({ where: { id: input.testPlanId }, select: { projectId: true } });
        if (plan.projectId !== input.projectId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "That test plan does not belong to this project" });
        }
      }
      const result = await ctx.prisma.testCase.updateMany({
        where: { id: { in: input.ids }, projectId: input.projectId },
        data: { testPlanId: input.testPlanId, updatedById: ctx.user.id },
      });
      return { updatedCount: result.count };
    }),

  // Tags are per-case arrays, not a shared join table, so a bulk "add tag"
  // is a per-row union rather than one updateMany -- each case may already
  // carry a different tag set. Bounded at the same 200-id cap as the other
  // bulk ops, so this stays a handful of round trips at worst.
  bulkAddTags: protectedProcedure
    .input(z.object({ projectId: z.string(), ids: z.array(z.string()).min(1).max(200), tags: z.array(z.string().min(1)).min(1) }))
    .output(z.object({ updatedCount: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId, "EDITOR");
      const cases = await ctx.prisma.testCase.findMany({
        where: { id: { in: input.ids }, projectId: input.projectId },
        select: { id: true, tags: true },
      });
      let updatedCount = 0;
      for (const tc of cases) {
        const merged = Array.from(new Set([...tc.tags, ...input.tags]));
        await ctx.prisma.testCase.update({ where: { id: tc.id }, data: { tags: merged, updatedById: ctx.user.id } });
        updatedCount++;
      }
      return { updatedCount };
    }),

  bulkArchive: protectedProcedure
    .input(z.object({ projectId: z.string(), ids: z.array(z.string()).min(1).max(200), archived: z.boolean() }))
    .output(z.object({ updatedCount: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId, "EDITOR");
      const result = await ctx.prisma.testCase.updateMany({
        where: { id: { in: input.ids }, projectId: input.projectId },
        data: { archived: input.archived, updatedById: ctx.user.id },
      });
      return { updatedCount: result.count };
    }),
});
