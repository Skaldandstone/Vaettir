import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, requireProjectAccess } from "../trpc.js";
import { parseJUnitXml } from "../services/junitParse.js";
import { recomputeFlaky } from "../services/flakyDetection.js";
import { autoEnqueueUnmatchedResult } from "../services/continuousListening.js";
import { refreshProjectReadiness } from "../services/releaseReadiness.js";
import { resolveHealingSuggestionsOnPass } from "../services/healingSuggestion.js";
import { buildArtifactKey, createUploadUrl, createViewUrl, canonicalUrl, keyFromCanonicalUrl } from "../services/artifactStorage.js";

// P5-01: the actual data pipeline several other roadmap items (P4-03, P4-06,
// P3-05, P3-07, P7-02) are blocked on -- they all need real TestResult rows
// to exist. JUnit XML is the de facto universal format most frameworks/CI
// systems can emit or convert to, so this is the highest-leverage first
// ingestion path rather than building a framework-specific one first.
export const testRunsRouter = router({
  // Authenticated the same way as every other mutation -- a CI service
  // token (an ApiKey-backed User, see apps/api/src/trpc.ts) works here with
  // no separate auth path, since it's a real Membership like a human's.
  // P11-08: startedAt/finishedAt are optional and default to "now" for the
  // live-CI case (the vast majority of calls, where "when this arrived" and
  // "when it ran" are close enough not to matter) -- but a historical
  // backfill importing past execution history needs to set the REAL
  // original timestamps, not the import date, or every trend chart,
  // flaky-detection window, and mean-time-to-green calculation downstream
  // would be silently wrong (every backfilled run timestamped "today").
  ingestJUnit: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        ciProvider: z.string().min(1),
        ciRunUrl: z.string().optional(),
        commitSha: z.string().min(1),
        branch: z.string().min(1),
        junitXml: z.string().min(1),
        // z.coerce.date() rather than z.date(): this API has no superjson
        // transformer, so a Date sent over the wire (from a browser client
        // JSON.stringify-ing it, or a curl-based CI script sending a plain
        // ISO string) arrives here as a string, not a Date instance - plain
        // z.date() rejected every real caller. Never exercised until the
        // P11-08 backfill UI became the first caller to actually pass these.
        startedAt: z.coerce.date().optional(),
        finishedAt: z.coerce.date().optional(),
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
          startedAt: input.startedAt ?? new Date(),
          finishedAt: input.finishedAt ?? new Date(),
          status,
          results: {
            create: parsed.map((p) => ({
              testCaseId: testCaseIdByExternalId.get(p.externalTestId) ?? null,
              externalTestId: p.externalTestId,
              externalFilePath: p.externalFilePath,
              status: p.status,
              durationMs: p.durationMs,
              errorMessage: p.errorMessage,
            })),
          },
        },
        select: { id: true },
      });

      const matchedCount = parsed.filter((p) => testCaseIdByExternalId.has(p.externalTestId)).length;

      // P5-05: recompute flakiness for every matched test case this run
      // touched -- fresh data just landed for it, so this is the moment a
      // newly-alternating (or newly-stabilized) pattern would show up.
      const touchedTestCaseIds = [...new Set(sources.map((s) => s.testCaseId))];
      await Promise.all(touchedTestCaseIds.map((id) => recomputeFlaky(ctx.prisma, id)));

      // P6.5-04: a matched test case that just came back PASS closes out
      // any of its still-open healing suggestions -- this is the "did the
      // suggestion actually help" signal, via a normal CI report rather
      // than a triggered re-run this platform has no way to trigger.
      const passedTestCaseIds = [
        ...new Set(
          parsed
            .filter((p) => p.status === "PASS" && testCaseIdByExternalId.has(p.externalTestId))
            .map((p) => testCaseIdByExternalId.get(p.externalTestId)!),
        ),
      ];
      await Promise.all(passedTestCaseIds.map((id) => resolveHealingSuggestionsOnPass(ctx.prisma, id)));
      // P8-04: auto-computed acceptance criteria follow test results, so a
      // run can flip a release's readiness - recompute every active release
      // of the project now rather than waiting for the 5-minute sweep.
      refreshProjectReadiness(ctx.prisma, input.projectId);

      // P5-14: for every unmatched result that reported a file path, try to
      // auto-enqueue a scoped reverse-engineer job rather than leaving it
      // to only ever be manually linked (P5-04). Fire-and-forget, not
      // awaited: autoEnqueueUnmatchedResult clones the repo per file, which
      // can take real time, and the CI job that called ingestJUnit is
      // blocked waiting on this HTTP response -- reporting results should
      // never get slower because of a background enrichment step. Failures
      // inside it never throw regardless, but .catch is here too as a
      // second line of defense against an unhandled rejection.
      const unmatchedWithFile = parsed.filter((p) => !testCaseIdByExternalId.has(p.externalTestId) && p.externalFilePath);
      if (unmatchedWithFile.length > 0) {
        void (async () => {
          const createdResults = await ctx.prisma.testResult.findMany({
            where: { testRunId: testRun.id, externalTestId: { in: unmatchedWithFile.map((p) => p.externalTestId) } },
            select: { id: true, externalTestId: true },
          });
          const resultIdByExternalId = new Map(createdResults.map((r) => [r.externalTestId as string, r.id]));
          await Promise.all(
            unmatchedWithFile.map((p) => {
              const testResultId = resultIdByExternalId.get(p.externalTestId);
              if (!testResultId || !p.externalFilePath) return undefined;
              return autoEnqueueUnmatchedResult(ctx.prisma, {
                projectId: input.projectId,
                testResultId,
                externalFilePath: p.externalFilePath,
                commitSha: input.commitSha,
              });
            }),
          );
        })().catch(() => undefined);
      }

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
          startedByEmail: z.string().nullable(),
        }),
      ),
    )
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      const runs = await ctx.prisma.testRun.findMany({
        where: { projectId: input.projectId },
        include: { _count: { select: { results: true } }, startedBy: { select: { email: true } } },
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
        startedByEmail: r.startedBy?.email ?? null,
      }));
    }),

  byId: protectedProcedure
    .input(z.object({ id: z.string() }))
    .output(
      z.object({
        id: z.string(),
        projectId: z.string(),
        ciProvider: z.string(),
        ciRunUrl: z.string().nullable(),
        commitSha: z.string(),
        branch: z.string(),
        status: z.string(),
        startedAt: z.date(),
        startedByEmail: z.string().nullable(),
        results: z.array(
          z.object({
            id: z.string(),
            externalTestId: z.string().nullable(),
            testCaseId: z.string().nullable(),
            testCaseTitle: z.string().nullable(),
            status: z.string(),
            durationMs: z.number().nullable(),
            errorMessage: z.string().nullable(),
            note: z.string().nullable(),
            artifacts: z.array(z.object({ id: z.string(), type: z.string() })),
          }),
        ),
      }),
    )
    .query(async ({ ctx, input }) => {
      const run = await ctx.prisma.testRun.findUniqueOrThrow({
        where: { id: input.id },
        include: {
          results: { include: { testCase: { select: { title: true } }, artifacts: true } },
          startedBy: { select: { email: true } },
        },
      });
      await requireProjectAccess(ctx, run.projectId);
      return {
        id: run.id,
        projectId: run.projectId,
        ciProvider: run.ciProvider,
        ciRunUrl: run.ciRunUrl,
        commitSha: run.commitSha,
        branch: run.branch,
        status: run.status,
        startedAt: run.startedAt,
        startedByEmail: run.startedBy?.email ?? null,
        results: run.results.map((r) => ({
          id: r.id,
          externalTestId: r.externalTestId,
          testCaseId: r.testCaseId,
          testCaseTitle: r.testCase?.title ?? null,
          status: r.status,
          durationMs: r.durationMs,
          errorMessage: r.errorMessage,
          note: r.note,
          artifacts: r.artifacts.map((a) => ({ id: a.id, type: a.type })),
        })),
      };
    }),

  // P5-04: the manual half of result <-> TestCase matching -- P5-01's
  // ingestion only auto-matches an exact TestCaseSource.externalTestId hit.
  // Everything else lands here as "unmatched" until a human links it once.
  // That link is remembered: if the target TestCase's source has no
  // externalTestId yet, this sets it, so the *next* run of that same test
  // auto-matches without anyone linking it again. Refuses to silently
  // overwrite a source that's already mapped to a *different* external id --
  // that would be quietly breaking whatever result stream already resolves
  // through it.
  linkResultToTestCase: protectedProcedure
    .input(z.object({ testResultId: z.string(), testCaseId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.prisma.testResult.findUniqueOrThrow({
        where: { id: input.testResultId },
        include: { testRun: { select: { projectId: true } } },
      });
      await requireProjectAccess(ctx, result.testRun.projectId, "EDITOR");

      const testCase = await ctx.prisma.testCase.findUniqueOrThrow({
        where: { id: input.testCaseId },
        include: { source: true },
      });
      if (testCase.projectId !== result.testRun.projectId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "That test case does not belong to this project" });
      }

      if (result.externalTestId && testCase.source) {
        if (testCase.source.externalTestId && testCase.source.externalTestId !== result.externalTestId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `This test case is already linked to a different external test id ("${testCase.source.externalTestId}")`,
          });
        }
        if (!testCase.source.externalTestId) {
          await ctx.prisma.testCaseSource.update({
            where: { id: testCase.source.id },
            data: { externalTestId: result.externalTestId },
          });
        }
      }

      const updated = await ctx.prisma.testResult.update({
        where: { id: input.testResultId },
        data: { testCaseId: input.testCaseId },
        select: { id: true, testCaseId: true },
      });
      await recomputeFlaky(ctx.prisma, input.testCaseId);
      return updated;
    }),

  // P5-15: the runner-side reporter (Playwright/Cypress/WebdriverIO) calls
  // this once a test has actually failed -- never on a pass, and never
  // uploading a rolling video buffer that a passing run just discards. The
  // reporter never gets real S3 credentials: this returns a short-lived
  // presigned PUT the reporter uses directly, and the DB row is created
  // immediately with the eventual object's canonical (non-presigned) URL,
  // matching how every other artifact record in this schema already works.
  requestArtifactUpload: protectedProcedure
    .input(z.object({ testResultId: z.string(), type: z.enum(["SCREENSHOT", "VIDEO"]), durationMs: z.number().optional() }))
    .output(z.object({ artifactId: z.string(), uploadUrl: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.prisma.testResult.findUniqueOrThrow({
        where: { id: input.testResultId },
        include: { testRun: { select: { projectId: true } } },
      });
      await requireProjectAccess(ctx, result.testRun.projectId, "EDITOR");
      if (result.status !== "FAIL") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Artifacts are only accepted for a FAIL result" });
      }

      const key = buildArtifactKey(result.testRun.projectId, input.testResultId, input.type);
      const [uploadUrl, artifact] = await Promise.all([
        createUploadUrl(key, input.type),
        ctx.prisma.testResultArtifact.create({
          data: {
            testResultId: input.testResultId,
            type: input.type,
            storageUrl: canonicalUrl(key),
            durationMs: input.type === "VIDEO" ? input.durationMs : undefined,
          },
        }),
      ]);

      return { artifactId: artifact.id, uploadUrl };
    }),

  // The UI never resolves storageUrl directly (the bucket blocks all
  // public access) -- it asks for a fresh short-lived signed GET each time
  // an artifact is actually viewed.
  getArtifactViewUrl: protectedProcedure
    .input(z.object({ artifactId: z.string() }))
    .output(z.object({ viewUrl: z.string() }))
    .query(async ({ ctx, input }) => {
      const artifact = await ctx.prisma.testResultArtifact.findUniqueOrThrow({
        where: { id: input.artifactId },
        include: { testResult: { include: { testRun: { select: { projectId: true } } } } },
      });
      await requireProjectAccess(ctx, artifact.testResult.testRun.projectId);
      const viewUrl = await createViewUrl(keyFromCanonicalUrl(artifact.storageUrl));
      return { viewUrl };
    }),
});
