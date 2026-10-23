import { TRPCError } from "@trpc/server";
import { Prisma, type PrismaClient } from "@vaettir/db";
import {
  summarizeCaseOutcomes,
  type CaseExecutionHistoryItem,
  type CaseExecutionHistoryPage,
} from "@vaettir/core";
import { caseExecutionHistoryInputSchema, caseHistoryFilterKey, caseHistoryRequestKey, caseHistoryScopeLimits,
  caseHistoryMetadataSchema as metadataSchema, type CaseExecutionHistoryInput } from "./caseExecutionHistoryScopeSchema.js";
import { lockCaseHistoryAccess, caseHistoryWindow, readCaseHistoryConfigurationIds } from "./caseExecutionHistoryScope.js";
import { caseHistoryRunWhere } from "./caseHistoryRunFilters.js";
import { readCaseHistoryWholeCaseSummaries } from "./caseHistoryWholeCaseSummary.js";

type ProjectedMetadata = {
  runId: string;
  planned: boolean;
  hasSnapshot: boolean;
  version: unknown;
  profileHash: string | null;
  caseCount: number;
  matchedCount: number;
  metadataValid: boolean | null;
  title: string | null;
  stepCount: number;
  platform: string | null;
  build: string | null;
  environment: string | null;
  recordedCount: number;
  correctionCount: number;
  lastActorId: string | null;
  lastActorName: string | null;
  lastRecordedAt: Date | null;
  artifactCount: number;
};
function boundedHistoryResponse(value: CaseExecutionHistoryPage) {
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > 4194304)
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This history response exceeds 4 MiB. No partial page was substituted." });
  return value;
}

