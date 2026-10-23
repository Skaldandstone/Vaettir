import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { Prisma, type PrismaClient } from "@vaettir/db";
import type { z } from "zod";
import {
  recordedResultStatuses,
  type recordedRunListInput,
  type recordedRunComparisonInput,
  type recordedRunComparisonOutput,
  type recordedRunMetadata,
} from "./recordedRunComparisonSchema.js";
type Database = Prisma.TransactionClient;
type Run = z.infer<typeof recordedRunMetadata>;
type Comparison = z.infer<typeof recordedRunComparisonOutput>;
type Result = {
  id: string;
  runId: string;
  caseId: string | null;
  mapping: "MAPPED" | "UNMATCHED" | "UNAVAILABLE_LINK";
  status: (typeof recordedResultStatuses)[number];
  durationMs: number | null;
};
const limitations = [
  "Recorded counts only. Comparable recorded configuration and frozen automated-test definition context are unavailable; provider, branch or commit labels do not establish equivalence.",
  "No regression, flakiness or verified recovery classification is made. FLAKY is a reported result status, not a stored case flag or a new detection decision.",
  "Multiple result rows for one case remain separate observations. Retry/attempt grouping and original per-result timestamps are not recorded by this model and are not invented.",
  "Run timestamps are stored run metadata; this view cannot prove that historical imports supplied original execution timestamps. Case labels are current identities, not frozen definitions.",
  "Missing on one side means no mapped result in that selected run, not a pass, skip or proof the test was never executed. Unmatched and unavailable cross-project mappings are counted separately.",
  "Read-time evidence, not an immutable report. At most 10,000 recorded results per selected run and 50 case rows per page; larger populations fail explicitly rather than truncate. In-progress runs are incomplete.",
  "Duration summaries cover only non-negative recorded durations; they do not prove comparable performance. Raw notes, error messages, artifacts, file paths and source are not loaded.",
  "Original-organization request binding pins the current authorized project scope, not a historical organization or release certification; those run metadata are not recorded by this model.",
];
export async function withRecordedRunAccess<T>(
  db: PrismaClient,
  userId: string,
  projectId: string,
  expectedOrganizationId: string,
  work: (tx: Database) => Promise<T>,
  scope?: { originalOrganizationId?: string; expectedClerkActorId?: string; verifiedClerkActorId?: string },
) {
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw(Prisma.sql`SET LOCAL statement_timeout = '8000ms'`);
      if (scope?.originalOrganizationId && scope.originalOrganizationId !== expectedOrganizationId)
        throw new TRPCError({ code: "FORBIDDEN", message: "This retained comparison belongs to a different original organization. Selections were not replaced." });
      const org = await tx.$queryRaw<
        Array<{ suspendedAt: Date | null }>
      >`SELECT "suspendedAt" FROM "Organization" WHERE id=${expectedOrganizationId} FOR SHARE`;
      const member = await tx.$queryRaw<
        Array<{ id: string; role: string; seatType: string }>
      >`SELECT id,role::text AS role,"seatType"::text AS "seatType" FROM "Membership" WHERE "organizationId"=${expectedOrganizationId} AND "userId"=${userId} FOR SHARE`;
      const project = await tx.$queryRaw<
        Array<{ organizationId: string }>
      >`SELECT "organizationId" FROM "Project" WHERE id=${projectId} FOR SHARE`;
      if (
        !org[0] ||
        org[0].suspendedAt ||
        !member[0] ||
        !["OWNER", "ADMIN", "EDITOR", "VIEWER", "COMPLIANCE_AUDITOR"].includes(member[0].role) ||
        !["FULL", "READ_ONLY"].includes(member[0].seatType) ||
        project[0]?.organizationId !== expectedOrganizationId
      )
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Current original-organization project access is required.",
        });
      const actor = await tx.user.findUnique({ where: { id: userId }, select: { clerkUserId: true } });
      if (!actor || (scope?.expectedClerkActorId && actor.clerkUserId !== scope.expectedClerkActorId) ||
          (scope?.verifiedClerkActorId && actor.clerkUserId !== scope.verifiedClerkActorId))
        throw new TRPCError({ code: "FORBIDDEN", message: "Current signed-in comparison actor changed. Retained selections were not rebound." });
      const value = await work(tx);
      return { ...value, organizationId: expectedOrganizationId, clerkActorId: actor.clerkUserId };
    },
    { isolationLevel: "RepeatableRead", timeout: 20000 },
  );
}
const runProjection = Prisma.sql`id,left("ciProvider",80) AS provider,length("ciProvider")>80 AS "providerClipped",left("commitSha",160) AS commit,length("commitSha")>160 AS "commitClipped",left(branch,160) AS branch,length(branch)>160 AS "branchClipped","startedAt","finishedAt",status::text AS status`;
type StoredRun = Omit<Run, "startedAt" | "finishedAt"> & {
  startedAt: Date;
  finishedAt: Date | null;
};
function metadata(run: StoredRun): Run {
  return {
    ...run,
    // PostgreSQL left() bounds code points; Zod/JS bounds UTF-16 units. Keep
    // Unicode legacy labels bounded without splitting a surrogate pair.
    provider: clippedText(run.provider, 80),
    providerClipped: run.providerClipped || run.provider.length > 80,
    commit: clippedText(run.commit, 160),
    commitClipped: run.commitClipped || run.commit.length > 160,
    branch: clippedText(run.branch, 160),
    branchClipped: run.branchClipped || run.branch.length > 160,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
  };
}
function clippedText(value: string, limit: number) {
  return value.slice(0, limit).replace(/[\uD800-\uDBFF]$/u, "");
}
export async function listRecordedRuns(
  tx: Database,
  input: z.infer<typeof recordedRunListInput>,
) {
  if (input.cursor) {
    const [cursor] = await tx.$queryRaw<
      Array<{ startedAt: Date }>
    >`SELECT "startedAt" FROM "TestRun" WHERE id=${input.cursor.runId} AND "projectId"=${input.projectId} AND lower(btrim("ciProvider"))<>'manual'`;
    if (!cursor || cursor.startedAt.toISOString() !== input.cursor.startedAt)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "This recorded-run cursor is unavailable. Refresh the run list.",
      });
  }
  const rows = await tx.$queryRaw<StoredRun[]>(
    // Compare the stored tuple to the same scoped stored cursor. PostgreSQL's
    // timestamp-without-time-zone column must not be compared to a driver-bound
    // timestamptz: that conversion depends on the server session timezone and
    // loses equal-timestamp rows outside UTC. The client timestamp is still
    // verified above; it never supplies the SQL paging boundary.
    Prisma.sql`SELECT ${runProjection} FROM "TestRun" WHERE "projectId"=${input.projectId} AND lower(btrim("ciProvider"))<>'manual' AND ${input.cursor ? Prisma.sql`("startedAt",id)<(SELECT "startedAt",id FROM "TestRun" WHERE id=${input.cursor.runId} AND "projectId"=${input.projectId} AND lower(btrim("ciProvider"))<>'manual')` : Prisma.sql`true`} ORDER BY "startedAt" DESC,id DESC LIMIT 21`,
  );
  const items = rows.slice(0, 20).map(metadata),
    last = items.at(-1);
  return {
    projectId: input.projectId,
    requestId: input.requestId,
    items,
    nextCursor:
      rows.length > 20 && last
        ? { runId: last.id, startedAt: last.startedAt }
        : null,
    limitations: limitations.slice(0, 4),
  };
}
function blank() {
  return {
    resultCount: 0,
    counts: { PASS: 0, FAIL: 0, SKIP: 0, FLAKY: 0, BLOCKED: 0 },
    timedResults: 0,
    missingDurations: 0,
    invalidDurations: 0,
    minDurationMs: null as number | null,
    maxDurationMs: null as number | null,
    meanDurationMs: null as number | null,
  };
}
function summarize(rows: Result[]) {
  const value = blank();
  let sum = 0;
  for (const row of rows) {
    value.resultCount++;
    value.counts[row.status]++;
    if (row.durationMs === null) value.missingDurations++;
    else if (row.durationMs < 0) value.invalidDurations++;
    else {
      value.timedResults++;
      sum += row.durationMs;
      value.minDurationMs =
        value.minDurationMs === null
          ? row.durationMs
          : Math.min(value.minDurationMs, row.durationMs);
      value.maxDurationMs =
        value.maxDurationMs === null
          ? row.durationMs
          : Math.max(value.maxDurationMs, row.durationMs);
    }
  }
  value.meanDurationMs = value.timedResults ? sum / value.timedResults : null;
  return value;
}
function runSummary(rows: Result[]) {
  return {
    ...summarize(rows),
    mappedResults: summarize(rows.filter((row) => row.mapping === "MAPPED"))
      .counts,
    unmatchedResults: summarize(
      rows.filter((row) => row.mapping === "UNMATCHED"),
    ).counts,
    unavailableLinks: summarize(
      rows.filter((row) => row.mapping === "UNAVAILABLE_LINK"),
    ).counts,
  };
}
export async function compareRecordedRuns(
  tx: Database,
  input: z.infer<typeof recordedRunComparisonInput>,
  actorId: string,
  organizationId: string,
): Promise<Omit<Comparison, "organizationId" | "clerkActorId">> {
  if (input.baselineRunId === input.candidateRunId)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Choose two different recorded runs.",
    });
  const runs = await tx.$queryRaw<StoredRun[]>(
    Prisma.sql`SELECT ${runProjection} FROM "TestRun" WHERE "projectId"=${input.projectId} AND id IN (${Prisma.join([input.baselineRunId, input.candidateRunId])}) AND lower(btrim("ciProvider"))<>'manual'`,
  );
  const baseline = runs.find((run) => run.id === input.baselineRunId),
    candidate = runs.find((run) => run.id === input.candidateRunId);
  if (!baseline || !candidate)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "One selected non-manual run is unavailable in this project.",
    });
  if (baseline.startedAt.getTime() >= candidate.startedAt.getTime())
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Choose a baseline with a recorded start strictly before the candidate. Equal or missing chronology is not inferred.",
    });
  const counts = await tx.testResult.groupBy({
    by: ["testRunId"],
    where: { testRunId: { in: [baseline.id, candidate.id] } },
    _count: { _all: true },
  });
  if (counts.some((count) => count._count._all > 10000))
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "A selected run exceeds the 10,000-result comparison bound. No partial cohort was substituted.",
    });
  // Select only bounded result identity/status/duration. Foreign case content/IDs
  // are never projected; unavailable references form their own aggregate bucket.
  const results = await tx.$queryRaw<Result[]>(
    Prisma.sql`SELECT r.id,r."testRunId" AS "runId",c.id AS "caseId",CASE WHEN r."testCaseId" IS NULL THEN 'UNMATCHED' WHEN c.id IS NULL THEN 'UNAVAILABLE_LINK' ELSE 'MAPPED' END AS mapping,r.status::text AS status,r."durationMs" FROM "TestResult" r JOIN "TestRun" run ON run.id=r."testRunId" AND run."projectId"=${input.projectId} LEFT JOIN "TestCase" c ON c.id=r."testCaseId" AND c."projectId"=${input.projectId} WHERE r."testRunId" IN (${Prisma.join([baseline.id, candidate.id])}) ORDER BY r.id LIMIT 20001`,
  );
  if (
    results.length > 20000 ||
    results.length !== counts.reduce((sum, count) => sum + count._count._all, 0)
  )
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "The selected result population is unavailable. Refresh comparison; no smaller set was substituted.",
    });
  const pairHash = createHash("sha256")
    .update(
      JSON.stringify({
        projectId: input.projectId,
        actorId,
        organizationId,
        baseline: metadata(baseline),
        candidate: metadata(candidate),
        results,
      }),
    )
    .digest("hex");
  if (
    (input.cursor && input.cursor.expectedPairHash !== pairHash) ||
    (input.expectedPairHash && input.expectedPairHash !== pairHash)
  )
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "Selected run evidence changed after this page was read. Restart the comparison; original failures were not replaced.",
    });
  const grouped = new Map<
    string,
    { baseline: Result[]; candidate: Result[] }
  >();
  for (const result of results) {
    if (result.mapping !== "MAPPED" || !result.caseId) continue;
    const group = grouped.get(result.caseId) ?? { baseline: [], candidate: [] };
    group[result.runId === baseline.id ? "baseline" : "candidate"].push(result);
    grouped.set(result.caseId, group);
  }
  const ids = [...grouped.keys()].sort();
  if (input.cursor && !grouped.has(input.cursor.caseId))
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "This case cursor does not belong to the selected recorded-run population.",
    });
  const remaining = input.cursor
      ? ids.filter((id) => id > input.cursor!.caseId)
      : ids,
    selected = remaining.slice(0, 50);
  const labels = selected.length
    ? await tx.$queryRaw<
        Array<{
          id: string;
          displayId: string;
          title: string;
          titleClipped: boolean;
          archived: boolean;
        }>
      >(
        Prisma.sql`SELECT id,"displayId",left(title,1000) AS title,length(title)>1000 AS "titleClipped",archived FROM "TestCase" WHERE "projectId"=${input.projectId} AND id IN (${Prisma.join(selected)})`,
      )
    : [];
  const byId = new Map(labels.map((label) => [label.id, label]));
  if (byId.size !== selected.length)
    throw new TRPCError({
      code: "CONFLICT",
      message: "Current case identities changed; restart this comparison.",
    });
  const items = selected.map((caseId) => {
    const label = byId.get(caseId)!,
      group = grouped.get(caseId)!,
      a = summarize(group.baseline),
      b = summarize(group.candidate);
    const difference: Comparison["items"][number]["difference"] = !a.resultCount
      ? "CANDIDATE_ONLY"
      : !b.resultCount
        ? "BASELINE_ONLY"
        : JSON.stringify(a.counts) === JSON.stringify(b.counts)
          ? "SAME_COUNTS"
          : "COUNTS_CHANGED";
    return {
      caseId,
      displayId: label.displayId,
      title: clippedText(label.title, 1000),
      titleClipped: label.titleClipped || label.title.length > 1000,
      archived: label.archived,
      baseline: a,
      candidate: b,
      difference,
    };
  });
  const last = items.at(-1);
  return {
    projectId: input.projectId,
    requestId: input.requestId,
    pairHash,
    baseline: metadata(baseline),
    candidate: metadata(candidate),
    baselineSummary: runSummary(
      results.filter((result) => result.runId === baseline.id),
    ),
    candidateSummary: runSummary(
      results.filter((result) => result.runId === candidate.id),
    ),
    mappedCaseCount: ids.length,
    comparableConfiguration: false,
    comparisonScope: "RECORDED_COUNTS_ONLY",
    items,
    nextCursor:
      remaining.length > 50 && last
        ? { caseId: last.caseId, expectedPairHash: pairHash }
        : null,
    limitations,
  };
}
