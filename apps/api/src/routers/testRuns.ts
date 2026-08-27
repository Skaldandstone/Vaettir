import { z } from "zod";
import { router, protectedProcedure, requireProjectAccess } from "../trpc.js";
import { parseJUnitXml } from "../services/junitParse.js";

// P5-01: the actual data pipeline several other roadmap items (P4-03, P4-06,
// P3-05, P3-07, P7-02) are blocked on -- they all need real TestResult rows
// to exist. JUnit XML is the de facto universal format most frameworks/CI
// systems can emit or convert to, so this is the highest-leverage first
// ingestion path rather than building a framework-specific one first.
export const testRunsRouter = router({
  // Authenticated the same way as every other mutation -- a CI service
  // token (an ApiKey-backed User, see apps/api/src/trpc.ts) works here with
  // no separate auth path, since it's a real Membership like a human's.
  ingestJUnit: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        ciProvider: z.string().min(1),
        ciRunUrl: z.string().optional(),
        commitSha: z.string().min(1),
        branch: z.string().min(1),
        junitXml: z.string().min(1),
      }),
    )
    .output(
      z.object({
        testRunId: z.string(),
        totalResults: z.number(),
        passCount: z.number(),
        failCount: z.number(),
        skipCount: z.number(),
        matchedCount: z.number(),
        unmatchedCount: z.number(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId, "EDITOR");
      const parsed = parseJUnitXml(input.junitXml);

      // Exact-match on TestCaseSource.externalTestId only, for now -- a
      // deterministic lookup against data the schema already models for
      // exactly this purpose. Fuzzy classname/file-path matching for a test
      // that's never reported an externalTestId before, and surfacing
      // unmatched results for manual linking, is P5-04's job, not this
      // ticket's -- this endpoint's job is getting real results into the
      // system at all.
      const sources = await ctx.prisma.testCaseSource.findMany({
        where: { externalTestId: { in: parsed.map((p) => p.externalTestId) } },
        select: { externalTestId: true, testCaseId: true },
      });
      const testCaseIdByExternalId = new Map(sources.map((s) => [s.externalTestId as string, s.testCaseId]));

      const status = parsed.some((p) => p.status === "FAIL")
        ? "FAILED"
        : parsed.every((p) => p.status === "SKIP")
          ? "PARTIAL"
          : parsed.some((p) => p.status === "SKIP")
            ? "PARTIAL"
            : "PASSED";

      const testRun = await ctx.prisma.testRun.create({
        data: {
          projectId: input.projectId,
          ciProvider: input.ciProvider,
          ciRunUrl: input.ciRunUrl,
          commitSha: input.commitSha,
          branch: input.branch,
          startedAt: new Date(),
          finishedAt: new Date(),
          status,
          results: {
            create: parsed.map((p) => ({
              testCaseId: testCaseIdByExternalId.get(p.externalTestId) ?? null,
              externalTestId: p.externalTestId,
              status: p.status,
              durationMs: p.durationMs,
              errorMessage: p.errorMessage,
            })),
          },
        },
        select: { id: true },
      });

      const matchedCount = parsed.filter((p) => testCaseIdByExternalId.has(p.externalTestId)).length;

      return {
        testRunId: testRun.id,
        totalResults: parsed.length,
        passCount: parsed.filter((p) => p.status === "PASS").length,
        failCount: parsed.filter((p) => p.status === "FAIL").length,
        skipCount: parsed.filter((p) => p.status === "SKIP").length,
        matchedCount,
        unmatchedCount: parsed.length - matchedCount,
      };
    }),

  list: protectedProcedure
    .input(z.object({ projectId: z.string(), take: z.number().min(1).max(100).default(20) }))
    .output(
      z.array(
        z.object({
          id: z.string(),
          ciProvider: z.string(),
          ciRunUrl: z.string().nullable(),
          commitSha: z.string(),
          branch: z.string(),
          status: z.string(),
          startedAt: z.date(),
          resultCount: z.number(),
        }),
      ),
    )
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      const runs = await ctx.prisma.testRun.findMany({
        where: { projectId: input.projectId },
        include: { _count: { select: { results: true } } },
        orderBy: { startedAt: "desc" },
        take: input.take,
      });
      return runs.map((r) => ({
        id: r.id,
        ciProvider: r.ciProvider,
        ciRunUrl: r.ciRunUrl,
        commitSha: r.commitSha,
        branch: r.branch,
        status: r.status,
        startedAt: r.startedAt,
        resultCount: r._count.results,
      }));
    }),

  byId: protectedProcedure
    .input(z.object({ id: z.string() }))
    .output(
      z.object({
        id: z.string(),
        ciProvider: z.string(),
        ciRunUrl: z.string().nullable(),
        commitSha: z.string(),
        branch: z.string(),
        status: z.string(),
        startedAt: z.date(),
        results: z.array(
          z.object({
            id: z.string(),
            externalTestId: z.string().nullable(),
            testCaseTitle: z.string().nullable(),
            status: z.string(),
            durationMs: z.number().nullable(),
            errorMessage: z.string().nullable(),
          }),
        ),
      }),
    )
    .query(async ({ ctx, input }) => {
      const run = await ctx.prisma.testRun.findUniqueOrThrow({
        where: { id: input.id },
        include: { results: { include: { testCase: { select: { title: true } } } } },
      });
      await requireProjectAccess(ctx, run.projectId);
      return {
        id: run.id,
        ciProvider: run.ciProvider,
        ciRunUrl: run.ciRunUrl,
        commitSha: run.commitSha,
        branch: run.branch,
        status: run.status,
        startedAt: run.startedAt,
        results: run.results.map((r) => ({
          id: r.id,
          externalTestId: r.externalTestId,
          testCaseTitle: r.testCase?.title ?? null,
          status: r.status,
          durationMs: r.durationMs,
          errorMessage: r.errorMessage,
        })),
      };
    }),
});