/** Read-only, bounded summaries. No procedures, observation payloads or artifact URLs are loaded. */
export async function listCaseExecutionHistory(
  db: PrismaClient,
  userId: string,
  raw: CaseExecutionHistoryInput,
  authorizedScope?: { organizationId: string; clerkActorId: string },
): Promise<CaseExecutionHistoryPage> {
  const input = caseExecutionHistoryInputSchema.parse(raw);
  // Legacy direct callers may omit the transport's prior authorization snapshot;
  // this identity-only lookup is rechecked under locks before case/run bodies.
  const project = authorizedScope ? null : await db.project.findUnique({ where: { id: input.projectId }, select: { organizationId: true } });
  const actor = authorizedScope ? null : await db.user.findUnique({ where: { id: userId }, select: { clerkUserId: true } });
  const authorized = authorizedScope ?? (project && actor ? { organizationId: project.organizationId, clerkActorId: actor.clerkUserId } : null);
  if (!authorized) throw new TRPCError({ code: "NOT_FOUND", message: "Current case history access is unavailable." });
  return db.$transaction(
    async (tx) => {
      const access = await lockCaseHistoryAccess(tx, userId, input, authorized);
      const observedAt = new Date(), window = caseHistoryWindow(input, observedAt), filterKey = caseHistoryFilterKey(input);
      if (input.before && (input.before.filterKey !== undefined || input.filters !== undefined) && input.before.filterKey !== filterKey)
        throw new TRPCError({ code: "BAD_REQUEST", message: "This cursor belongs to another case-history filter. Start at the latest page." });
      const header = await tx.$queryRaw<Array<{ bytes: number; invalidIdentity: boolean }>>(Prisma.sql`SELECT (octet_length(id)+octet_length("displayId")+octet_length(title))::int AS bytes,
        (length(id)>200 OR length("displayId")>200) AS "invalidIdentity"
        FROM "TestCase" WHERE id=${input.testCaseId} AND "projectId"=${input.projectId} FOR SHARE`);
      if (header[0] && (header[0].bytes > 4194304 || header[0].invalidIdentity)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This case header exceeds the bounded history response. No truncated identity was substituted." });
      const testCase = await tx.testCase.findFirst({
        where: { id: input.testCaseId, projectId: input.projectId },
        select: { id: true, displayId: true, title: true, archived: true },
      });
      if (!testCase)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Test case not found in this project.",
        });
      const configurationIds = await readCaseHistoryConfigurationIds(tx, input, window);
      const scope: Prisma.TestRunWhereInput = {
        projectId: input.projectId,
        ...caseHistoryRunWhere(input.filters),
        ...(window ? { startedAt: { gte: window.start, lte: window.end } } : {}),
        ...(configurationIds === undefined ? {} : { id: { in: configurationIds } }),
        OR: [
          { manualTestCaseIds: { has: testCase.id } },
          { results: { some: { testCaseId: testCase.id } } },
        ],
      };
      const anchor = input.before
        ? await tx.testRun.findFirst({
            where: { ...scope, id: input.before.runId },
            select: { id: true, startedAt: true },
          })
        : null;
      if (input.before && !anchor)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "This history cursor is unavailable in this case. Refresh its history.",
        });
      const selected = await tx.testRun.findMany({
        where: {
          AND: [
            scope,
            ...(anchor
              ? [
                  {
                    OR: [
                      { startedAt: { lt: anchor.startedAt } },
                      { startedAt: anchor.startedAt, id: { lt: anchor.id } },
                    ],
                  },
                ]
              : []),
          ],
        },
        orderBy: [{ startedAt: "desc" }, { id: "desc" }],
        take: input.limit + 1,
        select: { id: true },
      });
      // Page-label gate before ORM materializes any legacy profile/provider text.
      if (selected.length) {
        const bytes = await tx.$queryRaw<Array<{ bytes: bigint; invalidIdentity: boolean }>>(Prisma.sql`SELECT coalesce(sum(octet_length(r.id)+octet_length(r."ciProvider")+octet_length(r."commitSha")+
          coalesce(octet_length(u.id),0)+coalesce(octet_length(u.name),0)+coalesce(octet_length(u.email),0)),0)::bigint AS bytes
          ,coalesce(bool_or(length(r.id)>200 OR coalesce(length(u.id)>200,false)),false) AS "invalidIdentity"
          FROM "TestRun" r LEFT JOIN "User" u ON u.id=r."startedById" WHERE r."projectId"=${input.projectId} AND r.id IN (${Prisma.join(selected.map(r => r.id))})`);
        if (!bytes[0] || bytes[0].bytes > 4194304n || bytes[0].invalidIdentity) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This recorded page's labels exceed the history bounds. No partial page was substituted." });
      }
      const runs = await tx.testRun.findMany({
        where: { projectId: input.projectId, id: { in: selected.map(r => r.id) } },
        orderBy: [{ startedAt: "desc" }, { id: "desc" }],
        select: {
          id: true,
          ciProvider: true,
          startedAt: true,
          finishedAt: true,
          status: true,
          commitSha: true,
          startedBy: { select: { id: true, name: true, email: true } },
        },
      });
      const page = runs.slice(0, input.limit);
      const responseScope = { ...access, requested: caseHistoryRequestKey(input), observedAt: observedAt.toISOString(),
        window: window ? { start: window.start.toISOString(), end: window.end.toISOString() } : null, limits: caseHistoryScopeLimits };
      if (!page.length) return boundedHistoryResponse({ ...responseScope, testCase, items: [], nextCursor: null });
      const runIds = page.map((r) => r.id);
      const wholeCaseSummaries = await readCaseHistoryWholeCaseSummaries(tx, {
        projectId: input.projectId, testCaseId: testCase.id,
        originalOrganizationId: access.organizationId, runIds,
      });
      const counts = await tx.testResult.groupBy({
        by: ["testRunId", "status"],
        where: { testRunId: { in: runIds }, testCaseId: testCase.id },
        _count: { _all: true },
      });
      // Project only the selected case's frozen summary inside PostgreSQL. The full
      // snapshot can contain 500 procedures / 2 MiB, and is deliberately lazy.
      // Legacy/malformed arrays are bounded before expansion; oversized snapshots
      // produce an honest unavailable summary, not current-case substitutions.
      const metadata = await tx.$queryRaw<ProjectedMetadata[]>(Prisma.sql`
      SELECT r.id AS "runId", ${testCase.id} = ANY(r."manualTestCaseIds") AS planned,
        (r."executionContext" ? 'version') AS "hasSnapshot",
        r."executionContext"->'version' AS version,
        left(r."executionContext"->>'profileHash', 65) AS "profileHash",
        jsonb_array_length(defs.value)::int AS "caseCount",
        m.count::int AS "matchedCount",
        (jsonb_typeof(m.value->'title') = 'string'
          AND jsonb_typeof(m.value->'given') = 'array'
          AND jsonb_typeof(m.value->'when') = 'array'
          AND jsonb_typeof(m.value->'then') = 'array'
          AND jsonb_typeof(m.value->'steps') = 'array'
          AND jsonb_typeof(m.value->'verificationProfile') = 'object'
          AND jsonb_typeof(r."executionContext"->'configuration') = 'object'
          AND jsonb_typeof(r."executionContext"->'configuration'->'platform') = 'string'
          AND jsonb_typeof(r."executionContext"->'configuration'->'build') = 'string'
          AND jsonb_typeof(r."executionContext"->'configuration'->'environment') = 'string') AS "metadataValid",
        left(m.value->>'title', 10001) AS title,
        CASE WHEN jsonb_typeof(m.value->'steps') = 'array' THEN jsonb_array_length(m.value->'steps') ELSE 0 END::int AS "stepCount",
        left(r."executionContext"->'configuration'->>'platform', 301) AS platform,
        left(r."executionContext"->'configuration'->>'build', 301) AS build,
        left(r."executionContext"->'configuration'->>'environment', 2001) AS environment,
        h.count::int AS "recordedCount", h.corrections::int AS "correctionCount",
        left(obs."actorId",201) AS "lastActorId", left(obs."actorName", 300) AS "lastActorName", obs."recordedAt" AS "lastRecordedAt",
        a.count::int AS "artifactCount"
      FROM "TestRun" r
      CROSS JOIN LATERAL (SELECT CASE
        WHEN octet_length(r."executionContext"::text) <= 2097152
          AND jsonb_typeof(r."executionContext"->'caseDefinitions') = 'array'
        THEN CASE WHEN jsonb_array_length(r."executionContext"->'caseDefinitions') <= 500
          THEN r."executionContext"->'caseDefinitions' ELSE '[]'::jsonb END
        ELSE '[]'::jsonb END AS value) defs
      CROSS JOIN LATERAL (SELECT count(*) AS count, (jsonb_agg(d.value)->0) AS value
        FROM jsonb_array_elements(defs.value) d(value) WHERE d.value->>'testCaseId' = ${testCase.id}) m
      CROSS JOIN LATERAL (SELECT count(*) AS count, coalesce(sum(greatest("revisionCount" - 1, 0)), 0) AS corrections
        FROM "ManualStepResultHead" WHERE "testRunId" = r.id AND "testCaseId" = ${testCase.id}) h
      LEFT JOIN LATERAL (SELECT "actorId", "actorName", "recordedAt"
        FROM "ManualStepResultRevision" WHERE "testRunId" = r.id AND "testCaseId" = ${testCase.id}
        ORDER BY "recordedAt" DESC, id DESC LIMIT 1) obs ON true
      CROSS JOIN LATERAL (SELECT count(*) AS count FROM "TestResultArtifact" a
        JOIN "TestResult" t ON t.id = a."testResultId"
        WHERE t."testRunId" = r.id AND t."testCaseId" = ${testCase.id}) a
      WHERE r."projectId" = ${input.projectId} AND r.id IN (${Prisma.join(runIds)})
    `);
      const byRun = new Map(metadata.map((m) => [m.runId, m]));
      const items: CaseExecutionHistoryItem[] = page.map((run) => {
        const m = byRun.get(run.id);
        if (!m)
          throw new TRPCError({
            code: "CONFLICT",
            message: "Execution history changed. Refresh its history.",
          });
        if (m.lastActorId && m.lastActorId.length > 200) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This stored observer identity exceeds native history bounds. No truncated identity was substituted." });
        const manual = run.ciProvider === "manual";
        const parsed =
          manual && m.hasSnapshot ? metadataSchema.safeParse(m) : null;
        const frozen = parsed?.success ? parsed.data : null;
        const outcomeCounts = counts
          .filter((c) => c.testRunId === run.id)
          .map((c) => ({ status: c.status, count: c._count._all }));
        const resultCount = outcomeCounts.reduce((sum, c) => sum + c.count, 0);
        const partial =
          m.recordedCount > 0 &&
          (!frozen || m.recordedCount !== frozen.stepCount);
        const wholeCase = Object.hasOwn(wholeCaseSummaries, run.id) ? wholeCaseSummaries[run.id] : undefined;
        const limitations: string[] = [];
        if (!frozen)
          limitations.push(
            manual && m.hasSnapshot
              ? "Saved definition metadata is unsupported or incomplete. Current case content is not substituted."
              : "The definition at execution was not recorded. Current case content is not proof of what ran.",
          );
        if (manual && !m.recordedCount && resultCount && !wholeCase)
          limitations.push(
            "Latest whole-case outcome only; this summary does not project immutable whole-case revision evidence. For unversioned observations, earlier changes, observer and observation time were not recorded. Open the native run to inspect any retained history; corrections are not new executions.",
          );
        if (wholeCase)
          limitations.push("Retained whole-case revision metadata at this read, not separate executions or an as-of verdict. Observation notes, correction reasons and any captured unversioned prior result remain in the native history; earlier unrecorded changes are not reconstructed.");
        if (partial)
          limitations.push(
            "Only part of the saved procedure has step observations; these do not prove a completed case.",
          );
        if (resultCount > 1)
          limitations.push(
            "Multiple reported results in one execution, including possible parameter rows; no arbitrary latest result is chosen.",
          );
        if (frozen)
          limitations.push(
            "Saved definition summary; open the manual execution to review the full frozen procedure.",
          );
        return {
          runId: run.id,
          source: manual ? "MANUAL" : "CI_IMPORT",
          provider: run.ciProvider,
          startedAt: run.startedAt.toISOString(),
          finishedAt: run.finishedAt?.toISOString() ?? null,
          runStatus: run.status,
          planned: m.planned,
          outcome: partial
            ? "NOT_RECORDED"
            : summarizeCaseOutcomes(outcomeCounts),
          outcomeCounts,
          outcomeMode: partial
            ? "PARTIAL_STEPS"
            : resultCount > 1
              ? "MULTIPLE_REPORTED_RESULTS"
              : m.recordedCount
                ? "STEP_RESULTS"
                : resultCount
                  ? "CASE_RESULT"
                  : m.planned
                    ? "PLANNED_ONLY"
                    : "NO_CASE_RESULT",
          platform: frozen?.platform ?? null,
          build: frozen?.build ?? null,
          environment: frozen?.environment ?? null,
          reportedCommit:
            manual || run.commitSha === "manual" ? null : run.commitSha,
          starter: run.startedBy
            ? {
                id: run.startedBy.id,
                label: run.startedBy.name || run.startedBy.email,
                source: "CURRENT_PROFILE",
              }
            : null,
          definition: {
            source: frozen
              ? "FROZEN_MANUAL_SUMMARY"
              : manual && m.hasSnapshot
                ? "UNSUPPORTED_METADATA"
                : "NOT_RECORDED",
            originalCaseId: testCase.id,
            titleAtRun: frozen?.title ?? null,
            stepCount: frozen?.stepCount ?? null,
          },
          steps: {
            recordedCount: m.recordedCount,
            correctionCount: m.correctionCount,
            lastObservation:
              m.lastActorId && m.lastRecordedAt
                ? {
                    actorId: m.lastActorId,
                    recordedActorName: m.lastActorName || "Name not recorded",
                    recordedAt: m.lastRecordedAt.toISOString(),
                  }
                : null,
          },
          artifactCount: m.artifactCount,
          wholeCase: wholeCase ? { ...wholeCase, lastRecordedAt: wholeCase.lastRecordedAt.toISOString() } : null,
          limitations,
        };
      });
      return boundedHistoryResponse({
        ...responseScope,
        testCase,
        items,
        nextCursor:
          runs.length > input.limit
            ? { runId: page[page.length - 1]!.id, filterKey }
            : null,
      });
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: 20000,
    },
  );
}
