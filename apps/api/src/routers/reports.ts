import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, requireProjectAccess } from "../trpc.js";
import { caseViewFiltersSchema } from "./testCaseViews.js";

const bucketSchema = z.object({ key: z.string(), count: z.number().int().nonnegative() });
const caseFilters = caseViewFiltersSchema;
type CaseFilters = z.infer<typeof caseFilters>;
const MAX_REPORT_CASES = 20_000;

type ReportCaseRow = {
  id: string; title: string; tags: string[]; testType: string; automationStatus: string; priority: string;
  reviewStatus: string; origin: string; archived: boolean; riskAssessedAt: Date | null; riskScore: number | null;
  isFlaky: boolean; suitePath: string | null; sortPosition: number; updatedAt: Date;
  source: { filePath: string } | null;
};

function countBy(rows: ReportCaseRow[], field: "testType" | "priority" | "reviewStatus") {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row[field], (counts.get(row[field]) ?? 0) + 1);
  return [...counts].map(([key, count]) => ({ key, count })).sort((a, b) => a.key.localeCompare(b.key));
}

function matchingCases(rows: ReportCaseRow[], filters: CaseFilters) {
  const search = filters.search.trim().toLowerCase();
  const selected = rows.filter(row => {
    const location = row.suitePath || row.source?.filePath || null;
    if (!filters.showArchived && row.archived) return false;
    if (filters.suitePath === "__unassigned__" && location) return false;
    if (filters.suitePath !== null && filters.suitePath !== "__unassigned__" && location !== filters.suitePath && !location?.startsWith(`${filters.suitePath}/`)) return false;
    if (search && !row.title.toLowerCase().includes(search) && !row.tags.some(tag => tag.toLowerCase().includes(search))) return false;
    return (!filters.type || row.testType === filters.type) && (!filters.automation || row.automationStatus === filters.automation)
      && (!filters.priority || row.priority === filters.priority) && (!filters.review || row.reviewStatus === filters.review)
      && (!filters.origin || row.origin === filters.origin);
  });
  const priorityRank: Record<string, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
  const compare = (left: ReportCaseRow, right: ReportCaseRow) => {
    const direction = filters.sortDescending ? -1 : 1;
    if (filters.sortBy === "updated") return (left.updatedAt.getTime() - right.updatedAt.getTime()) * direction || left.id.localeCompare(right.id);
    if (filters.sortBy === "manual") {
      const a = left.suitePath || left.source?.filePath || "";
      const b = right.suitePath || right.source?.filePath || "";
      return a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }) || left.sortPosition - right.sortPosition || left.title.localeCompare(right.title) || left.id.localeCompare(right.id);
    }
    if (filters.sortBy === "risk") return ((left.riskScore ?? -1) - (right.riskScore ?? -1)) * direction || left.id.localeCompare(right.id);
    if (filters.sortBy === "priority") return ((priorityRank[left.priority] ?? 0) - (priorityRank[right.priority] ?? 0)) * direction || left.id.localeCompare(right.id);
    const field = (row: ReportCaseRow) => filters.sortBy === "title" ? row.title : filters.sortBy === "type" ? row.testType
      : filters.sortBy === "automation" ? row.automationStatus : filters.sortBy === "origin" ? row.origin
      : filters.sortBy === "review" ? row.reviewStatus : row.suitePath || row.source?.filePath || "";
    return field(left).localeCompare(field(right), undefined, { sensitivity: "base", numeric: true }) * direction || left.id.localeCompare(right.id);
  };
  selected.sort(compare);
  return selected;
}

// An inventory snapshot, not a release-readiness assertion. In particular,
// case inventory, recorded execution outcomes, and acceptance criteria have
// different denominators and must never be merged into a single "coverage" %.
export const reportsRouter = router({
  overview: protectedProcedure
    .input(z.object({ projectId: z.string(), windowDays: z.union([z.literal(7), z.literal(30), z.literal(90)]).nullable().default(30),
      caseViewId: z.string().min(1).optional(), caseFilters: caseFilters.optional() }).strict().refine(input => !(input.caseViewId && input.caseFilters), "Choose a saved case query or preview filters, not both"))
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
      caseQuery: z.object({ source: z.enum(["saved", "preview"]), name: z.string().nullable(), filters: caseFilters,
        total: z.number(), active: z.number(), archived: z.number(), withSource: z.number(), riskAssessed: z.number(), flaky: z.number(),
        byType: z.array(bucketSchema), byPriority: z.array(bucketSchema), byReview: z.array(bucketSchema),
        sample: z.array(z.object({ id: z.string(), title: z.string(), testType: z.string(), priority: z.string(), archived: z.boolean() })),
      }).nullable(),
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
        let scoped: { source: "saved" | "preview"; name: string | null; filters: CaseFilters } | null = null;
        if (input.caseViewId) {
          const view = await db.testCaseView.findFirst({ where: { id: input.caseViewId, projectId: input.projectId, userId: ctx.user.id }, select: { name: true, filters: true } });
          if (!view) throw new TRPCError({ code: "NOT_FOUND", message: "Saved case query not found in this project" });
          const parsed = caseFilters.safeParse(view.filters);
          if (!parsed.success) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This saved query needs to be reviewed before use" });
          scoped = { source: "saved", name: view.name, filters: parsed.data };
        } else if (input.caseFilters) {
          scoped = { source: "preview", name: null, filters: input.caseFilters };
        }
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
        let caseQuery = null;
        if (scoped) {
          // A bounded projection reproduces the case list's title/tag search
          // and effective suite fallback exactly. It contains no case body,
          // test steps, secret material or client-provided query expression.
          const rows = await db.testCase.findMany({ where: { projectId: input.projectId }, take: MAX_REPORT_CASES + 1,
            select: { id: true, title: true, tags: true, testType: true, automationStatus: true, priority: true, reviewStatus: true,
              origin: true, archived: true, riskAssessedAt: true, riskScore: true, isFlaky: true, suitePath: true,
              sortPosition: true, updatedAt: true, source: { select: { filePath: true } } } });
          if (rows.length > MAX_REPORT_CASES) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This project exceeds the current case-query report limit. No partial report was generated." });
          const matches = matchingCases(rows, scoped.filters);
          caseQuery = { ...scoped, total: matches.length, active: matches.filter(row => !row.archived).length,
            archived: matches.filter(row => row.archived).length, withSource: matches.filter(row => row.source !== null).length,
            riskAssessed: matches.filter(row => row.riskAssessedAt !== null).length, flaky: matches.filter(row => row.isFlaky).length,
            byType: countBy(matches, "testType"), byPriority: countBy(matches, "priority"), byReview: countBy(matches, "reviewStatus"),
            sample: matches.slice(0, 25).map(row => ({ id: row.id, title: row.title, testType: row.testType, priority: row.priority, archived: row.archived })) };
        }
        return {
          asOf, windowStart,
          caseQuery,
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
