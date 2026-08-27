import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { recommendTestPlansForDiff } from "@vaettir/ai-agent";
import { router, protectedProcedure, requireProjectAccess } from "../trpc.js";
import { getChangedFiles, getDiffContent } from "../services/changeImpact.js";
import { matchChangedFilesToTestCases } from "../services/changeMatch.js";
import { getPathSeverityRules, severityForPath, parsePathSeverityRules } from "../services/prScanPolicy.js";
import { chargeAiCredits, InsufficientAiCreditsError } from "../services/aiCredits.js";

const recommendationOutput = z.object({
  testCaseId: z.string(),
  title: z.string(),
  matchReason: z.string(),
  riskScore: z.number().nullable(),
  riskSeverity: z.string().nullable(),
  sourceFilePath: z.string().nullable(),
});

export const riskAnalysisRouter = router({
  // Diffs baseRef...headRef (merge-base diff, like a PR compare view) and
  // matches changed files against known TestCase source files -- a test
  // whose source file was literally touched by the diff always belongs in
  // the must-run set (this isn't sampling; the code under it changed).
  // Changed files with NO matching test case are surfaced separately as
  // coverage gaps, since "nothing would catch a regression here" is itself
  // the most actionable finding a change-impact tool can produce.
  recommendForChange: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        repoUrl: z.string().optional(),
        baseRef: z.string().default("main"),
        headRef: z.string(),
        // Optional: when given, coverage gaps become real RiskFlag rows on
        // this release instead of just being returned inline. Omit for an
        // ad-hoc pre-release check that doesn't need a persistent flag.
        releaseId: z.string().optional(),
        prUrl: z.string().optional(),
      }),
    )
    .output(
      z.object({
        runId: z.string(),
        changedFiles: z.array(z.string()),
        mustRun: z.array(recommendationOutput),
        coverageGaps: z.array(z.string()),
        riskFlagsCreated: z.number(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId, "EDITOR");
      const project = await ctx.prisma.project.findUniqueOrThrow({ where: { id: input.projectId } });
      const repoUrl = input.repoUrl ?? project.repoUrl;
      if (!repoUrl) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No repo URL provided and the project has none configured" });
      }

      let release: { id: string; projectId: string } | null = null;
      if (input.releaseId) {
        release = await ctx.prisma.release.findUniqueOrThrow({ where: { id: input.releaseId } });
        if (release.projectId !== input.projectId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "That release does not belong to this project" });
        }
      }

      const changedFiles = await getChangedFiles(repoUrl, input.baseRef, input.headRef);
      const { mustRun, coverageGaps } = await matchChangedFilesToTestCases(ctx.prisma, input.projectId, changedFiles);

      let riskFlagsCreated = 0;
      if (release) {
        // Don't flag a gap that's already flagged and unresolved for this
        // release -- repeated runs against the same release (e.g. after
        // pushing more commits to the same PR) shouldn't pile up duplicate
        // flags for a file that was already caught.
        const existingOpenGapFiles = new Set(
          (
            await ctx.prisma.riskFlag.findMany({
              where: { releaseId: release.id, source: "PR_SCAN_COVERAGE_GAP", resolvedAt: null },
              select: { relatedFilePath: true },
            })
          ).map((f) => f.relatedFilePath),
        );
        const newGaps = coverageGaps.filter((f) => !existingOpenGapFiles.has(f));
        if (newGaps.length > 0) {
          // P6-06: a gap in a payments/auth path isn't the same risk as one
          // in a docs folder -- severityForPath falls back to the pre-P6-06
          // flat HIGH when the project has no configured rules.
          const pathSeverityRules = await getPathSeverityRules(ctx.prisma, input.projectId);
          await ctx.prisma.riskFlag.createMany({
            data: newGaps.map((f) => ({
              releaseId: release!.id,
              severity: severityForPath(f, pathSeverityRules),
              source: "PR_SCAN_COVERAGE_GAP",
              description: `${f} changed between ${input.baseRef} and ${input.headRef} but no tracked test case covers it.`,
              relatedFilePath: f,
              relatedPrUrl: input.prUrl,
              createdById: ctx.user.id,
              updatedById: ctx.user.id,
            })),
          });
          riskFlagsCreated = newGaps.length;
        }
      }

      const run = await ctx.prisma.testSelectionRun.create({
        data: {
          projectId: input.projectId,
          baseRef: input.baseRef,
          headRef: input.headRef,
          changedFiles,
          recommendations: {
            create: mustRun.map((m) => ({
              testCaseId: m.testCaseId,
              recommended: true,
              matchReason: m.matchReason,
              riskScoreSnapshot: m.riskScore,
            })),
          },
        },
      });

      return { runId: run.id, changedFiles, mustRun, coverageGaps, riskFlagsCreated };
    }),

  // P6-04: goes beyond recommendForChange's file-path matching -- reads the
  // actual diff content and asks the agent which of the project's EXISTING
  // test plans the change is relevant to, and whether it looks like it
  // introduces a gap (a new branch/edge case) beyond what any existing
  // plan/case already covers. Kept as its own mutation rather than folded
  // into recommendForChange: that one is free and deterministic (pure file-
  // path matching), this one is a real LLM call, and bundling them would
  // make the cheap, always-useful check pay the cost of the expensive,
  // judgment-based one on every call.
  recommendTestPlansForDiff: protectedProcedure
    .input(z.object({ projectId: z.string(), repoUrl: z.string().optional(), baseRef: z.string().default("main"), headRef: z.string() }))
    .output(
      z.object({
        relevantTestPlans: z.array(z.object({ id: z.string(), name: z.string() })),
        rationale: z.string(),
        suggestedNewTestCases: z.array(z.string()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId, "EDITOR");
      const project = await ctx.prisma.project.findUniqueOrThrow({ where: { id: input.projectId } });
      const repoUrl = input.repoUrl ?? project.repoUrl;
      if (!repoUrl) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No repo URL provided and the project has none configured" });
      }

      const [diffContent, testPlans] = await Promise.all([
        getDiffContent(repoUrl, input.baseRef, input.headRef),
        ctx.prisma.testPlan.findMany({ where: { projectId: input.projectId }, select: { id: true, name: true, description: true } }),
      ]);

      if (diffContent.trim().length === 0) {
        return { relevantTestPlans: [], rationale: "No changes found between these two refs.", suggestedNewTestCases: [] };
      }

      try {
        await chargeAiCredits(ctx.prisma, project.organizationId, "recommendTestPlansForDiff");
      } catch (e) {
        if (e instanceof InsufficientAiCreditsError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
        }
        throw e;
      }

      const recommendation = await recommendTestPlansForDiff({ diffContent, testPlans });
      const relevantTestPlans = testPlans.filter((p) => recommendation.relevantTestPlanIds.includes(p.id));

      return {
        relevantTestPlans: relevantTestPlans.map((p) => ({ id: p.id, name: p.name })),
        rationale: recommendation.rationale,
        suggestedNewTestCases: recommendation.suggestedNewTestCases,
      };
    }),

  // P6-06: reads the project's PR scan configuration, or the documented
  // defaults if the project has never configured one -- there's no
  // required setup step before scanning works, just an optional
  // customization.
  getPrScanPolicy: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .output(
      z.object({
        triggerBranches: z.array(z.string()),
        commentMode: z.string(),
        pathSeverityRules: z.array(z.object({ pattern: z.string(), severity: z.string() })),
      }),
    )
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      const policy = await ctx.prisma.prScanPolicy.findUnique({ where: { projectId: input.projectId } });
      if (!policy) return { triggerBranches: ["main"], commentMode: "COMMENT", pathSeverityRules: [] };
      return {
        triggerBranches: policy.triggerBranches,
        commentMode: policy.commentMode,
        pathSeverityRules: parsePathSeverityRules(policy.pathSeverityRules),
      };
    }),

  savePrScanPolicy: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        triggerBranches: z.array(z.string()).min(1),
        commentMode: z.enum(["COMMENT", "SILENT_FLAG_ONLY"]),
        pathSeverityRules: z.array(z.object({ pattern: z.string().min(1), severity: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]) })),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId, "ADMIN");
      await ctx.prisma.prScanPolicy.upsert({
        where: { projectId: input.projectId },
        create: {
          projectId: input.projectId,
          triggerBranches: input.triggerBranches,
          commentMode: input.commentMode,
          pathSeverityRules: input.pathSeverityRules,
        },
        update: {
          triggerBranches: input.triggerBranches,
          commentMode: input.commentMode,
          pathSeverityRules: input.pathSeverityRules,
        },
      });
    }),

  listRuns: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .output(
      z.array(
        z.object({
          id: z.string(),
          baseRef: z.string(),
          headRef: z.string(),
          changedFiles: z.array(z.string()),
          recommendedCount: z.number(),
          createdAt: z.date(),
        }),
      ),
    )
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      const runs = await ctx.prisma.testSelectionRun.findMany({
        where: { projectId: input.projectId },
        include: { _count: { select: { recommendations: true } } },
        orderBy: { createdAt: "desc" },
        take: 50,
      });
      return runs.map((r) => ({
        id: r.id,
        baseRef: r.baseRef,
        headRef: r.headRef,
        changedFiles: r.changedFiles,
        recommendedCount: r._count.recommendations,
        createdAt: r.createdAt,
      }));
    }),

  runById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .output(
      z.object({
        id: z.string(),
        baseRef: z.string(),
        headRef: z.string(),
        changedFiles: z.array(z.string()),
        createdAt: z.date(),
        recommendations: z.array(
          z.object({
            testCaseId: z.string(),
            testCaseTitle: z.string(),
            matchReason: z.string(),
            riskScoreSnapshot: z.number().nullable(),
          }),
        ),
      }),
    )
    .query(async ({ ctx, input }) => {
      const run = await ctx.prisma.testSelectionRun.findUniqueOrThrow({
        where: { id: input.id },
        include: { recommendations: { include: { testCase: { select: { title: true } } }, orderBy: { riskScoreSnapshot: "desc" } } },
      });
      await requireProjectAccess(ctx, run.projectId);
      return {
        id: run.id,
        baseRef: run.baseRef,
        headRef: run.headRef,
        changedFiles: run.changedFiles,
        createdAt: run.createdAt,
        recommendations: run.recommendations.map((r) => ({
          testCaseId: r.testCaseId,
          testCaseTitle: r.testCase.title,
          matchReason: r.matchReason,
          riskScoreSnapshot: r.riskScoreSnapshot,
        })),
      };
    }),
});
