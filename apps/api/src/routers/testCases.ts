import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { TestCaseStepInputSchema, resolveStepFieldLabels, type StepFieldKey } from "@vaettir/core";
import {
  assessTestCaseRisk,
  AutomationDraftSchema,
  AutomationFrameworkSchema,
  generateAutomationDraft,
  reviewTestCaseQuality,
  type TestCaseForReview,
} from "@vaettir/ai-agent";
import { Prisma } from "@vaettir/db";
import { router, protectedProcedure, requireProjectAccess } from "../trpc.js";
import { recordAudit } from "../services/auditLog.js";
import { chargeAiCredits, InsufficientAiCreditsError, meterAiCall } from "../services/aiCredits.js";
import { parseTestCaseCsv } from "../services/testCaseCsvImport.js";
import { snapshotTestCaseVersion } from "../services/testCaseVersion.js";

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
  // 2026-08-27 competitor parity audit: when set, `steps` above is
  // ignored - the case defers entirely to the referenced SharedStepGroup
  // instead (see the schema comment on TestCase.sharedStepGroupId).
  sharedStepGroupId: z.string().nullable().optional(),
  tags: z.array(z.string()).default([]),
  testType: z.string(),
  priority: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]).default("MEDIUM"),
  suitePath: z.string().optional(),
});

