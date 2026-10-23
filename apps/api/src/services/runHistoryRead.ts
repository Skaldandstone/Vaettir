import { Prisma, type PrismaClient } from "@vaettir/db";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  lockCaseFieldReadScope,
  type CaseFieldReadAuthorization,
} from "./caseFieldReadScope.js";
import { runProgress, type GroupedRunOutcome } from "./runProgress.js";
import { supportedManualExecutionIdentity } from "./manualExecutionReadScopeSchema.js";
import {
  runHistoryAccessInput,
  runHistoryAccessOutput,
  runHistoryPageInput,
  runHistoryPageOutput,
  runHistoryReadKey,
  runHistoryRow,
  type RunHistoryPage,
} from "./runHistoryReadSchema.js";
const options = {
  isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
  timeout: 10000,
  maxWait: 5000,
};
const unsupported = () =>
  new TRPCError({
    code: "PRECONDITION_FAILED",
    message:
      "This complete history page exceeds its supported metadata/identity/status bounds. Narrow the page; nothing was clipped or returned as zero progress.",
  });
const foreign = () =>
  new TRPCError({
    code: "FORBIDDEN",
    message:
      "Retained run evidence points outside the original project/organization. No foreign metadata or counts were returned.",
  });
const nonnegative = (value: unknown): value is bigint =>
  typeof value === "bigint" && value >= 0n;
const limitations = [
  "This is a current bounded keyset page, not a globally frozen history snapshot or whole-project count. The asOf anchor bounds stored run-start times; result corrections may change while paging.",
  "Manual progress counts unique planned native identities with current result verdicts. It is distinct from the trusted frozen/current-head all-pages summary and from pass rate. Unsupported scope or head disagreement is unavailable, not zero.",
  "CI progress counts ingested result observations, including unmatched/parameterized rows; no planned CI denominator, work-left or coverage is inferred.",
  "No procedure bodies, notes, observations, errors, source content, media or complete histories are materialized. This read does not certify execution, original historical tenancy, qualified approval or readiness.",
  "The explicit page limit is at most21 rows plus one admitted lookahead. Metadata is at most128KiB; all planned/status identity projections at most16MiB; planned identities at most1000/1MiB per manual run; grouped outcomes at most100000. Oversized frozen step context is not substituted with live case data.",
];
async function access(
  tx: Prisma.TransactionClient,
  userId: string,
  input: z.infer<typeof runHistoryAccessInput>,
  authorized: CaseFieldReadAuthorization,
) {
  const scope = await lockCaseFieldReadScope(tx, userId, input, authorized);
  if (
    input.expectedNativeActorId !== undefined &&
    input.expectedNativeActorId !== scope.actorId
  )
    throw foreign();
  return scope;
}
export async function readRunHistoryAccess(
  db: PrismaClient,
  userId: string,
  raw: z.input<typeof runHistoryAccessInput>,
  authorized: CaseFieldReadAuthorization,
) {
  const input = runHistoryAccessInput.parse(raw);
  return db.$transaction(
    async (tx) =>
      runHistoryAccessOutput.parse({
        readContext: {
          requestId: input.requestId,
          requestedKey: runHistoryReadKey(input),
          projection: "ACCESS",
          scope: await access(tx, userId, input, authorized),
          asOf: new Date().toISOString(),
        },
      }),
    options,
  );
}
function selected(input: RunHistoryPage) {
  return Prisma.sql`SELECT r.id FROM "TestRun" r WHERE r."projectId"=${input.projectId} AND r."startedAt"<=${new Date(input.asOf)} ${input.before ? Prisma.sql`AND (r."startedAt"<${new Date(input.before.startedAt)} OR (r."startedAt"=${new Date(input.before.startedAt)} AND r.id COLLATE "C"<${input.before.id} COLLATE "C"))` : Prisma.empty} ORDER BY r."startedAt" DESC,r.id COLLATE "C" DESC LIMIT ${input.limit + 1}`;
}
function supportedPlanned() {
  // CASE admits cardinality before array-to-text/unnest work; PostgreSQL may
  // reorder boolean AND terms, so they are not an allocation boundary.
  const admitted = Prisma.sql`CASE WHEN cardinality(r."manualTestCaseIds") BETWEEN 0 AND 1000 THEN CASE WHEN coalesce(octet_length(r."manualTestCaseIds"::text),0)<=1048576 THEN r."manualTestCaseIds" ELSE ARRAY[]::text[] END ELSE ARRAY[]::text[] END`;
  return Prisma.sql`CASE WHEN cardinality(r."manualTestCaseIds") BETWEEN 0 AND 1000 THEN coalesce(octet_length(r."manualTestCaseIds"::text),0)<=1048576 AND NOT EXISTS(SELECT 1 FROM unnest(${admitted}) p(id) WHERE length(p.id) NOT BETWEEN 1 AND 200 OR octet_length(p.id)>800) AND cardinality(r."manualTestCaseIds")=(SELECT count(DISTINCT p.id) FROM unnest(${admitted}) p(id)) ELSE false END`;
}
/** Native relationships first, then scalar width/count admission, then bounded
 * identity/status projection. No old list helper supplies authorization, and no procedure/evidence body enters JavaScript. */
