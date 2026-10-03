import { TRPCError } from "@trpc/server";
import { Prisma, type PrismaClient } from "@vaettir/db";
import {
  summarizeCaseOutcomes,
  type CaseExecutionHistoryItem,
  type CaseExecutionHistoryPage,
} from "@vaettir/core";
import { z } from "zod";
import { requireCurrentPlanAccess } from "./testPlanExecution.js";

const metadataSchema = z.object({
  version: z.literal(1),
  profileHash: z.string().regex(/^[a-f0-9]{64}$/),
  caseCount: z.number().int().min(1).max(500),
  matchedCount: z.literal(1),
  metadataValid: z.literal(true),
  title: z.string().max(10000),
  stepCount: z.number().int().min(0).max(500),
  platform: z.string().max(300),
  build: z.string().max(300),
  environment: z.string().max(2000),
});

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

/** Read-only, bounded summaries. No procedures, observation payloads or artifact URLs are loaded. */
export async function listCaseExecutionHistory(
  db: PrismaClient,
  userId: string,
  input: {
    projectId: string;
    testCaseId: string;
    limit: number;
    before?: { runId: string };
  },
): Promise<CaseExecutionHistoryPage> {
  return db.$transaction(
    async (tx) => {
      await requireCurrentPlanAccess(tx, userId, input.projectId);
      const testCase = await tx.testCase.findFirst({
        where: { id: input.testCaseId, projectId: input.projectId },
        select: { id: true, displayId: true, title: true, archived: true },
      });
      if (!testCase)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Test case not found in this project.",
        });
      const scope = {
        projectId: input.projectId,
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
      const runs = await tx.testRun.findMany({
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
      if (!page.length) return { testCase, items: [], nextCursor: null };
      const runIds = page.map((r) => r.id);
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
        obs."actorId" AS "lastActorId", left(obs."actorName", 300) AS "lastActorName", obs."recordedAt" AS "lastRecordedAt",
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
        const limitations: string[] = [];
        if (!frozen)
          limitations.push(
            manual && m.hasSnapshot
              ? "Saved definition metadata is unsupported or incomplete. Current case content is not substituted."
              : "The definition at execution was not recorded. Current case content is not proof of what ran.",
          );
        if (manual && !m.recordedCount && resultCount)
          limitations.push(
            "Latest whole-case outcome only; earlier changes, observer and observation time were not recorded.",
          );
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
          platform: frozen?.platform.trim() || null,
          build: frozen?.build.trim() || null,
          environment: frozen?.environment.trim() || null,
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
          limitations,
        };
      });
      return {
        testCase,
        items,
        nextCursor:
          runs.length > input.limit
            ? { runId: page[page.length - 1]!.id }
            : null,
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: 10000,
    },
  );
}