function requireAtLeastOneFormat(v: z.infer<typeof testCaseContentSchema>) {
  return (v.given.length > 0 && v.when.length > 0 && v.then.length > 0) || v.steps.length > 0 || Boolean(v.sharedStepGroupId);
}
const AT_LEAST_ONE_FORMAT_MESSAGE = "Provide given/when/then, at least one structured step, or a shared step library";

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

  // P11-07-adjacent (2026-08-27 competitor parity audit): importCsv existed
  // with no matching export - every competitor researched supports both
  // directions. Returns the exact same field shape importCsv's header set
  // expects (title/given/when/then/priority/tags), so export -> import is
  // genuinely round-trippable, not just "data out" with no way back in.
  // The actual CSV string construction happens client-side (same pattern
  // P3-04's compliance report export already uses) - this returns
  // structured data, not a pre-formatted file.
  exportCsv: protectedProcedure
    .input(z.object({ projectId: z.string(), includeArchived: z.boolean().default(false) }))
    .output(
      z.array(
        z.object({
          title: z.string(),
          given: z.array(z.string()),
          when: z.array(z.string()),
          then: z.array(z.string()),
          priority: z.string(),
          tags: z.array(z.string()),
        }),
      ),
    )
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      const cases = await ctx.prisma.testCase.findMany({
        where: { projectId: input.projectId, ...(input.includeArchived ? {} : { archived: false }) },
        orderBy: { title: "asc" },
        select: { title: true, given: true, when: true, then: true, priority: true, tags: true },
      });
      return cases;
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
        sharedStepGroupId: z.string().nullable(),
        sharedStepGroupName: z.string().nullable(),
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
          sharedStepGroup: true,
          project: { include: { organization: { select: { stepFieldLabels: true } } } },
          reviewedBy: { select: { name: true, email: true } },
        },
      });
      await requireProjectAccess(ctx, tc.projectId);
      // A case linked to a shared step group defers entirely to its
      // steps (see the schema comment on TestCase.sharedStepGroupId) -
      // resolved live here, not duplicated onto the case, so an edit to
      // the group is instantly reflected on every case that uses it.
      const resolvedSteps = tc.sharedStepGroup
        ? (tc.sharedStepGroup.steps as Array<{
            order: number;
            action: string;
            expectedActionOrData: string | null;
            expectedResult: string | null;
            expectedResponse: string | null;
          }>)
        : tc.steps.map((s) => ({
            order: s.order,
            action: s.action,
            expectedActionOrData: s.expectedActionOrData,
            expectedResult: s.expectedResult,
            expectedResponse: s.expectedResponse,
          }));
      return {
        id: tc.id,
        title: tc.title,
        background: tc.background,
        given: tc.given,
        when: tc.when,
        then: tc.then,
        steps: resolvedSteps,
        sharedStepGroupId: tc.sharedStepGroupId,
        sharedStepGroupName: tc.sharedStepGroup?.name ?? null,
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

  // .output() bounds the inferred type (TS2589 once react-query's useMutation
  // wrapper resolves it - same fix as organization.bootstrap); no caller
  // reads anything beyond the id from the returned row.
  approve: protectedProcedure
    .input(z.object({ id: z.string(), note: z.string().optional() }))
    .output(z.object({ id: z.string(), reviewStatus: z.string() }))
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
    .output(z.object({ id: z.string(), reviewStatus: z.string() }))
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

      const charge = await chargeAiCredits(ctx.prisma, project.organizationId, "assessTestCaseRisk").catch((e: unknown) => {
        if (e instanceof InsufficientAiCreditsError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
        }
        throw e;
      });

      const assessment = await meterAiCall(ctx.prisma, charge, () =>
        assessTestCaseRisk({
          title: tc.title,
          given: tc.given,
          when: tc.when,
          then: tc.then,
          testType: tc.testType,
          sourceFilePath: tc.source?.filePath,
        }),
      );

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

  generateAutomationDraft: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        framework: AutomationFrameworkSchema,
        projectContext: z.string().trim().max(12_000).optional(),
      }),
    )
    .output(AutomationDraftSchema)
    .mutation(async ({ ctx, input }) => {
      const tc = await ctx.prisma.testCase.findUniqueOrThrow({
        where: { id: input.id },
        include: {
          source: { select: { filePath: true } },
          steps: { orderBy: { order: "asc" } },
          sharedStepGroup: true,
          project: { select: { id: true, name: true, organizationId: true } },
        },
      });
      await requireProjectAccess(ctx, tc.projectId, "EDITOR");
      const charge = await chargeAiCredits(
        ctx.prisma,
        tc.project.organizationId,
        "generateAutomationDraft",
        `${input.framework} draft for TestCase ${tc.id}`,
      ).catch((error: unknown) => {
        if (error instanceof InsufficientAiCreditsError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
        }
        throw error;
      });
      const sharedSteps = tc.sharedStepGroup
        ? (tc.sharedStepGroup.steps as Array<{
            action: string;
            expectedActionOrData?: string | null;
            expectedResult?: string | null;
            expectedResponse?: string | null;
          }>)
        : tc.steps;
      return meterAiCall(ctx.prisma, charge, () =>
        generateAutomationDraft({
          framework: input.framework,
          projectName: tc.project.name,
          title: tc.title,
          background: tc.background,
          given: tc.given,
          when: tc.when,
          then: tc.then,
          structuredSteps: sharedSteps,
          sourceFilePath: tc.source?.filePath,
          projectContext: input.projectContext,
        }),
      );
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
          const charge = await chargeAiCredits(ctx.prisma, project.organizationId, "assessTestCaseRisk");
          const assessment = await meterAiCall(ctx.prisma, charge, () =>
            assessTestCaseRisk({
              title: tc.title,
              given: tc.given,
              when: tc.when,
              then: tc.then,
              testType: tc.testType,
              sourceFilePath: tc.source?.filePath,
            }),
          );
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

  // 2026-09-02: no procedure anywhere queried TestCase scoped to a
  // testPlanId before this - list() is project-wide only. Needed as its
  // own query (not just inlined into reviewPlanQuality below) since the
  // test plan detail page needs the case list to know whether there's
  // anything to review at all before offering the button.
  listForPlan: protectedProcedure
    .input(z.object({ testPlanId: z.string() }))
    .output(z.array(z.object({ id: z.string(), title: z.string() })))
    .query(async ({ ctx, input }) => {
      const plan = await ctx.prisma.testPlan.findUniqueOrThrow({ where: { id: input.testPlanId }, select: { projectId: true } });
      await requireProjectAccess(ctx, plan.projectId);
      const cases = await ctx.prisma.testCase.findMany({
        where: { testPlanId: input.testPlanId, archived: false },
        select: { id: true, title: true },
        orderBy: { createdAt: "asc" },
      });
      return cases;
    }),

  // Scans every (non-archived) case in a plan in a single AI call rather
  // than per-case, since the point is spotting patterns *across* cases
  // (near-duplicate coverage) that a one-case-at-a-time pass could never
  // see - unlike assessProjectRisk above, this can't be a sequential loop.
  // Capped at 30 cases per call: keeps the prompt a reasonable size and
  // caps the cost of one click: a plan with more than 30 needs more than
  // one pass, surfaced via `truncated` rather than silently only
  // reviewing the first page with no indication anything was skipped.
  reviewPlanQuality: protectedProcedure
    .input(z.object({ testPlanId: z.string() }))
    .output(
      z.object({
        issues: z.array(
          z.object({ testCaseId: z.string(), issueType: z.string(), description: z.string(), suggestion: z.string() }),
        ),
        duplicateGroups: z.array(z.object({ testCaseIds: z.array(z.string()), reason: z.string() })),
        reviewedCount: z.number(),
        truncated: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const plan = await ctx.prisma.testPlan.findUniqueOrThrow({ where: { id: input.testPlanId }, select: { projectId: true } });
      const { project } = await requireProjectAccess(ctx, plan.projectId, "EDITOR");

      const REVIEW_LIMIT = 30;
      const allCases = await ctx.prisma.testCase.findMany({
        where: { testPlanId: input.testPlanId, archived: false },
        include: { steps: { orderBy: { order: "asc" } }, sharedStepGroup: true },
        orderBy: { createdAt: "asc" },
        take: REVIEW_LIMIT + 1,
      });
      const truncated = allCases.length > REVIEW_LIMIT;
      const cases = allCases.slice(0, REVIEW_LIMIT);
      if (cases.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This test plan has no test cases to review." });
      }

      const charge = await chargeAiCredits(ctx.prisma, project.organizationId, "reviewTestCaseQuality").catch((e: unknown) => {
        if (e instanceof InsufficientAiCreditsError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
        }
        throw e;
      });

      const forReview: TestCaseForReview[] = cases.map((tc) => ({
        id: tc.id,
        title: tc.title,
        given: tc.given,
        when: tc.when,
        then: tc.then,
        steps: tc.sharedStepGroup
          ? (tc.sharedStepGroup.steps as Array<{ action: string; expectedResult: string | null }>)
          : tc.steps.map((s) => ({ action: s.action, expectedResult: s.expectedResult })),
      }));

      const review = await meterAiCall(ctx.prisma, charge, () => reviewTestCaseQuality(forReview));
      const validIds = new Set(cases.map((c) => c.id));
      return {
        // The AI is instructed to only use real ids, but it's cheap
        // insurance to drop anything it invented rather than let a bogus
        // id reach the UI and fail to link anywhere.
        issues: review.issues.filter((i) => validIds.has(i.testCaseId)),
        duplicateGroups: review.duplicateGroups
          .map((g) => ({ ...g, testCaseIds: g.testCaseIds.filter((id) => validIds.has(id)) }))
          .filter((g) => g.testCaseIds.length >= 2),
        reviewedCount: cases.length,
        truncated,
      };
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
          sharedStepGroupId: input.sharedStepGroupId || undefined,
          // A case linked to a shared group defers entirely to it - see
          // the schema comment on sharedStepGroupId - so it owns no
          // structured steps of its own.
          steps: input.sharedStepGroupId
            ? undefined
            : {
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
      await snapshotTestCaseVersion(ctx.prisma, {
        testCaseId: created.id,
        title: created.title,
        background: created.background,
        given: created.given,
        when: created.when,
        then: created.then,
        steps: input.steps.map((s, i) => ({
          order: i,
          action: s.action,
          expectedActionOrData: s.expectedActionOrData ?? null,
          expectedResult: s.expectedResult ?? null,
          expectedResponse: s.expectedResponse ?? null,
        })),
        tags: created.tags,
        priority: created.priority,
        testType: created.testType,
        actorId: ctx.user.id,
      });
      return created;
    }),

  // P11-07: the generic catch-all importer for a spreadsheet-tracked suite
  // with no first-class importer (PractiTest, TestLink, or just "we keep
  // our cases in a spreadsheet"). Recognizes a fixed common header set
  // (see testCaseCsvImport.ts) rather than a full field-mapping UI (P11-02,
  // separate ticket) - a reasonable, immediately-usable middle ground.
  // Origin: IMPORTED, same as the existing Gherkin/Postman importers -
  // human-authored-elsewhere content skips the AI trust gate (lands
  // APPROVED, not PENDING_REVIEW).
  importCsv: protectedProcedure
    .input(z.object({ projectId: z.string(), csvText: z.string().min(1), testPlanId: z.string().optional() }))
    .output(
      z.object({
        createdCount: z.number(),
        skipped: z.array(z.object({ rowNumber: z.number(), reason: z.string() })),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { project } = await requireProjectAccess(ctx, input.projectId, "EDITOR");

      let parsed;
      try {
        parsed = parseTestCaseCsv(input.csvText);
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : String(e) });
      }

      const created = await ctx.prisma.$transaction(
        parsed.cases.map((c) =>
          ctx.prisma.testCase.create({
            data: {
              projectId: input.projectId,
              testPlanId: input.testPlanId,
              title: c.title,
              given: c.given,
              when: c.when,
              then: c.then,
              tags: c.tags,
              testType: "FUNCTIONAL",
              priority: c.priority,
              origin: "IMPORTED",
              createdById: ctx.user.id,
              updatedById: ctx.user.id,
            },
          }),
        ),
      );

      if (created.length > 0) {
        await recordAudit(ctx.prisma, {
          organizationId: project.organizationId,
          projectId: input.projectId,
          actorId: ctx.user.id,
          entityType: "TestCase",
          entityId: created[0]!.id,
          action: "CREATE",
          summary: `Imported ${created.length} test case(s) from CSV`,
        });
        await Promise.all(
          created.map((c) =>
            snapshotTestCaseVersion(ctx.prisma, {
              testCaseId: c.id,
              title: c.title,
              background: c.background,
              given: c.given,
              when: c.when,
              then: c.then,
              steps: [],
              tags: c.tags,
              priority: c.priority,
              testType: c.testType,
              actorId: ctx.user.id,
            }),
          ),
        );
      }

      return { createdCount: created.length, skipped: parsed.skipped };
    }),

  update: protectedProcedure
    .input(testCaseContentSchema.extend({ id: z.string() }).refine(requireAtLeastOneFormat, {
      message: AT_LEAST_ONE_FORMAT_MESSAGE,
    }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.testCase.findUniqueOrThrow({
        where: { id: input.id },
        select: { projectId: true, origin: true, title: true, given: true, when: true, then: true },
      });
      const { project } = await requireProjectAccess(ctx, existing.projectId, "EDITOR");

      // P2-07: a human correcting the AI's own output is the raw material
      // for tightening the system prompt later -- capture it only when the
      // BDD content actually changed (not e.g. just priority/tags/suite)
      // on a case the AI originally wrote. An AUTHORED or IMPORTED case
      // being edited isn't AI feedback, it's just normal editing.
      const contentChanged =
        existing.title !== input.title ||
        JSON.stringify(existing.given) !== JSON.stringify(input.given) ||
        JSON.stringify(existing.when) !== JSON.stringify(input.when) ||
        JSON.stringify(existing.then) !== JSON.stringify(input.then);
      const shouldCaptureFeedback = existing.origin === "AI_REVERSE_ENGINEERED" && contentChanged;

      // Steps don't have stable client-side ids yet (the form just edits an
      // ordered list), so replace-all is simpler and correct here; revisit
      // if per-step history/comments ever need steps to persist identity
      // across an edit.
      const updated = await ctx.prisma.$transaction(async (tx) => {
        if (shouldCaptureFeedback) {
          await tx.aiEditFeedback.create({
            data: {
              testCaseId: input.id,
              projectId: existing.projectId,
              beforeTitle: existing.title,
              beforeGiven: existing.given,
              beforeWhen: existing.when,
              beforeThen: existing.then,
              afterTitle: input.title,
              afterGiven: input.given,
              afterWhen: input.when,
              afterThen: input.then,
              editedById: ctx.user.id,
            },
          });
        }
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
            sharedStepGroupId: input.sharedStepGroupId || null,
            steps: input.sharedStepGroupId
              ? undefined
              : {
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
      await snapshotTestCaseVersion(ctx.prisma, {
        testCaseId: updated.id,
        title: updated.title,
        background: updated.background,
        given: updated.given,
        when: updated.when,
        then: updated.then,
        steps: input.steps.map((s, i) => ({
          order: i,
          action: s.action,
          expectedActionOrData: s.expectedActionOrData ?? null,
          expectedResult: s.expectedResult ?? null,
          expectedResponse: s.expectedResponse ?? null,
        })),
        tags: updated.tags,
        priority: updated.priority,
        testType: updated.testType,
        actorId: ctx.user.id,
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

  // P2-07: lists captured before/after edits of AI-reverse-engineered
  // cases, most recent first -- the actual "periodically review edit
  // patterns" step is a human reading this list and deciding whether the
  // system prompt needs adjusting, not something this endpoint automates.
  listAiEditFeedback: protectedProcedure
    .input(z.object({ projectId: z.string(), limit: z.number().int().min(1).max(200).default(50) }))
    .output(
      z.array(
        z.object({
          id: z.string(),
          testCaseId: z.string(),
          beforeTitle: z.string(),
          beforeGiven: z.array(z.string()),
          beforeWhen: z.array(z.string()),
          beforeThen: z.array(z.string()),
          afterTitle: z.string(),
          afterGiven: z.array(z.string()),
          afterWhen: z.array(z.string()),
          afterThen: z.array(z.string()),
          editedAt: z.date(),
          editedByEmail: z.string(),
        }),
      ),
    )
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      const rows = await ctx.prisma.aiEditFeedback.findMany({
        where: { projectId: input.projectId },
        include: { editedBy: { select: { email: true } } },
        orderBy: { editedAt: "desc" },
        take: input.limit,
      });
      return rows.map((r) => ({
        id: r.id,
        testCaseId: r.testCaseId,
        beforeTitle: r.beforeTitle,
        beforeGiven: r.beforeGiven,
        beforeWhen: r.beforeWhen,
        beforeThen: r.beforeThen,
        afterTitle: r.afterTitle,
        afterGiven: r.afterGiven,
        afterWhen: r.afterWhen,
        afterThen: r.afterThen,
        editedAt: r.editedAt,
        editedByEmail: r.editedBy.email,
      }));
    }),

  // Every full snapshot for a case, newest first - same shape/reasoning as
  // testPlans.ts's history query, just for the case itself instead of the
  // plan it belongs to.
  history: protectedProcedure
    .input(z.object({ testCaseId: z.string() }))
    .output(
      z.array(
        z.object({
          versionNumber: z.number(),
          title: z.string(),
          background: z.string().nullable(),
          given: z.array(z.string()),
          when: z.array(z.string()),
          then: z.array(z.string()),
          steps: z.array(stepOutputSchema),
          tags: z.array(z.string()),
          priority: z.string(),
          testType: z.string(),
          createdAt: z.date(),
          createdBy: z.object({ id: z.string(), name: z.string().nullable(), email: z.string() }).nullable(),
        }),
      ),
    )
    .query(async ({ ctx, input }) => {
      const testCase = await ctx.prisma.testCase.findUniqueOrThrow({ where: { id: input.testCaseId }, select: { projectId: true } });
      await requireProjectAccess(ctx, testCase.projectId);
      const versions = await ctx.prisma.testCaseVersion.findMany({
        where: { testCaseId: input.testCaseId },
        include: { createdBy: { select: { id: true, name: true, email: true } } },
        orderBy: { versionNumber: "desc" },
      });
      return versions.map((v) => ({
        versionNumber: v.versionNumber,
        title: v.title,
        background: v.background,
        given: v.given,
        when: v.when,
        then: v.then,
        steps: v.steps as never,
        tags: v.tags,
        priority: v.priority,
        testType: v.testType,
        createdAt: v.createdAt,
        createdBy: v.createdBy,
      }));
    }),
});
