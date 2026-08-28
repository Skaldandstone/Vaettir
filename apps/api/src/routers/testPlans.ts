import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { generateQaStrategyDraft } from "@vaettir/ai-agent";
import { router, protectedProcedure, requireProjectAccess } from "../trpc.js";
import { recordAudit } from "../services/auditLog.js";
import { snapshotTestPlanVersion } from "../services/testPlanVersion.js";
import { chargeAiCredits, InsufficientAiCreditsError } from "../services/aiCredits.js";
import { getCommitLog } from "../services/changeImpact.js";

const acceptanceCriterionOutput = z.object({
  id: z.string(),
  description: z.string(),
  status: z.string(),
  requirementId: z.string().nullable(),
});

export const testPlansRouter = router({
  list: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .output(
      z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          status: z.string(),
          releaseId: z.string().nullable(),
          testPlanType: z.object({ id: z.string(), name: z.string() }),
          acceptanceCriteria: z.array(z.object({ id: z.string() })),
        }),
      ),
    )
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      return ctx.prisma.testPlan.findMany({
        where: { projectId: input.projectId },
        include: { testPlanType: true, acceptanceCriteria: true },
        orderBy: { updatedAt: "desc" },
      });
    }),

  // Not project-scoped: built-in + org-defined plan types are shared
  // reference data, not something a single project owns.
  types: protectedProcedure
    .output(
      z.array(
        z.object({
          id: z.string(),
          key: z.string(),
          name: z.string(),
          category: z.string(),
          description: z.string().nullable(),
          fieldSchema: z.unknown(),
          isBuiltIn: z.boolean(),
        }),
      ),
    )
    .query(({ ctx }) => ctx.prisma.testPlanType.findMany({ orderBy: [{ isBuiltIn: "desc" }, { name: "asc" }] })),

  // P3-09: the "add your own compliance form" flow -- an org admin builds a
  // new plan shape (a field list, not a JSON Schema doc they hand-write) and
  // it's immediately available to author TestPlans against, with zero code
  // change or migration. `fields` is a small builder-friendly shape that
  // gets compiled into the JSON Schema `TestPlanType.fieldSchema` already
  // expected by the existing generic CustomFieldsForm renderer -- proving
  // the render side and the authoring side both really are schema-driven,
  // not just the render side. Not project-scoped for the same reason
  // `types` isn't: this is shared reference data like ComplianceFramework,
  // not something a single project owns.
  createType: protectedProcedure
    .input(
      z.object({
        key: z.string().min(1),
        name: z.string().min(1),
        category: z.enum(["FUNCTIONAL", "QUALITY_STRATEGY", "COMPLIANCE", "RELEASE_READINESS", "CUSTOM"]),
        description: z.string().optional(),
        fields: z
          .array(
            z.object({
              key: z.string().min(1),
              type: z.enum(["string", "number", "array"]),
            }),
          )
          .min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.testPlanType.findUnique({ where: { key: input.key } });
      if (existing) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `A plan type with key "${input.key}" already exists` });
      }
      const properties: Record<string, { type: string; items?: { type: string } }> = {};
      for (const f of input.fields) {
        properties[f.key] = f.type === "array" ? { type: "array", items: { type: "string" } } : { type: f.type };
      }
      return ctx.prisma.testPlanType.create({
        data: {
          key: input.key,
          name: input.name,
          category: input.category,
          description: input.description,
          fieldSchema: { type: "object", properties } as never,
          isBuiltIn: false,
        },
      });
    }),

  byId: protectedProcedure
    .input(z.object({ id: z.string() }))
    .output(
      z.object({
        id: z.string(),
        projectId: z.string(),
        name: z.string(),
        description: z.string().nullable(),
        status: z.string(),
        releaseId: z.string().nullable(),
        customFields: z.record(z.unknown()),
        testPlanType: z.object({
          id: z.string(),
          key: z.string(),
          name: z.string(),
          category: z.string(),
          fieldSchema: z.unknown(),
        }),
        strategyId: z.string().nullable(),
        strategyName: z.string().nullable(),
        linkedPlans: z.array(z.object({ id: z.string(), name: z.string(), status: z.string() })),
        acceptanceCriteria: z.array(acceptanceCriterionOutput),
      }),
    )
    .query(async ({ ctx, input }) => {
      const plan = await ctx.prisma.testPlan.findUniqueOrThrow({
        where: { id: input.id },
        include: {
          testPlanType: true,
          acceptanceCriteria: { orderBy: { createdAt: "asc" } },
          strategy: { select: { name: true } },
          linkedPlans: { select: { id: true, name: true, status: true }, orderBy: { updatedAt: "desc" } },
        },
      });
      await requireProjectAccess(ctx, plan.projectId);
      return {
        id: plan.id,
        projectId: plan.projectId,
        name: plan.name,
        description: plan.description,
        status: plan.status,
        releaseId: plan.releaseId,
        customFields: plan.customFields as Record<string, unknown>,
        testPlanType: {
          id: plan.testPlanType.id,
          key: plan.testPlanType.key,
          name: plan.testPlanType.name,
          category: plan.testPlanType.category,
          fieldSchema: plan.testPlanType.fieldSchema,
        },
        strategyId: plan.strategyId,
        strategyName: plan.strategy?.name ?? null,
        linkedPlans: plan.linkedPlans,
        acceptanceCriteria: plan.acceptanceCriteria,
      };
    }),

  create: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        testPlanTypeId: z.string(),
        name: z.string(),
        description: z.string().optional(),
        customFields: z.record(z.unknown()).default({}),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { project } = await requireProjectAccess(ctx, input.projectId, "EDITOR");
      const created = await ctx.prisma.testPlan.create({
        data: {
          projectId: input.projectId,
          testPlanTypeId: input.testPlanTypeId,
          name: input.name,
          description: input.description,
          customFields: input.customFields as never,
          createdById: ctx.user.id,
          updatedById: ctx.user.id,
        },
      });
      await recordAudit(ctx.prisma, {
        organizationId: project.organizationId,
        projectId: input.projectId,
        actorId: ctx.user.id,
        entityType: "TestPlan",
        entityId: created.id,
        action: "CREATE",
        summary: `Created test plan "${created.name}"`,
      });
      await snapshotTestPlanVersion(ctx.prisma, {
        testPlanId: created.id,
        name: created.name,
        description: created.description,
        status: created.status,
        customFields: created.customFields,
        actorId: ctx.user.id,
      });
      return created;
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1),
        description: z.string().optional(),
        status: z.enum(["DRAFT", "ACTIVE", "IN_REVIEW", "APPROVED"]),
        customFields: z.record(z.unknown()).default({}),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.testPlan.findUniqueOrThrow({
        where: { id: input.id },
        select: { projectId: true },
      });
      const { project } = await requireProjectAccess(ctx, existing.projectId, "EDITOR");
      const updated = await ctx.prisma.testPlan.update({
        where: { id: input.id },
        data: {
          name: input.name,
          description: input.description,
          status: input.status,
          customFields: input.customFields as never,
          updatedById: ctx.user.id,
        },
      });
      await recordAudit(ctx.prisma, {
        organizationId: project.organizationId,
        projectId: existing.projectId,
        actorId: ctx.user.id,
        entityType: "TestPlan",
        entityId: input.id,
        action: "UPDATE",
        summary: `Updated test plan "${updated.name}" (status: ${updated.status})`,
      });
      await snapshotTestPlanVersion(ctx.prisma, {
        testPlanId: updated.id,
        name: updated.name,
        description: updated.description,
        status: updated.status,
        customFields: updated.customFields,
        actorId: ctx.user.id,
      });
      return updated;
    }),

  setRelease: protectedProcedure
    .input(z.object({ testPlanId: z.string(), releaseId: z.string().nullable() }))
    .mutation(async ({ ctx, input }) => {
      const plan = await ctx.prisma.testPlan.findUniqueOrThrow({
        where: { id: input.testPlanId },
        select: { projectId: true },
      });
      await requireProjectAccess(ctx, plan.projectId, "EDITOR");
      if (input.releaseId) {
        const release = await ctx.prisma.release.findUniqueOrThrow({ where: { id: input.releaseId } });
        if (release.projectId !== plan.projectId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "That release does not belong to this project" });
        }
      }
      return ctx.prisma.testPlan.update({
        where: { id: input.testPlanId },
        data: { releaseId: input.releaseId, updatedById: ctx.user.id },
        select: { id: true, releaseId: true },
      });
    }),

  // P4-02: drafts a starter QA strategy from a short user prompt plus a real
  // summary of the project's existing test coverage (frameworks in use,
  // test counts per type) -- not a from-scratch generic template. Returns
  // the draft for review; it isn't saved as a TestPlan until the user
  // explicitly creates one from it via the normal `create` mutation, same
  // as reviewing an AI-reverse-engineered test case before it's approved.
  generateStrategyDraft: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        prompt: z.string().min(1),
        // 2026-08-28: ground generation in a real build/release instead
        // of relying purely on the free-text prompt - "PRs in a release"
        // (in practice, the commit log between two refs; see
        // getCommitLog's comment for why that's the git-host-agnostic
        // equivalent of hitting a provider-specific PR API) or "a build"
        // are both just a ref range. baseRef defaults to the project's
        // own default branch when headRef is given but baseRef isn't.
        baseRef: z.string().optional(),
        headRef: z.string().optional(),
      }),
    )
    .output(
      z.object({
        riskAreas: z.array(z.string()),
        environments: z.array(z.string()),
        entryCriteria: z.array(z.string()),
        exitCriteria: z.array(z.string()),
        // Surfaced back so the review UI can show exactly what real
        // commits the draft was grounded in, not just trust it silently.
        groundedInCommits: z.array(z.object({ sha: z.string(), subject: z.string() })).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId, "EDITOR");
      const project = await ctx.prisma.project.findUniqueOrThrow({
        where: { id: input.projectId },
        select: { name: true, organizationId: true, repoUrl: true, defaultBranch: true },
      });

      let changesSummary: string | undefined;
      let groundedInCommits: { sha: string; subject: string }[] | undefined;
      if (input.headRef) {
        if (!project.repoUrl) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "This project has no repo connected to ground generation in" });
        }
        const commits = await getCommitLog(project.repoUrl, input.baseRef ?? project.defaultBranch, input.headRef);
        if (commits.length === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `No commits found between ${input.baseRef ?? project.defaultBranch} and ${input.headRef}`,
          });
        }
        groundedInCommits = commits;
        changesSummary = commits.map((c) => `- ${c.sha} ${c.subject}`).join("\n");
      }

      try {
        await chargeAiCredits(ctx.prisma, project.organizationId, "generateQaStrategyDraft");
      } catch (e) {
        if (e instanceof InsufficientAiCreditsError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
        }
        throw e;
      }
      const [testTypeGroups, frameworkGroups, totalTestCases] = await Promise.all([
        ctx.prisma.testCase.groupBy({ by: ["testType"], where: { projectId: input.projectId }, _count: true }),
        ctx.prisma.testCaseSource.groupBy({
          by: ["frameworkFamily"],
          where: { testCase: { projectId: input.projectId } },
          _count: true,
        }),
        ctx.prisma.testCase.count({ where: { projectId: input.projectId } }),
      ]);
      const testTypeCounts = Object.fromEntries(testTypeGroups.map((g) => [g.testType, g._count]));
      const frameworksInUse = frameworkGroups.map((g) => g.frameworkFamily);

      const draft = await generateQaStrategyDraft({
        projectName: project.name,
        prompt: input.prompt,
        frameworksInUse,
        testTypeCounts,
        totalTestCases,
        changesSummary,
      });
      return { ...draft, groundedInCommits };
    }),

  // P4-03: rule-based risk-area suggestions, cross-referencing structured
  // signals the platform already has instead of an LLM guessing from a
  // prompt (that's P4-02) or a user typing risk areas from scratch. Three
  // sources, each a real, checkable fact rather than an inference:
  //   - open RiskFlags on the project's releases, most severe first
  //   - test cases with a real recent failure rate (>=30% over at least 3
  //     of their last 20 results) -- a genuine "this keeps breaking" signal
  //   - compliance controls with zero mapped test cases in this project,
  //     across every framework the project actually maps controls under
  // Capped and ranked so this reads as a short, prioritized list, not a
  // data dump.
  suggestRiskAreas: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .output(
      z.array(
        z.object({
          area: z.string(),
          rationale: z.string(),
          source: z.enum(["RISK_FLAG", "FAILURE_RATE", "COMPLIANCE_GAP"]),
        }),
      ),
    )
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);

      const SEVERITY_WEIGHT: Record<string, number> = { CRITICAL: 3, HIGH: 2, MEDIUM: 1, LOW: 0 };
      const suggestions: { area: string; rationale: string; source: "RISK_FLAG" | "FAILURE_RATE" | "COMPLIANCE_GAP" }[] = [];

      const openFlags = await ctx.prisma.riskFlag.findMany({
        where: { release: { projectId: input.projectId }, resolvedAt: null },
        orderBy: { createdAt: "desc" },
        take: 50,
      });
      openFlags.sort((a, b) => (SEVERITY_WEIGHT[b.severity] ?? 0) - (SEVERITY_WEIGHT[a.severity] ?? 0));
      for (const f of openFlags.slice(0, 5)) {
        suggestions.push({
          area: f.relatedFilePath ?? f.description.slice(0, 80),
          rationale: `Open ${f.severity} risk flag: ${f.description}`,
          source: "RISK_FLAG",
        });
      }

      const recentResults = await ctx.prisma.testResult.findMany({
        where: { testCase: { projectId: input.projectId } },
        include: { testCase: { select: { id: true, title: true } }, testRun: { select: { startedAt: true } } },
        orderBy: { testRun: { startedAt: "desc" } },
        take: 1000,
      });
      const byTestCase = new Map<string, { title: string; pass: number; fail: number }>();
      for (const r of recentResults) {
        if (!r.testCase || (r.status !== "PASS" && r.status !== "FAIL")) continue;
        const entry = byTestCase.get(r.testCase.id) ?? { title: r.testCase.title, pass: 0, fail: 0 };
        // Cap at each test case's most recent 20 results -- recentResults is
        // already ordered newest-first, so once a case has 20 counted here
        // any further (older) result for it is outside the lookback window.
        if (entry.pass + entry.fail < 20) {
          if (r.status === "PASS") entry.pass++;
          else entry.fail++;
        }
        byTestCase.set(r.testCase.id, entry);
      }
      const failureRateFlags = [...byTestCase.entries()]
        .map(([id, e]) => ({ id, title: e.title, total: e.pass + e.fail, failRate: e.fail / (e.pass + e.fail) }))
        .filter((e) => e.total >= 3 && e.failRate >= 0.3)
        .sort((a, b) => b.failRate - a.failRate)
        .slice(0, 5);
      for (const f of failureRateFlags) {
        suggestions.push({
          area: f.title,
          rationale: `Failed ${Math.round(f.failRate * 100)}% of its last ${f.total} runs`,
          source: "FAILURE_RATE",
        });
      }

      const frameworksInUse = await ctx.prisma.testCaseComplianceControl.findMany({
        where: { testCase: { projectId: input.projectId } },
        select: { control: { select: { frameworkId: true } } },
        distinct: ["controlId"],
      });
      const frameworkIds = [...new Set(frameworksInUse.map((f) => f.control.frameworkId))];
      if (frameworkIds.length > 0) {
        const controls = await ctx.prisma.complianceControl.findMany({
          where: { frameworkId: { in: frameworkIds } },
          include: {
            framework: { select: { name: true } },
            _count: { select: { testCases: { where: { testCase: { projectId: input.projectId } } } } },
          },
        });
        const gaps = controls.filter((c) => c._count.testCases === 0).slice(0, 5);
        for (const c of gaps) {
          suggestions.push({
            area: `${c.framework.name} - ${c.code}`,
            rationale: `Compliance control "${c.title}" has no mapped test cases in this project`,
            source: "COMPLIANCE_GAP",
          });
        }
      }

      return suggestions;
    }),

  // P4-06: "live status of each strategy's exit criteria against current
  // test/coverage data," scoped down to what's actually reliable to
  // compute. Exit criteria are free text ("Zero open Sev1 risk flags",
  // "95% of the E2E suite passing") -- auto-deriving a MET/NOT_MET verdict
  // per criterion would mean parsing arbitrary prose into a checkable
  // predicate, which is exactly the problem P7-02 (AcceptanceCriterion
  // status) also punts on even with this same pipeline available. Instead
  // this surfaces the real project-wide signals a human needs to eyeball
  // their own exit criteria against: recent pass rate, latest coverage,
  // open risk flags by severity, and how many tests are currently flaky.
  // A genuine "preview of the Phase 7 dashboard, scoped to one strategy,"
  // not a best-effort auto-grader.
  strategySignals: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .output(
      z.object({
        passRate: z.object({ passed: z.number(), failed: z.number(), skipped: z.number(), total: z.number() }),
        latestCoverage: z.object({ linesCovered: z.number(), linesTotal: z.number(), createdAt: z.date() }).nullable(),
        openRiskFlags: z.object({ critical: z.number(), high: z.number(), medium: z.number(), low: z.number() }),
        flakyTestCount: z.number(),
      }),
    )
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);

      const [recentResults, latestCoverage, openFlags, flakyTestCount] = await Promise.all([
        ctx.prisma.testResult.findMany({
          // testRun.projectId, not testCase.projectId -- an unmatched
          // result (no linked TestCase yet, the common case right after
          // P5-01 ingestion before P5-04/P5-14 catch up) still belongs to
          // this project's pass-rate signal. Filtering on the TestCase
          // relation would silently drop every unmatched result instead.
          where: { testRun: { projectId: input.projectId } },
          select: { status: true },
          orderBy: { testRun: { startedAt: "desc" } },
          take: 200,
        }),
        ctx.prisma.coverageReport.findFirst({
          where: { projectId: input.projectId },
          orderBy: { createdAt: "desc" },
          select: { linesCovered: true, linesTotal: true, createdAt: true },
        }),
        ctx.prisma.riskFlag.findMany({
          where: { release: { projectId: input.projectId }, resolvedAt: null },
          select: { severity: true },
        }),
        ctx.prisma.testCase.count({ where: { projectId: input.projectId, isFlaky: true } }),
      ]);

      return {
        passRate: {
          passed: recentResults.filter((r) => r.status === "PASS").length,
          failed: recentResults.filter((r) => r.status === "FAIL").length,
          skipped: recentResults.filter((r) => r.status === "SKIP").length,
          total: recentResults.length,
        },
        latestCoverage,
        openRiskFlags: {
          critical: openFlags.filter((f) => f.severity === "CRITICAL").length,
          high: openFlags.filter((f) => f.severity === "HIGH").length,
          medium: openFlags.filter((f) => f.severity === "MEDIUM").length,
          low: openFlags.filter((f) => f.severity === "LOW").length,
        },
        flakyTestCount,
      };
    }),

  // P4-05: full version history, most recent first -- each entry is a
  // complete snapshot (not just the AuditLog's one-line summary) so "what
  // did the risk areas actually say two releases ago" has a real answer.
  history: protectedProcedure
    .input(z.object({ testPlanId: z.string() }))
    .output(
      z.array(
        z.object({
          versionNumber: z.number(),
          name: z.string(),
          description: z.string().nullable(),
          status: z.string(),
          customFields: z.record(z.unknown()),
          createdAt: z.date(),
          createdBy: z.object({ id: z.string(), name: z.string().nullable(), email: z.string() }).nullable(),
        }),
      ),
    )
    .query(async ({ ctx, input }) => {
      const plan = await ctx.prisma.testPlan.findUniqueOrThrow({ where: { id: input.testPlanId }, select: { projectId: true } });
      await requireProjectAccess(ctx, plan.projectId);
      const versions = await ctx.prisma.testPlanVersion.findMany({
        where: { testPlanId: input.testPlanId },
        include: { createdBy: { select: { id: true, name: true, email: true } } },
        orderBy: { versionNumber: "desc" },
      });
      return versions.map((v) => ({
        versionNumber: v.versionNumber,
        name: v.name,
        description: v.description,
        status: v.status,
        customFields: v.customFields as Record<string, unknown>,
        createdAt: v.createdAt,
        createdBy: v.createdBy,
      }));
    }),

  // P4-04: the strategy picker's data source -- every QUALITY_STRATEGY-type
  // plan in the project a plan could link up to. Excludes the plan being
  // edited itself (a strategy can't support itself) when `excludeId` is given.
  strategiesInProject: protectedProcedure
    .input(z.object({ projectId: z.string(), excludeId: z.string().optional() }))
    .output(z.array(z.object({ id: z.string(), name: z.string() })))
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      return ctx.prisma.testPlan.findMany({
        where: {
          projectId: input.projectId,
          testPlanType: { category: "QUALITY_STRATEGY" },
          id: input.excludeId ? { not: input.excludeId } : undefined,
        },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      });
    }),

  // P4-04: lets a concrete plan (e.g. "regression plan for payments") point
  // back at the strategy it exists to support, turning a strategy plan into
  // a real coordination hub rather than just a document. Only a
  // QUALITY_STRATEGY-category plan can be the target -- linking a plan to
  // some other functional plan wouldn't mean anything here.
  setStrategyLink: protectedProcedure
    .input(z.object({ testPlanId: z.string(), strategyId: z.string().nullable() }))
    .mutation(async ({ ctx, input }) => {
      const plan = await ctx.prisma.testPlan.findUniqueOrThrow({
        where: { id: input.testPlanId },
        select: { projectId: true },
      });
      await requireProjectAccess(ctx, plan.projectId, "EDITOR");
      if (input.strategyId) {
        if (input.strategyId === input.testPlanId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "A plan can't support itself as a strategy" });
        }
        const strategy = await ctx.prisma.testPlan.findUnique({
          where: { id: input.strategyId },
          include: { testPlanType: { select: { category: true } } },
        });
        if (!strategy || strategy.projectId !== plan.projectId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "That strategy does not belong to this project" });
        }
        if (strategy.testPlanType.category !== "QUALITY_STRATEGY") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Only a QA strategy plan can be linked as a strategy" });
        }
      }
      return ctx.prisma.testPlan.update({
        where: { id: input.testPlanId },
        data: { strategyId: input.strategyId, updatedById: ctx.user.id },
        select: { id: true, strategyId: true },
      });
    }),

  addAcceptanceCriterion: protectedProcedure
    .input(
      z.object({
        testPlanId: z.string(),
        description: z.string().min(1),
        requirementId: z.string().optional(),
      }),
    )
    .output(acceptanceCriterionOutput)
    .mutation(async ({ ctx, input }) => {
      const plan = await ctx.prisma.testPlan.findUniqueOrThrow({
        where: { id: input.testPlanId },
        select: { projectId: true },
      });
      await requireProjectAccess(ctx, plan.projectId, "EDITOR");
      return ctx.prisma.acceptanceCriterion.create({
        data: {
          testPlanId: input.testPlanId,
          description: input.description,
          requirementId: input.requirementId,
        },
      });
    }),

  updateAcceptanceCriterion: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        description: z.string().min(1),
        status: z.enum(["PENDING", "MET", "NOT_MET", "AT_RISK"]),
        requirementId: z.string().nullable().optional(),
      }),
    )
    .output(acceptanceCriterionOutput)
    .mutation(async ({ ctx, input }) => {
      const criterion = await ctx.prisma.acceptanceCriterion.findUniqueOrThrow({
        where: { id: input.id },
        include: { testPlan: { select: { projectId: true } } },
      });
      await requireProjectAccess(ctx, criterion.testPlan.projectId, "EDITOR");
      return ctx.prisma.acceptanceCriterion.update({
        where: { id: input.id },
        data: { description: input.description, status: input.status, requirementId: input.requirementId },
      });
    }),

  deleteAcceptanceCriterion: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const criterion = await ctx.prisma.acceptanceCriterion.findUniqueOrThrow({
        where: { id: input.id },
        include: { testPlan: { select: { projectId: true } } },
      });
      await requireProjectAccess(ctx, criterion.testPlan.projectId, "EDITOR");
      await ctx.prisma.acceptanceCriterion.delete({ where: { id: input.id } });
    }),
});
