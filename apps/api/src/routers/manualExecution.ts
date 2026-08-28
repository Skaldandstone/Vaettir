import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, requireProjectAccess } from "../trpc.js";
import { recomputeFlaky } from "../services/flakyDetection.js";
import { resolveHealingSuggestionsOnPass } from "../services/healingSuggestion.js";
import { resolveStepFieldLabels } from "@vaettir/core";

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
  start: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        testCaseIds: z.array(z.string()).min(1),
      }),
    )
    .output(z.object({ testRunId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId, "EDITOR");

      const cases = await ctx.prisma.testCase.findMany({
        where: { id: { in: input.testCaseIds }, projectId: input.projectId },
        select: { id: true },
      });
      if (cases.length !== input.testCaseIds.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "One or more test cases don't belong to this project" });
      }

      const run = await ctx.prisma.testRun.create({
        data: {
          projectId: input.projectId,
          ciProvider: "manual",
          commitSha: "manual",
          branch: "manual",
          startedAt: new Date(),
          status: "RUNNING",
          manualTestCaseIds: input.testCaseIds,
          startedById: ctx.user.id,
        },
        select: { id: true },
      });
      return { testRunId: run.id };
    }),

  // The execution screen's single data source: the run's planned cases,
  // each with its full authoring content (both BDD and structured-step
  // formats, matching P1-10's "supports either" model) plus whatever
  // result has already been recorded for it in THIS run, if any.
  getForExecution: protectedProcedure
    .input(z.object({ testRunId: z.string() }))
    .output(
      z.object({
        testRunId: z.string(),
        projectId: z.string(),
        status: z.string(),
        stepFieldLabels: z.record(z.string()),
        cases: z.array(
          z.object({
            testCaseId: z.string(),
            title: z.string(),
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
              }),
            ),
            currentResult: z
              .object({ status: z.string(), note: z.string().nullable() })
              .nullable(),
          }),
        ),
      }),
    )
    .query(async ({ ctx, input }) => {
      const run = await ctx.prisma.testRun.findUniqueOrThrow({
        where: { id: input.testRunId },
        include: { project: { include: { organization: true } } },
      });
      await requireProjectAccess(ctx, run.projectId);

      const [cases, results] = await Promise.all([
        ctx.prisma.testCase.findMany({
          where: { id: { in: run.manualTestCaseIds } },
          include: { steps: { orderBy: { order: "asc" } }, sharedStepGroup: true },
        }),
        ctx.prisma.testResult.findMany({
          where: { testRunId: run.id, testCaseId: { in: run.manualTestCaseIds } },
        }),
      ]);
      const casesById = new Map(cases.map((c) => [c.id, c]));
      const resultByCase = new Map(results.map((r) => [r.testCaseId as string, r]));

      const overrides = (run.project.organization.stepFieldLabels as Partial<Record<string, string>> | null) ?? {};

      return {
        testRunId: run.id,
        projectId: run.projectId,
        status: run.status,
        stepFieldLabels: resolveStepFieldLabels(overrides as never),
        cases: run.manualTestCaseIds
          .map((id) => casesById.get(id))
          .filter((c): c is NonNullable<typeof c> => Boolean(c))
          .map((c) => {
            const result = resultByCase.get(c.id);
            return {
              testCaseId: c.id,
              title: c.title,
              given: c.given,
              when: c.when,
              then: c.then,
              // Same shared-step-group resolution as testCases.ts's byId -
              // a case deferring to a group has no steps of its own.
              steps: c.sharedStepGroup
                ? (c.sharedStepGroup.steps as Array<{
                    order: number;
                    action: string;
                    expectedActionOrData: string | null;
                    expectedResult: string | null;
                    expectedResponse: string | null;
                  }>)
                : c.steps.map((s) => ({
                    order: s.order,
                    action: s.action,
                    expectedActionOrData: s.expectedActionOrData,
                    expectedResult: s.expectedResult,
                    expectedResponse: s.expectedResponse,
                  })),
              currentResult: result ? { status: result.status, note: result.note } : null,
            };
          }),
      };
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
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const run = await ctx.prisma.testRun.findUniqueOrThrow({ where: { id: input.testRunId } });
      await requireProjectAccess(ctx, run.projectId, "EDITOR");

      if (!run.manualTestCaseIds.includes(input.testCaseId)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "That test case isn't part of this run's planned scope" });
      }

      const existing = await ctx.prisma.testResult.findFirst({
        where: { testRunId: input.testRunId, testCaseId: input.testCaseId },
      });

      const result = existing
        ? await ctx.prisma.testResult.update({
            where: { id: existing.id },
            data: { status: input.status, note: input.note ?? null },
          })
        : await ctx.prisma.testResult.create({
            data: {
              testRunId: input.testRunId,
              testCaseId: input.testCaseId,
              status: input.status,
              note: input.note ?? null,
            },
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
  complete: protectedProcedure.input(z.object({ testRunId: z.string() })).mutation(async ({ ctx, input }) => {
    const run = await ctx.prisma.testRun.findUniqueOrThrow({ where: { id: input.testRunId } });
    await requireProjectAccess(ctx, run.projectId, "EDITOR");

    const results = await ctx.prisma.testResult.findMany({
      where: { testRunId: input.testRunId },
      select: { status: true },
    });

    const status =
      results.some((r) => r.status === "FAIL" || r.status === "BLOCKED")
        ? "FAILED"
        : results.some((r) => r.status === "SKIP")
          ? "PARTIAL"
          : "PASSED";

    await ctx.prisma.testRun.update({
      where: { id: input.testRunId },
      data: { status, finishedAt: new Date() },
    });
    return { status };
  }),
});
