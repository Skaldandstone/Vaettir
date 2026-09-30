import { z } from "zod";
import { router, protectedProcedure, requireProjectAccess } from "../trpc.js";

const bucketSchema = z.object({ key: z.string(), count: z.number().int().nonnegative() });

// An inventory snapshot, not a release-readiness assertion. In particular,
// case inventory, recorded execution outcomes, and acceptance criteria have
// different denominators and must never be merged into a single "coverage" %.
export const reportsRouter = router({
  overview: protectedProcedure
    .input(z.object({ projectId: z.string(), windowDays: z.union([z.literal(7), z.literal(30), z.literal(90)]).nullable().default(30) }))
    .output(z.object({
      asOf: z.date(),
      windowStart: z.date().nullable(),
      inventory: z.object({
        active: z.number(), archived: z.number(), withSource: z.number(), riskAssessed: z.number(), flaky: z.number(),
        byType: z.array(bucketSchema), byPriority: z.array(bucketSchema), byReview: z.array(bucketSchema),
      }),
      requirements: z.object({ total: z.number(), withCriteria: z.number(), linkedCriteria: z.number(), criteria: z.array(bucketSchema) }),
      execution: z.object({ runs: z.number(), byRunStatus: z.array(bucketSchema), results: z.number(), matchedResults: z.number(), byResultStatus: z.array(bucketSchema) }),
      recentRuns: z.array(z.object({ id: z.string(), ciProvider: z.string(), status: z.string(), startedAt: z.date(), branch: z.string(), commitSha: z.string(), resultCount: z.number() })),
    }))
    .query(async ({ ctx, input }) => {
      // Authorize before any aggregate, and repeat-read every metric from one
      // PostgreSQL snapshot so a changing run cannot produce contradictory
      // numerator/denominator values during report generation.
      await requireProjectAccess(ctx, input.projectId);
      const countBuckets = <T extends string>(rows: Array<{ _count: { _all: number } } & Record<T, string>>, key: T) =>
        rows.map(row => ({ key: row[key], count: row._count._all })).sort((a, b) => a.key.localeCompare(b.key));

      return ctx.prisma.$transaction(async db => {
        // The database clock read is the first query in the repeatable-read
        // transaction. It establishes the snapshot used by every aggregate.
        const timestampRows = await db.$queryRaw<{ asOf: Date }[]>`SELECT transaction_timestamp() AS "asOf"`;
        const asOf = timestampRows[0]?.asOf;
        if (!asOf) throw new Error("Could not establish report snapshot time");
        const windowStart = input.windowDays === null ? null : new Date(asOf.getTime() - input.windowDays * 86_400_000);
        const caseWhere = { projectId: input.projectId, archived: false } as const;
        const runWhere = { projectId: input.projectId, startedAt: { lte: asOf, ...(windowStart ? { gte: windowStart } : {}) } };
        const resultWhere = { testRun: runWhere };
        const [active, archived, withSource, riskAssessed, flaky, types, priorities, review,
          requirementTotal, withCriteria, linkedCriteria, criteria, runs, runStatuses, results, matchedResults, resultStatuses, recent] = await Promise.all([
          db.testCase.count({ where: caseWhere }),
          db.testCase.count({ where: { projectId: input.projectId, archived: true } }),
          db.testCase.count({ where: { ...caseWhere, source: { isNot: null } } }),
          db.testCase.count({ where: { ...caseWhere, riskAssessedAt: { not: null } } }),
          db.testCase.count({ where: { ...caseWhere, isFlaky: true } }),
          db.testCase.groupBy({ by: ["testType"], where: caseWhere, _count: { _all: true } }),
          db.testCase.groupBy({ by: ["priority"], where: caseWhere, _count: { _all: true } }),
          db.testCase.groupBy({ by: ["reviewStatus"], where: caseWhere, _count: { _all: true } }),
          db.requirement.count({ where: { projectId: input.projectId } }),
          db.requirement.count({ where: { projectId: input.projectId, acceptanceCriteria: { some: {} } } }),
          db.acceptanceCriterion.count({ where: { testPlan: { projectId: input.projectId }, requirementId: { not: null } } }),
          db.acceptanceCriterion.groupBy({ by: ["status"], where: { testPlan: { projectId: input.projectId } }, _count: { _all: true } }),
          db.testRun.count({ where: runWhere }),
          db.testRun.groupBy({ by: ["status"], where: runWhere, _count: { _all: true } }),
          db.testResult.count({ where: resultWhere }),
          db.testResult.count({ where: { ...resultWhere, testCaseId: { not: null } } }),
          db.testResult.groupBy({ by: ["status"], where: resultWhere, _count: { _all: true } }),
          db.testRun.findMany({ where: runWhere, orderBy: [{ startedAt: "desc" }, { id: "desc" }], take: 8,
            select: { id: true, ciProvider: true, status: true, startedAt: true, branch: true, commitSha: true, _count: { select: { results: true } } } }),
        ]);
        return {
          asOf, windowStart,
          inventory: { active, archived, withSource, riskAssessed, flaky,
            byType: countBuckets(types, "testType"), byPriority: countBuckets(priorities, "priority"), byReview: countBuckets(review, "reviewStatus") },
          requirements: { total: requirementTotal, withCriteria, linkedCriteria, criteria: countBuckets(criteria, "status") },
          execution: { runs, byRunStatus: countBuckets(runStatuses, "status"), results, matchedResults, byResultStatus: countBuckets(resultStatuses, "status") },
          recentRuns: recent.map(run => ({ id: run.id, ciProvider: run.ciProvider, status: run.status, startedAt: run.startedAt,
            branch: run.branch, commitSha: run.commitSha, resultCount: run._count.results })),
        };
      }, { isolationLevel: "RepeatableRead" });
    }),
});
