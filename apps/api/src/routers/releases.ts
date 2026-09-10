import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, requireProjectAccess, requireOrgRole } from "../trpc.js";
import { computeStatusesByTestPlan } from "../services/acceptanceCriteria.js";
import { evaluateReleaseGate } from "../services/releaseGate.js";
import { computeReadiness, getOrgOverview } from "../services/orgReadiness.js";
import { computeReleaseReadiness } from "../services/releaseReadiness.js";
import { chargeAiCredits, InsufficientAiCreditsError, meterAiCall } from "../services/aiCredits.js";
import { getCommitLog } from "../services/changeImpact.js";
import { generateReleaseSummary } from "@vaettir/ai-agent";

const readinessOutput = z.object({
  score: z.number(),
  label: z.enum(["READY", "AT_RISK", "BLOCKED"]),
  criteria: z.object({ met: z.number(), atRisk: z.number(), notMet: z.number(), pending: z.number(), total: z.number() }),
  riskFlags: z.object({
    critical: z.number(),
    high: z.number(),
    medium: z.number(),
    low: z.number(),
    openTotal: z.number(),
  }),
});

const riskFlagOutput = z.object({
  id: z.string(),
  severity: z.string(),
  source: z.string(),
  description: z.string(),
  relatedFilePath: z.string().nullable(),
  relatedPrUrl: z.string().nullable(),
  createdAt: z.date(),
  resolvedAt: z.date().nullable(),
});

