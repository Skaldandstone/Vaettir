import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, requireProjectAccess } from "../trpc.js";
import { recomputeFlaky } from "../services/flakyDetection.js";
import { resolveHealingSuggestionsOnPass } from "../services/healingSuggestion.js";
import { resolveStepFieldLabels } from "@vaettir/core";
import {
  manualRunStatus,
  measurementVerdict,
  observationsSchema,
  verificationProfileSchema,
  validationDomainSchema,
} from "../services/physicalValidation.js";

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
        testCaseIds: z.array(z.string()).min(1).max(500),
      }),
    )
    .output(z.object({ testRunId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId, "EDITOR");
      if (new Set(input.testCaseIds).size !== input.testCaseIds.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Choose each test case only once." });
      }
      return ctx.prisma.$transaction(async (tx) => {
        // Serialize with prerequisite edits, then freeze the graph for this
        // run. Historical runs never change when a case's graph is edited.
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${input.projectId}))::text`;
        const links = await tx.testCasePrerequisite.findMany({
          where: { projectId: input.projectId },
          select: { dependentId: true, prerequisiteId: true },
          take: 10001,
        });
        if (links.length > 10000) throw new TRPCError({ code: "BAD_REQUEST", message: "Project has too many prerequisite links to start safely." });
        const graph = new Map<string, string[]>();
        for (const link of links) graph.set(link.dependentId, [...(graph.get(link.dependentId) ?? []), link.prerequisiteId]);
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
              if (visiting.has(next)) throw new TRPCError({ code: "CONFLICT", message: "Test case prerequisites contain a cycle." });
              if (!visited.has(next)) stack.push({ id: next, nextIndex: 0 });
              if (visited.size + stack.length > 500) throw new TRPCError({ code: "BAD_REQUEST", message: "Run would include more than 500 cases with prerequisites." });
              continue;
            }
            stack.pop();
            visiting.delete(frame.id);
            visited.add(frame.id);
            ordered.push(frame.id);
          }
        }
        const cases = await tx.testCase.findMany({
          where: { id: { in: ordered }, projectId: input.projectId, archived: false },
          select: { id: true },
        });
        if (cases.length !== ordered.length) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "A selected case or prerequisite is missing, archived, or outside this project." });
        }
        const snapshot = Object.fromEntries(ordered.map(id => [id, graph.get(id) ?? []]));
        const run = await tx.testRun.create({
          data: {
            projectId: input.projectId,
            ciProvider: "manual",
            commitSha: "manual",
            branch: "manual",
            startedAt: new Date(),
            status: "RUNNING",
            manualTestCaseIds: ordered,
            manualPrerequisites: snapshot,
            startedById: ctx.user.id,
          },
          select: { id: true },
        });
        return { testRunId: run.id };
      }, { timeout: 20000 });
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
              }),
            ),
            currentResult: z
              .object({
                status: z.string(),
                note: z.string().nullable(),
                observations: observationsSchema,
              })
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
          include: {
            steps: { orderBy: { order: "asc" } },
            sharedStepGroup: true,
          },
        }),
        ctx.prisma.testResult.findMany({
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
      const prerequisites = z.record(z.array(z.string())).parse(run.manualPrerequisites);

      const overrides =
        (run.project.organization.stepFieldLabels as Partial<
          Record<string, string>
        > | null) ?? {};

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
              prerequisiteIds: prerequisites[c.id] ?? [],
              validationDomain: c.validationDomain,
              verificationProfile: verificationProfileSchema.parse(
                c.verificationProfile,
              ),
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
              currentResult: result
                ? {
                    status: result.status,
                    note: result.note,
                    observations: observationsSchema.parse(result.observations),
                  }
                : null,
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

        const existing = await tx.testResult.findFirst({
          where: { testRunId: input.testRunId, testCaseId: input.testCaseId },
        });

        const prerequisites = z.record(z.array(z.string())).parse(run.manualPrerequisites);
        const requiredIds = prerequisites[input.testCaseId] ?? [];
        if (input.status !== "BLOCKED" && input.status !== "SKIP" && requiredIds.length) {
          const passed = await tx.testResult.findMany({
            where: { testRunId: run.id, testCaseId: { in: requiredIds }, status: "PASS" },
            select: { testCaseId: true },
          });
          if (passed.length !== requiredIds.length) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Complete all prerequisite cases with Pass before executing this case." });
          }
        }
        if (existing?.status === "PASS" && input.status !== "PASS") {
          const dependents = Object.entries(prerequisites)
            .filter(([, ids]) => ids.includes(input.testCaseId))
            .map(([id]) => id);
          const executedDependents = await tx.testResult.count({
            where: { testRunId: run.id, testCaseId: { in: dependents }, status: { in: ["PASS", "FAIL"] } },
          });
          if (executedDependents) {
            throw new TRPCError({ code: "CONFLICT", message: "A dependent case has already run. Correct or reset it before changing this prerequisite result." });
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

        const status = manualRunStatus(
          run.manualTestCaseIds.length,
          results.map((r) => r.status),
        );

        await tx.testRun.update({
          where: { id: input.testRunId },
          data: { status, finishedAt: new Date() },
        });
        return { status };
      });
    }),
});
