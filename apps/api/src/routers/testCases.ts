import { z } from "zod";
import { TestCaseStepInputSchema, resolveStepFieldLabels, type StepFieldKey } from "@vaettir/core";
import { assessTestCaseRisk } from "@vaettir/ai-agent";
import { router, protectedProcedure, requireProjectAccess } from "../trpc.js";

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
    .input(z.object({ projectId: z.string() }))
    .output(
      z.array(
        z.object({
          id: z.string(),
          title: z.string(),
          testType: z.string(),
          origin: z.string(),
          reviewStatus: z.string(),
          sourceFilePath: z.string().nullable(),
          suitePath: z.string().nullable(),
        }),
      ),
    )
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      const cases = await ctx.prisma.testCase.findMany({
        where: { projectId: input.projectId },
        include: { source: true, testPlan: true },
        orderBy: { updatedAt: "desc" },
      });
      return cases.map((tc) => ({
        id: tc.id,
        title: tc.title,
        testType: tc.testType,
        origin: tc.origin,
        reviewStatus: tc.reviewStatus,
        sourceFilePath: tc.source?.filePath ?? null,
        suitePath: tc.suitePath,
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
        suitePath: z.string().nullable(),
        source: z
          .object({
            filePath: z.string(),
            functionName: z.string().nullable(),
            framework: z.string(),
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
        suitePath: tc.suitePath,
        source: tc.source
          ? { filePath: tc.source.filePath, functionName: tc.source.functionName, framework: tc.source.framework }
          : null,
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
      const existing = await ctx.prisma.testCase.findUniqueOrThrow({ where: { id: input.id }, select: { projectId: true } });
      await requireProjectAccess(ctx, existing.projectId, "EDITOR");
      return ctx.prisma.testCase.update({
        where: { id: input.id },
        data: { reviewStatus: "APPROVED", reviewedById: ctx.user.id, reviewedAt: new Date(), reviewNote: input.note },
      });
    }),

  reject: protectedProcedure
    .input(z.object({ id: z.string(), note: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.testCase.findUniqueOrThrow({ where: { id: input.id }, select: { projectId: true } });
      await requireProjectAccess(ctx, existing.projectId, "EDITOR");
      return ctx.prisma.testCase.update({
        where: { id: input.id },
        data: { reviewStatus: "REJECTED", reviewedById: ctx.user.id, reviewedAt: new Date(), reviewNote: input.note },
      });
    }),

  assessRisk: protectedProcedure
    .input(z.object({ id: z.string() }))
    .output(z.object({ riskSeverity: z.string().nullable(), riskScore: z.number().nullable(), riskRationale: z.string().nullable() }))
    .mutation(async ({ ctx, input }) => {
      const tc = await ctx.prisma.testCase.findUniqueOrThrow({
        where: { id: input.id },
        include: { source: { select: { filePath: true } } },
      });
      await requireProjectAccess(ctx, tc.projectId, "EDITOR");

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
      await requireProjectAccess(ctx, input.projectId, "EDITOR");
      const unassessed = await ctx.prisma.testCase.findMany({
        where: { projectId: input.projectId, riskAssessedAt: null },
        include: { source: { select: { filePath: true } } },
        take: input.limit,
      });

      let assessedCount = 0;
      let failedCount = 0;
      for (const tc of unassessed) {
        try {
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
            },
          });
          assessedCount++;
        } catch {
          failedCount++;
        }
      }
      return { assessedCount, failedCount };
    }),

  create: protectedProcedure
    .input(testCaseContentSchema.extend({ projectId: z.string() }).refine(requireAtLeastOneFormat, {
      message: AT_LEAST_ONE_FORMAT_MESSAGE,
    }))
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId, "EDITOR");
      return ctx.prisma.testCase.create({
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
      await requireProjectAccess(ctx, existing.projectId, "EDITOR");

      // Steps don't have stable client-side ids yet (the form just edits an
      // ordered list), so replace-all is simpler and correct here; revisit
      // if per-step history/comments ever need steps to persist identity
      // across an edit.
      return ctx.prisma.$transaction(async (tx) => {
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
        data: { suitePath: input.suitePath || null },
      });
    }),
});