export const releasesRouter = router({
  list: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .output(
      z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          status: z.string(),
          targetDate: z.date().nullable(),
          readiness: readinessOutput,
        }),
      ),
    )
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      const releases = await ctx.prisma.release.findMany({
        where: { projectId: input.projectId },
        orderBy: { createdAt: "desc" },
        include: {
          testPlans: { include: { acceptanceCriteria: { select: { testPlanId: true, status: true } } } },
          riskFlags: { where: { resolvedAt: null }, select: { severity: true } },
        },
      });
      const allCriteria = releases.flatMap((r) => r.testPlans.flatMap((p) => p.acceptanceCriteria));
      const computedByPlan = await computeStatusesByTestPlan(
        ctx.prisma,
        allCriteria.map((c) => c.testPlanId),
      );
      return releases.map((r) => ({
        id: r.id,
        name: r.name,
        status: r.status,
        targetDate: r.targetDate,
        readiness: computeReadiness(
          r.testPlans.flatMap((p) =>
            p.acceptanceCriteria.map((c) => ({ status: computedByPlan.get(c.testPlanId) ?? c.status })),
          ),
          r.riskFlags,
        ),
      }));
    }),

  byId: protectedProcedure
    .input(z.object({ id: z.string() }))
    .output(
      z.object({
        id: z.string(),
        projectId: z.string(),
        name: z.string(),
        status: z.string(),
        targetDate: z.date().nullable(),
        createdAt: z.date(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const release = await ctx.prisma.release.findUniqueOrThrow({ where: { id: input.id } });
      await requireProjectAccess(ctx, release.projectId);
      return release;
    }),

  create: protectedProcedure
    .input(z.object({ projectId: z.string(), name: z.string().min(1), targetDate: z.date().optional() }))
    .output(z.object({ id: z.string(), name: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId, "EDITOR");
      return ctx.prisma.release.create({
        data: {
          projectId: input.projectId,
          name: input.name,
          targetDate: input.targetDate,
          createdById: ctx.user.id,
          updatedById: ctx.user.id,
        },
        select: { id: true, name: true },
      });
    }),

  // P7-08: only entering READY is gated -- BLOCKED/SHIPPED/back to
  // PLANNING or IN_TESTING are never held up by this check, since the
  // gate's whole point is "don't call this release ready when it isn't."
  updateStatus: protectedProcedure
    .input(z.object({ id: z.string(), status: z.enum(["PLANNING", "IN_TESTING", "READY", "SHIPPED", "BLOCKED"]) }))
    .mutation(async ({ ctx, input }) => {
      const release = await ctx.prisma.release.findUniqueOrThrow({ where: { id: input.id } });
      await requireProjectAccess(ctx, release.projectId, "EDITOR");

      if (input.status === "READY") {
        const gate = await evaluateReleaseGate(ctx.prisma, input.id);
        if (!gate.passes && gate.policy === "HARD_BLOCK") {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `This organization requires release gates to pass before READY: ${gate.reasons.join("; ")}`,
          });
        }
      }

      return ctx.prisma.release.update({ where: { id: input.id }, data: { status: input.status, updatedById: ctx.user.id } });
    }),

  checkGate: protectedProcedure
    .input(z.object({ releaseId: z.string() }))
    .output(z.object({ policy: z.string(), passes: z.boolean(), reasons: z.array(z.string()) }))
    .query(async ({ ctx, input }) => {
      const release = await ctx.prisma.release.findUniqueOrThrow({ where: { id: input.releaseId } });
      await requireProjectAccess(ctx, release.projectId);
      return evaluateReleaseGate(ctx.prisma, input.releaseId);
    }),

  readiness: protectedProcedure
    .input(z.object({ releaseId: z.string() }))
    .output(readinessOutput)
    .query(async ({ ctx, input }) => {
      const release = await ctx.prisma.release.findUniqueOrThrow({ where: { id: input.releaseId } });
      await requireProjectAccess(ctx, release.projectId);
      // P8-04: one shared implementation with the snapshot/notify service,
      // so what the page shows and what a "readiness changed" notification
      // says can never disagree.
      return computeReleaseReadiness(ctx.prisma, input.releaseId);
    }),

  // P8-04: the persisted readiness history behind change notifications -
  // one row per score/label move, newest first, baseline included.
  readinessHistory: protectedProcedure
    .input(z.object({ releaseId: z.string(), limit: z.number().int().min(1).max(200).default(50) }))
    .output(
      z.array(
        z.object({
          id: z.string(),
          score: z.number(),
          label: z.string(),
          previousLabel: z.string().nullable(),
          criteriaMet: z.number(),
          criteriaTotal: z.number(),
          openRiskFlags: z.number(),
          computedAt: z.date(),
        }),
      ),
    )
    .query(async ({ ctx, input }) => {
      const release = await ctx.prisma.release.findUniqueOrThrow({ where: { id: input.releaseId } });
      await requireProjectAccess(ctx, release.projectId);
      return ctx.prisma.releaseReadinessSnapshot.findMany({
        where: { releaseId: input.releaseId },
        orderBy: { computedAt: "desc" },
        take: input.limit,
      });
    }),

  listTestPlans: protectedProcedure
    .input(z.object({ releaseId: z.string() }))
    .output(
      z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          status: z.string(),
          testPlanType: z.object({ id: z.string(), name: z.string() }),
          acceptanceCriteria: z.array(
            z.object({ id: z.string(), description: z.string(), status: z.string(), autoComputed: z.boolean() }),
          ),
        }),
      ),
    )
    .query(async ({ ctx, input }) => {
      const release = await ctx.prisma.release.findUniqueOrThrow({ where: { id: input.releaseId } });
      await requireProjectAccess(ctx, release.projectId);
      const plans = await ctx.prisma.testPlan.findMany({
        where: { releaseId: input.releaseId },
        include: { testPlanType: true, acceptanceCriteria: { orderBy: { createdAt: "asc" } } },
        orderBy: { updatedAt: "desc" },
      });
      const computedByPlan = await computeStatusesByTestPlan(
        ctx.prisma,
        plans.map((p) => p.id),
      );
      return plans.map((p) => {
        const computed = computedByPlan.get(p.id) ?? null;
        return {
          ...p,
          acceptanceCriteria: p.acceptanceCriteria.map((c) => ({
            id: c.id,
            description: c.description,
            status: computed ?? c.status,
            autoComputed: computed !== null,
          })),
        };
      });
    }),

  listRiskFlags: protectedProcedure
    .input(z.object({ releaseId: z.string() }))
    .output(z.array(riskFlagOutput))
    .query(async ({ ctx, input }) => {
      const release = await ctx.prisma.release.findUniqueOrThrow({ where: { id: input.releaseId } });
      await requireProjectAccess(ctx, release.projectId);
      return ctx.prisma.riskFlag.findMany({
        where: { releaseId: input.releaseId },
        orderBy: [{ resolvedAt: "asc" }, { createdAt: "desc" }],
      });
    }),

  resolveRiskFlag: protectedProcedure
    .input(z.object({ id: z.string(), resolved: z.boolean() }))
    .output(riskFlagOutput)
    .mutation(async ({ ctx, input }) => {
      const flag = await ctx.prisma.riskFlag.findUniqueOrThrow({
        where: { id: input.id },
        include: { release: { select: { projectId: true } } },
      });
      await requireProjectAccess(ctx, flag.release.projectId, "EDITOR");
      return ctx.prisma.riskFlag.update({
        where: { id: input.id },
        data: { resolvedAt: input.resolved ? new Date() : null, updatedById: ctx.user.id },
      });
    }),

  // P7-06: one row per project, showing its most recently active (not yet
  // SHIPPED) release's readiness -- "useful once you have more than one
  // team" means an org lead scanning this shouldn't have to click into
  // every project individually to see which ones are in trouble. A project
  // with no non-shipped release (nothing currently in flight) reports
  // release: null rather than being omitted, so it's still visible as "all
  // quiet" rather than silently missing from the list.
  orgOverview: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .output(
      z.object({
        projects: z.array(
          z.object({
            projectId: z.string(),
            projectName: z.string(),
            release: z
              .object({ id: z.string(), name: z.string(), status: z.string(), readiness: readinessOutput })
              .nullable(),
          }),
        ),
        summary: z.object({ ready: z.number(), atRisk: z.number(), blocked: z.number(), noActiveRelease: z.number() }),
      }),
    )
    .query(({ ctx, input }) => {
      requireOrgRole(ctx, input.organizationId);
      return getOrgOverview(ctx.prisma, input.organizationId);
    }),

  // P7-07: releases have no direct FK to the TestRuns that ran during
  // them, so a "release window" is defined here as (previous release's
  // createdAt, this release's createdAt] on the same project -- every
  // TestRun that started in that span counts toward that release's trend
  // point. Computed over the project's FULL release history (not just the
  // last N) so the oldest returned release's window still has a correct
  // lower bound from the release before it, then trimmed to the last N for
  // the response.
  trend: protectedProcedure
    .input(z.object({ projectId: z.string(), limit: z.number().int().min(1).max(50).default(10) }))
    .output(
      z.array(
        z.object({
          releaseId: z.string(),
          name: z.string(),
          createdAt: z.date(),
          runCount: z.number(),
          passRate: z.number().nullable(),
          flakyCount: z.number(),
          coveragePct: z.number().nullable(),
          meanTimeToGreenMs: z.number().nullable(),
        }),
      ),
    )
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);

      const allReleases = await ctx.prisma.release.findMany({
        where: { projectId: input.projectId },
        orderBy: { createdAt: "asc" },
        select: { id: true, name: true, createdAt: true },
      });
      if (allReleases.length === 0) return [];

      const runs = await ctx.prisma.testRun.findMany({
        where: { projectId: input.projectId },
        orderBy: { startedAt: "asc" },
        select: {
          startedAt: true,
          status: true,
          results: { select: { status: true } },
          coverageReport: { select: { linesCovered: true, linesTotal: true } },
        },
      });

      const trend = allReleases.map((release, i) => {
        const windowStart = i === 0 ? new Date(0) : allReleases[i - 1]!.createdAt;
        const windowRuns = runs.filter((r) => r.startedAt > windowStart && r.startedAt <= release.createdAt);

        const allResults = windowRuns.flatMap((r) => r.results);
        const passRate = allResults.length > 0 ? allResults.filter((r) => r.status === "PASS").length / allResults.length : null;
        const flakyCount = allResults.filter((r) => r.status === "FLAKY").length;

        const coverageRuns = windowRuns.filter((r) => r.coverageReport && r.coverageReport.linesTotal > 0);
        const coveragePct =
          coverageRuns.length > 0
            ? (coverageRuns.reduce((sum, r) => sum + r.coverageReport!.linesCovered / r.coverageReport!.linesTotal, 0) /
                coverageRuns.length) *
              100
            : null;

        // Mean time-to-green: for each FAILED->...->PASSED streak in this
        // window, the gap between when the failing streak started and when
        // it resolved. A window with no failures (or no resolved failure)
        // contributes nothing, not a zero -- there's nothing to measure.
        let failStreakStart: Date | null = null;
        const greenGapsMs: number[] = [];
        for (const run of windowRuns) {
          if (run.status === "FAILED") {
            failStreakStart ??= run.startedAt;
          } else if (run.status === "PASSED" && failStreakStart) {
            greenGapsMs.push(run.startedAt.getTime() - failStreakStart.getTime());
            failStreakStart = null;
          }
        }
        const meanTimeToGreenMs = greenGapsMs.length > 0 ? greenGapsMs.reduce((a, b) => a + b, 0) / greenGapsMs.length : null;

        return {
          releaseId: release.id,
          name: release.name,
          createdAt: release.createdAt,
          runCount: windowRuns.length,
          passRate,
          flakyCount,
          coveragePct,
          meanTimeToGreenMs,
        };
      });

      return trend.slice(-input.limit);
    }),

  // 2026-08-28 (direct user request): one call returning everything the
  // release readiness page shows - readiness score, criteria, risk
  // flags, and the project's trend series - so a snapshot export (HTML/
  // Markdown, for pasting into Confluence/Notion/any wiki) renders from
  // the exact same data the live dashboard does rather than a second,
  // potentially-drifting code path. Reuses the same computation each of
  // readiness/listTestPlans/listRiskFlags/trend already does; not a new
  // formula.
  getSnapshot: protectedProcedure
    .input(z.object({ releaseId: z.string() }))
    .output(
      z.object({
        release: z.object({ id: z.string(), name: z.string(), status: z.string(), targetDate: z.date().nullable(), projectId: z.string() }),
        projectName: z.string(),
        readiness: readinessOutput,
        testPlans: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            status: z.string(),
            testPlanType: z.object({ id: z.string(), name: z.string() }),
            acceptanceCriteria: z.array(
              z.object({ id: z.string(), description: z.string(), status: z.string(), autoComputed: z.boolean() }),
            ),
          }),
        ),
        riskFlags: z.array(riskFlagOutput),
        trend: z.array(
          z.object({
            releaseId: z.string(),
            name: z.string(),
            createdAt: z.date(),
            runCount: z.number(),
            passRate: z.number().nullable(),
            flakyCount: z.number(),
            coveragePct: z.number().nullable(),
            meanTimeToGreenMs: z.number().nullable(),
          }),
        ),
        generatedAt: z.date(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const release = await ctx.prisma.release.findUniqueOrThrow({ where: { id: input.releaseId } });
      await requireProjectAccess(ctx, release.projectId);
      const project = await ctx.prisma.project.findUniqueOrThrow({ where: { id: release.projectId }, select: { name: true } });

      const [criteria, openFlags, plans, riskFlags, allReleases, runs] = await Promise.all([
        ctx.prisma.acceptanceCriterion.findMany({
          where: { testPlan: { releaseId: input.releaseId } },
          select: { testPlanId: true, status: true },
        }),
        ctx.prisma.riskFlag.findMany({ where: { releaseId: input.releaseId, resolvedAt: null }, select: { severity: true } }),
        ctx.prisma.testPlan.findMany({
          where: { releaseId: input.releaseId },
          include: { testPlanType: true, acceptanceCriteria: { orderBy: { createdAt: "asc" } } },
          orderBy: { updatedAt: "desc" },
        }),
        ctx.prisma.riskFlag.findMany({
          where: { releaseId: input.releaseId },
          orderBy: [{ resolvedAt: "asc" }, { createdAt: "desc" }],
        }),
        ctx.prisma.release.findMany({
          where: { projectId: release.projectId },
          orderBy: { createdAt: "asc" },
          select: { id: true, name: true, createdAt: true },
        }),
        ctx.prisma.testRun.findMany({
          where: { projectId: release.projectId },
          orderBy: { startedAt: "asc" },
          select: {
            startedAt: true,
            status: true,
            results: { select: { status: true } },
            coverageReport: { select: { linesCovered: true, linesTotal: true } },
          },
        }),
      ]);

      const computedByPlan = await computeStatusesByTestPlan(ctx.prisma, [
        ...criteria.map((c) => c.testPlanId),
        ...plans.map((p) => p.id),
      ]);

      const readiness = computeReadiness(
        criteria.map((c) => ({ status: computedByPlan.get(c.testPlanId) ?? c.status })),
        openFlags,
      );

      const testPlans = plans.map((p) => {
        const computed = computedByPlan.get(p.id) ?? null;
        return {
          id: p.id,
          name: p.name,
          status: p.status,
          testPlanType: { id: p.testPlanType.id, name: p.testPlanType.name },
          acceptanceCriteria: p.acceptanceCriteria.map((c) => ({
            id: c.id,
            description: c.description,
            status: computed ?? c.status,
            autoComputed: computed !== null,
          })),
        };
      });

      const trend = allReleases.map((r, i) => {
        const windowStart = i === 0 ? new Date(0) : allReleases[i - 1]!.createdAt;
        const windowRuns = runs.filter((run) => run.startedAt > windowStart && run.startedAt <= r.createdAt);
        const allResults = windowRuns.flatMap((run) => run.results);
        const passRate = allResults.length > 0 ? allResults.filter((res) => res.status === "PASS").length / allResults.length : null;
        const flakyCount = allResults.filter((res) => res.status === "FLAKY").length;
        const coverageRuns = windowRuns.filter((run) => run.coverageReport && run.coverageReport.linesTotal > 0);
        const coveragePct =
          coverageRuns.length > 0
            ? (coverageRuns.reduce((sum, run) => sum + run.coverageReport!.linesCovered / run.coverageReport!.linesTotal, 0) /
                coverageRuns.length) *
              100
            : null;
        let failStreakStart: Date | null = null;
        const greenGapsMs: number[] = [];
        for (const run of windowRuns) {
          if (run.status === "FAILED") {
            failStreakStart ??= run.startedAt;
          } else if (run.status === "PASSED" && failStreakStart) {
            greenGapsMs.push(run.startedAt.getTime() - failStreakStart.getTime());
            failStreakStart = null;
          }
        }
        const meanTimeToGreenMs = greenGapsMs.length > 0 ? greenGapsMs.reduce((a, b) => a + b, 0) / greenGapsMs.length : null;
        return { releaseId: r.id, name: r.name, createdAt: r.createdAt, runCount: windowRuns.length, passRate, flakyCount, coveragePct, meanTimeToGreenMs };
      });

      return {
        release: { id: release.id, name: release.name, status: release.status, targetDate: release.targetDate, projectId: release.projectId },
        projectName: project.name,
        readiness,
        testPlans,
        riskFlags,
        trend: trend.slice(-10),
        generatedAt: new Date(),
      };
    }),

  // 2026-08-28 (speculative-planning pick, built same night): a
  // stakeholder-readable narrative draft, not another number on the
  // dashboard - reuses the exact same readiness computation getSnapshot
  // does (so the summary can never disagree with the live page), plus
  // real commit-log grounding (getCommitLog, the same git-host-agnostic
  // "what's actually in this build" approach P4-09's QA strategy
  // generation already established) when the caller anchors it in a real
  // ref range instead of just the release name. Returns an unpersisted
  // draft for review/edit, matching every other AI-generation feature in
  // this codebase - nothing is saved or shared automatically.
  generateSummaryDraft: protectedProcedure
    .input(z.object({ releaseId: z.string(), baseRef: z.string().optional(), headRef: z.string().optional() }))
    .output(
      z.object({
        overview: z.string(),
        whatChanged: z.string(),
        coverage: z.string(),
        risks: z.string(),
        recommendation: z.string(),
        groundedInCommits: z.array(z.object({ sha: z.string(), subject: z.string() })).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const release = await ctx.prisma.release.findUniqueOrThrow({ where: { id: input.releaseId } });
      const { project } = await requireProjectAccess(ctx, release.projectId, "EDITOR");
      const projectFull = await ctx.prisma.project.findUniqueOrThrow({
        where: { id: release.projectId },
        select: { name: true, repoUrl: true, defaultBranch: true },
      });

      const [criteria, openFlags] = await Promise.all([
        ctx.prisma.acceptanceCriterion.findMany({
          where: { testPlan: { releaseId: input.releaseId } },
          select: { testPlanId: true, status: true },
        }),
        ctx.prisma.riskFlag.findMany({
          where: { releaseId: input.releaseId, resolvedAt: null },
          select: { severity: true, source: true, description: true },
        }),
      ]);
      const computedByPlan = await computeStatusesByTestPlan(ctx.prisma, criteria.map((c) => c.testPlanId));
      const readiness = computeReadiness(
        criteria.map((c) => ({ status: computedByPlan.get(c.testPlanId) ?? c.status })),
        openFlags,
      );

      let changesSummary: string | undefined;
      let groundedInCommits: { sha: string; subject: string }[] | undefined;
      if (input.headRef) {
        if (!projectFull.repoUrl) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "This project has no repo connected to ground the summary in" });
        }
        const commits = await getCommitLog(projectFull.repoUrl, input.baseRef ?? projectFull.defaultBranch, input.headRef);
        groundedInCommits = commits;
        changesSummary = commits.length > 0 ? commits.map((c) => `- ${c.sha} ${c.subject}`).join("\n") : undefined;
      }

      const charge = await chargeAiCredits(ctx.prisma, project.organizationId, "generateReleaseSummary").catch((e: unknown) => {
        if (e instanceof InsufficientAiCreditsError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
        }
        throw e;
      });

      const draft = await meterAiCall(ctx.prisma, charge, () =>
        generateReleaseSummary({
          releaseName: release.name,
          releaseStatus: release.status,
          projectName: projectFull.name,
          readinessScore: readiness.score,
          readinessLabel: readiness.label,
          criteria: readiness.criteria,
          openRiskFlags: openFlags,
          changesSummary,
        }),
      );

      return { ...draft, groundedInCommits };
    }),
});