export async function readRunHistoryPage(
  db: PrismaClient,
  userId: string,
  raw: z.input<typeof runHistoryPageInput>,
  authorized: CaseFieldReadAuthorization,
) {
  const input = runHistoryPageInput.parse(raw);
  return db.$transaction(async (tx) => {
    const scope = await access(tx, userId, input, authorized),
      runs = selected(input),
      planned = supportedPlanned();
    if (input.before) {
      const [cursor] = await tx.$queryRaw<
        Array<{ present: boolean }>
      >`SELECT EXISTS(SELECT 1 FROM "TestRun" WHERE id=${input.before.id} AND "projectId"=${input.projectId} AND "startedAt"=${new Date(input.before.startedAt)} AND "startedAt"<=${new Date(input.asOf)}) AS present`;
      if (cursor?.present !== true)
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "The current cursor no longer belongs to this exact project/time anchor. Return to the first page; no foreign cursor was followed.",
        });
    }
    const [relationships] = await tx.$queryRaw<
      Array<{ foreign: boolean }>
    >(Prisma.sql`WITH selected AS (${runs}) SELECT (
   EXISTS(SELECT 1 FROM "TestResult" e JOIN selected r ON r.id=e."testRunId" JOIN "TestCase" c ON c.id=e."testCaseId" WHERE c."projectId"<>${input.projectId})
   OR EXISTS(SELECT 1 FROM selected s JOIN "TestRun" r ON r.id=s.id CROSS JOIN LATERAL unnest(CASE WHEN r."ciProvider"='manual' AND ${planned} THEN r."manualTestCaseIds" ELSE ARRAY[]::text[] END) p(id) JOIN "TestCase" c ON c.id=p.id WHERE c."projectId"<>${input.projectId})
   OR EXISTS(SELECT 1 FROM "ManualCaseResultHead" h JOIN selected r ON r.id=h."testRunId" LEFT JOIN "ManualCaseResultRevision" v ON v.id=h."currentRevisionId" LEFT JOIN "TestRun" vr ON vr.id=v."testRunId" LEFT JOIN "TestCase" hc ON hc.id=h."testCaseId" LEFT JOIN "TestCase" vc ON vc.id=v."testCaseId" LEFT JOIN "TestResult" e ON e.id=h."testResultId" LEFT JOIN "TestRun" er ON er.id=e."testRunId" LEFT JOIN "TestCase" ec ON ec.id=e."testCaseId" LEFT JOIN "TestResult" ve ON ve.id=v."testResultId" LEFT JOIN "TestRun" ver ON ver.id=ve."testRunId" LEFT JOIN "TestCase" vec ON vec.id=ve."testCaseId" WHERE h."organizationId"<>${scope.organizationId} OR h."projectId"<>${input.projectId} OR v."organizationId"<>${scope.organizationId} OR v."projectId"<>${input.projectId} OR hc."projectId"<>${input.projectId} OR vc."projectId"<>${input.projectId} OR vr."projectId"<>${input.projectId} OR er."projectId"<>${input.projectId} OR ec."projectId"<>${input.projectId} OR ver."projectId"<>${input.projectId} OR vec."projectId"<>${input.projectId})
   OR EXISTS(SELECT 1 FROM "ManualStepResultHead" h JOIN selected r ON r.id=h."testRunId" LEFT JOIN "ManualStepResultRevision" v ON v.id=h."currentRevisionId" LEFT JOIN "TestRun" vr ON vr.id=v."testRunId" LEFT JOIN "TestCase" hc ON hc.id=h."testCaseId" LEFT JOIN "TestCase" vc ON vc.id=v."testCaseId" WHERE hc."projectId"<>${input.projectId} OR vc."projectId"<>${input.projectId} OR vr."projectId"<>${input.projectId})) AS foreign`);
    if (!relationships || relationships.foreign !== false) throw foreign();
    const [admission] = await tx.$queryRaw<
      Array<{
        runs: bigint;
        metadataBytes: bigint;
        projectionBytes: bigint;
        groups: bigint;
        results: bigint;
        heads: bigint;
        timeSupported: boolean;
        invalid: boolean;
      }>
    >(Prisma.sql`WITH selected AS (${runs}),groups AS (SELECT e."testRunId",CASE WHEN r."ciProvider"='manual' THEN e."testCaseId" ELSE NULL END AS "caseId",e.status,count(*)::bigint AS count FROM "TestResult" e JOIN selected s ON s.id=e."testRunId" JOIN "TestRun" r ON r.id=s.id GROUP BY e."testRunId",CASE WHEN r."ciProvider"='manual' THEN e."testCaseId" ELSE NULL END,e.status)
   SELECT count(*)::bigint AS runs,coalesce(sum((octet_length(r.id)::bigint+octet_length(r."ciProvider")+coalesce(octet_length(r."ciRunUrl"),0)+octet_length(r."commitSha")+octet_length(r.branch)+octet_length(r.status::text)+octet_length(r."startedAt"::text)+coalesce(octet_length(r."finishedAt"::text),0)+coalesce(octet_length(u.email),0))+1024),0)::bigint AS "metadataBytes",
   (coalesce(sum(CASE WHEN r."ciProvider"='manual' AND ${planned} THEN octet_length(r."manualTestCaseIds"::text)::bigint ELSE 0 END),0)+coalesce((SELECT sum((octet_length(g."testRunId")::bigint+coalesce(octet_length(g."caseId"),0)+octet_length(g.status::text)+octet_length(g.count::text))+128) FROM groups g),0))::bigint AS "projectionBytes",(SELECT count(*)::bigint FROM groups) AS groups,
   coalesce(bool_and(isfinite(r."startedAt") AND extract(year FROM r."startedAt") BETWEEN 1 AND 9999 AND r."startedAt" IS NOT DISTINCT FROM date_trunc('milliseconds',r."startedAt") AND (r."finishedAt" IS NULL OR (isfinite(r."finishedAt") AND extract(year FROM r."finishedAt") BETWEEN 1 AND 9999 AND r."finishedAt" IS NOT DISTINCT FROM date_trunc('milliseconds',r."finishedAt")))),true) AS "timeSupported",(SELECT coalesce(sum(g.count),0)::bigint FROM groups g) AS results,((SELECT count(*)::bigint FROM "ManualCaseResultHead" h JOIN selected r ON r.id=h."testRunId")+(SELECT count(*)::bigint FROM "ManualStepResultHead" h JOIN selected r ON r.id=h."testRunId")) AS heads,
   (coalesce(bool_or(length(r.id) NOT BETWEEN 1 AND 200 OR octet_length(r.id)>800 OR length(r."ciProvider")>256 OR length(r."ciRunUrl")>4096 OR length(r."commitSha")>1024 OR length(r.branch)>1024 OR length(r.status::text)>200 OR length(u.email)>320),false) OR EXISTS(SELECT 1 FROM groups g WHERE length(g."caseId") NOT BETWEEN 1 AND 200 OR octet_length(g."caseId")>800 OR length(g.status::text)>200)) AS invalid FROM selected s JOIN "TestRun" r ON r.id=s.id LEFT JOIN "User" u ON u.id=r."startedById"`);
    if (
      !admission ||
      ![
        admission.runs,
        admission.metadataBytes,
        admission.projectionBytes,
        admission.groups,
        admission.results,
        admission.heads,
      ].every(nonnegative) ||
      admission.runs > BigInt(input.limit + 1) ||
      admission.metadataBytes > 131072n ||
      admission.projectionBytes + admission.metadataBytes > 16777216n ||
      admission.groups > 100000n ||
      admission.results > 100000n ||
      admission.heads > 100000n ||
      admission.timeSupported !== true ||
      admission.invalid !== false
    )
      throw unsupported();
    // Metadata flags do not export any retained note/observation/definition body.
    const rows = await tx.$queryRaw<
      Array<
        Record<string, unknown> & {
          id: string;
          ciProvider: string;
          plannedIds: unknown;
          scopeSupported: boolean;
          headMismatch: boolean;
          resultCount: bigint;
          startedAt: Date;
          finishedAt: Date | null;
        }
      >
    >(Prisma.sql`WITH selected AS (${runs}) SELECT r.id,r."ciProvider",r."ciRunUrl",r."commitSha",r.branch,r.status::text AS status,r."startedAt",r."finishedAt",u.email AS "startedByEmail",(SELECT count(*)::bigint FROM "TestResult" e WHERE e."testRunId"=r.id) AS "resultCount",
   (${planned} AND NOT EXISTS(SELECT 1 FROM unnest(CASE WHEN ${planned} THEN r."manualTestCaseIds" ELSE ARRAY[]::text[] END) p(id) LEFT JOIN "TestCase" c ON c.id=p.id AND c."projectId"=${input.projectId} WHERE c.id IS NULL)) AS "scopeSupported",CASE WHEN r."ciProvider"='manual' AND ${planned} THEN r."manualTestCaseIds" ELSE NULL END AS "plannedIds",
   (EXISTS(SELECT 1 FROM "TestResult" e WHERE e."testRunId"=r.id AND e."testCaseId"=ANY(r."manualTestCaseIds") GROUP BY e."testCaseId" HAVING count(*)>1)
   OR EXISTS(SELECT 1 FROM "ManualCaseResultHead" h LEFT JOIN "ManualCaseResultRevision" v ON v.id=h."currentRevisionId" LEFT JOIN "TestResult" e ON e.id=h."testResultId" WHERE h."testRunId"=r.id AND (v.id IS NULL OR e.id IS NULL OR h."revisionCount" NOT BETWEEN 1 AND 100 OR v."revisionNumber"<>h."revisionCount" OR v."testRunId"<>h."testRunId" OR v."testCaseId"<>h."testCaseId" OR v."testResultId"<>h."testResultId" OR e."testRunId"<>h."testRunId" OR e."testCaseId" IS DISTINCT FROM h."testCaseId" OR e.status<>v.status OR NOT(h."testCaseId"=ANY(r."manualTestCaseIds")) OR EXISTS(SELECT 1 FROM "ManualStepResultHead" s WHERE s."testRunId"=h."testRunId" AND s."testCaseId"=h."testCaseId")))
   OR EXISTS(SELECT 1 FROM "ManualStepResultHead" h LEFT JOIN "ManualStepResultRevision" v ON v.id=h."currentRevisionId" WHERE h."testRunId"=r.id AND (v.id IS NULL OR h."revisionCount" NOT BETWEEN 1 AND 100 OR v."revisionNumber"<>h."revisionCount" OR v."testRunId"<>h."testRunId" OR v."testCaseId"<>h."testCaseId" OR v."stepIndex"<>h."stepIndex" OR h."stepIndex"<0 OR NOT(h."testCaseId"=ANY(r."manualTestCaseIds")) OR v.status::text NOT IN ('PASS','FAIL','BLOCKED','SKIP')))
   OR EXISTS(SELECT 1 FROM (SELECT h."testCaseId",count(*)::int AS count,min(h."stepIndex") AS first,max(h."stepIndex") AS last,CASE WHEN bool_or(v.status='FAIL') THEN 'FAIL' WHEN bool_or(v.status='BLOCKED') THEN 'BLOCKED' WHEN bool_or(v.status='SKIP') THEN 'SKIP' ELSE 'PASS' END AS status FROM "ManualStepResultHead" h LEFT JOIN "ManualStepResultRevision" v ON v.id=h."currentRevisionId" WHERE h."testRunId"=r.id GROUP BY h."testCaseId") heads LEFT JOIN LATERAL (SELECT count(*)::int AS matches,max(CASE WHEN jsonb_typeof(d->'steps')='array' THEN jsonb_array_length(d->'steps') ELSE 0 END) AS steps FROM jsonb_array_elements(CASE WHEN coalesce(octet_length(r."executionContext"::text),0)<=4194304 AND r."executionContext"->>'version'='1' AND jsonb_typeof(r."executionContext"->'caseDefinitions')='array' AND jsonb_array_length(CASE WHEN jsonb_typeof(r."executionContext"->'caseDefinitions')='array' THEN r."executionContext"->'caseDefinitions' ELSE '[]'::jsonb END)<=1000 THEN r."executionContext"->'caseDefinitions' ELSE '[]'::jsonb END) d WHERE d->>'testCaseId'=heads."testCaseId") definition ON true LEFT JOIN "TestResult" e ON e."testRunId"=r.id AND e."testCaseId"=heads."testCaseId" WHERE definition.matches<>1 OR definition.steps NOT BETWEEN 1 AND 500 OR heads.first<0 OR heads.last>=definition.steps OR heads.count>definition.steps OR (heads.count=definition.steps AND (e.id IS NULL OR e.status::text<>heads.status)) OR (heads.count<definition.steps AND e.id IS NOT NULL))) AS "headMismatch"
   FROM selected s JOIN "TestRun" r ON r.id=s.id LEFT JOIN "User" u ON u.id=r."startedById" ORDER BY r."startedAt" DESC,r.id COLLATE "C" DESC`);
    if (
      rows.length !== Number(admission.runs) ||
      new Set(rows.map((row) => row.id)).size !== rows.length
    )
      throw unsupported();
    // The native precision gate above must pass before these JS Dates exist.
    // Byte comparison mirrors PostgreSQL C collation, including Unicode IDs.
    rows.forEach((row, index) => {
      const previous = rows[index - 1];
      if (
        !supportedManualExecutionIdentity(row.id) ||
        !(row.startedAt instanceof Date) ||
        !Number.isFinite(row.startedAt.getTime()) ||
        row.startedAt.getUTCFullYear() < 1 ||
        row.startedAt.getUTCFullYear() > 9999 ||
        (row.finishedAt !== null &&
          (!(row.finishedAt instanceof Date) ||
            !Number.isFinite(row.finishedAt.getTime()) ||
            row.finishedAt.getUTCFullYear() < 1 ||
            row.finishedAt.getUTCFullYear() > 9999)) ||
        row.startedAt.toISOString() > input.asOf ||
        (input.before &&
          (row.startedAt.toISOString() > input.before.startedAt ||
            (row.startedAt.toISOString() === input.before.startedAt &&
              Buffer.compare(
                Buffer.from(row.id, "utf8"),
                Buffer.from(input.before.id, "utf8"),
              ) >= 0))) ||
        (previous &&
          (row.startedAt > previous.startedAt ||
            (row.startedAt.getTime() === previous.startedAt.getTime() &&
              Buffer.compare(
                Buffer.from(row.id, "utf8"),
                Buffer.from(previous.id, "utf8"),
              ) >= 0)))
      )
        throw unsupported();
    });
    const groups = await tx.$queryRaw<
      Array<{
        testRunId: string;
        testCaseId: string | null;
        status: string;
        count: bigint;
      }>
    >(
      Prisma.sql`WITH selected AS (${runs}) SELECT e."testRunId",CASE WHEN r."ciProvider"='manual' THEN e."testCaseId" ELSE NULL END AS "testCaseId",e.status::text AS status,count(*)::bigint AS count FROM "TestResult" e JOIN selected s ON s.id=e."testRunId" JOIN "TestRun" r ON r.id=s.id GROUP BY e."testRunId",CASE WHEN r."ciProvider"='manual' THEN e."testCaseId" ELSE NULL END,e.status ORDER BY e."testRunId",CASE WHEN r."ciProvider"='manual' THEN e."testCaseId" ELSE NULL END,e.status`,
    );
    if (
      groups.length !== Number(admission.groups) ||
      groups.some(
        (group) =>
          !nonnegative(group.count) ||
          group.count < 1n ||
          group.count > 100000n ||
          !rows.some((row) => row.id === group.testRunId),
      ) ||
      groups.reduce((sum, group) => sum + group.count, 0n) !== admission.results
    )
      throw unsupported();
    const projected = rows.map((row) => {
      if (
        !nonnegative(row.resultCount) ||
        row.resultCount > 100000n ||
        typeof row.scopeSupported !== "boolean" ||
        typeof row.headMismatch !== "boolean" ||
        !(row.startedAt instanceof Date) ||
        !Number.isFinite(row.startedAt.getTime()) ||
        (row.finishedAt !== null &&
          (!(row.finishedAt instanceof Date) ||
            !Number.isFinite(row.finishedAt.getTime()))) ||
        row.startedAt.toISOString() > input.asOf
      )
        throw unsupported();
      const manual = row.ciProvider === "manual",
        ids =
          manual && row.scopeSupported && Array.isArray(row.plannedIds)
            ? row.plannedIds
            : [];
      if (ids.some((id) => typeof id !== "string") || ids.length > 1000)
        throw unsupported();
      const outcomes: GroupedRunOutcome[] = groups
        .filter((group) => group.testRunId === row.id)
        .map((group) => ({
          testCaseId: group.testCaseId,
          status: group.status,
          count: Number(group.count),
        }));
      if (
        outcomes.reduce((sum, group) => sum + group.count, 0) !==
        Number(row.resultCount)
      )
        throw unsupported();
      const progress =
        manual &&
        (!row.scopeSupported ||
          row.headMismatch ||
          !Array.isArray(row.plannedIds) ||
          new Set(ids).size !== ids.length ||
          ids.some((id) => !supportedManualExecutionIdentity(id)))
          ? null
          : runProgress(row.ciProvider, ids, outcomes);
      const {
        plannedIds: _plannedIds,
        scopeSupported: _scopeSupported,
        headMismatch: _headMismatch,
        ...metadata
      } = row;
      try {
        return runHistoryRow.parse({
          ...metadata,
          startedAt: row.startedAt.toISOString(),
          finishedAt: row.finishedAt?.toISOString() ?? null,
          resultCount: Number(row.resultCount),
          progress,
          progressUnavailableReason: progress
            ? null
            : "The saved planned identities or current native head/result projection are unsupported or inconsistent. No partial or zero progress was inferred.",
          progressBasis: manual
            ? "PLANNED_IDENTITIES_CURRENT_RESULTS"
            : "CI_INGESTED_RESULTS",
        });
      } catch {
        throw unsupported();
      }
    });
    const hasMore = projected.length > input.limit,
      visible = projected.slice(0, input.limit),
      last = visible.at(-1);
    return runHistoryPageOutput.parse({
      readContext: {
        requestId: input.requestId,
        requestedKey: runHistoryReadKey(input),
        projection: "PAGE",
        scope,
        asOf: input.asOf,
      },
      rows: visible,
      hasMore,
      nextBefore:
        hasMore && last ? { id: last.id, startedAt: last.startedAt } : null,
      limit: input.limit,
      limitations,
    });
  }, options);
}
