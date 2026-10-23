import { Prisma, type PrismaClient } from "@vaettir/db";
import { TRPCError } from "@trpc/server";
import {
  lockCaseFieldReadScope,
  type CaseFieldReadAuthorization,
} from "./caseFieldReadScope.js";
import {
  ciRunDetailAccessInput,
  ciRunDetailAccessOutput,
  ciRunDetailPageInput,
  ciRunDetailPageOutput,
  ciRunDetailReadKey,
  ciRunDetailCompareId,
  type CiRunDetailAccessInput,
  type CiRunDetailPageInput,
} from "./ciRunDetailReadSchema.js";
const options = {
  isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
  timeout: 10000,
  maxWait: 5000,
};
const unsupported = () =>
  new TRPCError({
    code: "PRECONDITION_FAILED",
    message:
      "This complete CI result page exceeds its supported identity, metadata, text or timestamp bounds. Reduce the page size where possible; nothing was clipped, repaired or treated as zero.",
  });
const foreign = () =>
  new TRPCError({
    code: "FORBIDDEN",
    message:
      "Retained CI result references point outside the original project or are missing. No private result metadata, bodies or counts were returned.",
  });
const limitations = [
  "Current raw ingested result rows are ordered by UTF-8/C result ID, not execution time. The admitted ID upper bound is not a globally frozen cohort; links and stored result fields can change across pages.",
  "Counts cover only the current admitted ID window in this native transaction, not planned CI coverage, unique test-case completion, reconciled verdict heads, immutable histories or readiness.",
  "Linked case/source labels are current metadata, not a frozen execution definition. Captured external IDs/paths are separate stored result fields; no source, mapping or case was changed.",
  "Artifact references are metadata only, not file availability, retrieval, version verification or immutable evidence. No storage/CI URL, source file, procedure, observations JSON, full history or healing/classification body is read.",
  "Current page at most50 rows plus ID-only lookahead; whole ID window at most100000 rows/16MiB projected identities; header128KiB; each note/error128KiB; page at most200 artifact metadata references; complete combined projected page512KiB. Oversize or unsupported data refuses the whole page, never a clipped or normalized partial result.",
];
const nonnegative = (value: unknown): value is bigint =>
  typeof value === "bigint" && value >= 0n;
function number(value: unknown, max = 100000) {
  if (!nonnegative(value) || value > BigInt(max)) throw unsupported();
  return Number(value);
}
function iso(value: unknown) {
  if (
    !(value instanceof Date) ||
    !Number.isFinite(value.getTime()) ||
    value.getUTCFullYear() < 1 ||
    value.getUTCFullYear() > 9999
  )
    throw unsupported();
  return value.toISOString();
}
function windowClause(input: CiRunDetailPageInput) {
  return input.throughResultId === null
    ? Prisma.sql`FALSE`
    : Prisma.sql`r.id COLLATE "C" <= ${input.throughResultId} COLLATE "C"`;
}
function requireIndependentAuthorization(
  authorized: CaseFieldReadAuthorization,
) {
  // This reader is not a legacy helper caller: independently verified JWT
  // authority is mandatory even if a direct runtime caller omits its argument.
  if (
    !authorized ||
    typeof authorized.clerkActorId !== "string" ||
    authorized.clerkActorId.length === 0
  )
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Independent current Clerk authorization is required.",
    });
}
async function scopeAndRun(
  tx: Prisma.TransactionClient,
  userId: string,
  input: CiRunDetailAccessInput,
  authorized: CaseFieldReadAuthorization,
) {
  const scope = await lockCaseFieldReadScope(tx, userId, input, authorized);
  if (
    input.expectedNativeActorId !== undefined &&
    input.expectedNativeActorId !== scope.actorId
  )
    throw foreign();
  const [run] = await tx.$queryRaw<
    Array<{ id: string; projectId: string; manual: boolean }>
  >(
    Prisma.sql`/* CI_DETAIL_RUN_SCOPE */ SELECT id,"projectId",("ciProvider"='manual') AS manual FROM "TestRun" WHERE id=${input.testRunId} AND "projectId"=${input.projectId} FOR SHARE`,
  );
  if (!run || run.id !== input.testRunId || run.projectId !== input.projectId)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Run not found in this original project.",
    });
  if (run.manual === true)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Use the separately reviewed saved manual-execution workflow for this run. No CI planned scope was inferred.",
    });
  if (run.manual !== false) throw unsupported();
  return { ...scope, testRunId: input.testRunId };
}
async function cohort(
  tx: Prisma.TransactionClient,
  input: CiRunDetailAccessInput,
  window: Prisma.Sql,
) {
  const [admission] = await tx.$queryRaw<
    Array<{
      count: bigint;
      identityBytes: bigint;
      invalid: boolean;
      foreign: boolean;
      incoherent: boolean;
    }>
  >(Prisma.sql`/* CI_DETAIL_COHORT_ADMISSION */
 SELECT COUNT(*)::bigint AS count,COALESCE(SUM(octet_length(r.id)::bigint+octet_length(r."testRunId")::bigint+COALESCE(octet_length(r."testCaseId"),0)::bigint),0)::bigint AS "identityBytes",
 COALESCE(bool_or(length(r.id) NOT BETWEEN 1 AND 200 OR octet_length(r.id)>800 OR r."testCaseId" IS NOT NULL AND (length(r."testCaseId") NOT BETWEEN 1 AND 200 OR octet_length(r."testCaseId")>800)),false) AS invalid,
 COALESCE(bool_or(actual_run.id IS NULL OR actual_run."projectId"<>${input.projectId} OR r."testCaseId" IS NOT NULL AND (c.id IS NULL OR c."projectId"<>${input.projectId}) OR EXISTS(SELECT 1 FROM "HealingSuggestion" h LEFT JOIN "TestCase" hc ON hc.id=h."testCaseId" LEFT JOIN "Project" hp ON hp.id=h."projectId" WHERE h."testResultId"=r.id AND (hp.id IS NULL OR h."projectId"<>${input.projectId} OR hc.id IS NULL OR hc."projectId"<>${input.projectId}))),false) AS foreign,
 COALESCE(bool_or(EXISTS(SELECT 1 FROM "HealingSuggestion" h WHERE h."testResultId"=r.id AND h."testCaseId" IS DISTINCT FROM r."testCaseId")),false) AS incoherent
 FROM "TestResult" r LEFT JOIN "TestRun" actual_run ON actual_run.id=r."testRunId" LEFT JOIN "TestCase" c ON c.id=r."testCaseId"
 WHERE r."testRunId"=${input.testRunId} AND ${window}`);
  if (
    !admission ||
    typeof admission.foreign !== "boolean" ||
    typeof admission.invalid !== "boolean" ||
    typeof admission.incoherent !== "boolean"
  )
    throw unsupported();
  if (admission.foreign) throw foreign();
  if (
    admission.invalid ||
    admission.incoherent ||
    !nonnegative(admission.identityBytes) ||
    admission.identityBytes > 16777216n
  )
    throw unsupported();
  return number(admission.count);
}
export async function readCiRunDetailAccess(
  db: PrismaClient,
  userId: string,
  raw: CiRunDetailAccessInput,
  authorized: CaseFieldReadAuthorization,
) {
  requireIndependentAuthorization(authorized);
  const input = ciRunDetailAccessInput.parse(raw);
  return db.$transaction(async (tx) => {
    const scope = await scopeAndRun(tx, userId, input, authorized),
      count = await cohort(tx, input, Prisma.sql`TRUE`);
    const [anchor] = await tx.$queryRaw<Array<{ id: string | null }>>(
      Prisma.sql`/* CI_DETAIL_ANCHOR */ SELECT MAX(id COLLATE "C") AS id FROM "TestResult" WHERE "testRunId"=${input.testRunId}`,
    );
    const parsed = ciRunDetailAccessOutput.safeParse({
      readContext: {
        requestId: input.requestId,
        requestedKey: ciRunDetailReadKey(input),
        projection: "ACCESS",
        scope,
      },
      throughResultId: anchor?.id,
      limitations,
    });
    if (
      !parsed.success ||
      (count === 0 && parsed.data.throughResultId !== null) ||
      (count > 0 && parsed.data.throughResultId === null)
    )
      throw unsupported();
    return parsed.data;
  }, options);
}
type FlatResult = {
  id: string;
  testRunId: string;
  testCaseId: string | null;
  externalTestId: string | null;
  externalFilePath: string | null;
  status: string;
  durationMs: number | null;
  errorMessage: string | null;
  note: string | null;
  caseId: string | null;
  caseDisplayId: string | null;
  caseTitle: string | null;
  caseArchived: boolean | null;
  caseReviewStatus: string | null;
  sourceId: string | null;
  sourceFilePath: string | null;
  sourceFunctionName: string | null;
  sourceFramework: string | null;
  sourceFrameworkFamily: string | null;
  sourceExternalTestId: string | null;
  sourceLastCommit: string | null;
  sourceLastAt: Date | null;
};
export async function readCiRunDetailPage(
  db: PrismaClient,
  userId: string,
  raw: CiRunDetailPageInput,
  authorized: CaseFieldReadAuthorization,
) {
  requireIndependentAuthorization(authorized);
  const input = ciRunDetailPageInput.parse(raw);
  return db.$transaction(async (tx) => {
    const scope = await scopeAndRun(tx, userId, input, authorized),
      window = windowClause(input);
    // Before any private header/count/body projection. Inputs are filters, not
    // transferable receipt authority. An absent anchored row requires refresh.
    if (input.throughResultId !== null) {
      const [anchors] = await tx.$queryRaw<Array<{ present: boolean }>>(
        Prisma.sql`/* CI_DETAIL_WINDOW */ SELECT EXISTS(SELECT 1 FROM "TestResult" WHERE id=${input.throughResultId} AND "testRunId"=${input.testRunId}) AND (${input.afterId ?? null}::text IS NULL OR EXISTS(SELECT 1 FROM "TestResult" WHERE id=${input.afterId ?? null} AND "testRunId"=${input.testRunId})) AS present`,
      );
      if (anchors?.present !== true)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "The current anchored result/cursor is unavailable. Explicitly refresh; no replacement window was inferred.",
        });
    }
    const count = await cohort(tx, input, window);
    const candidates = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`/* CI_DETAIL_CANDIDATES */ SELECT r.id FROM "TestResult" r WHERE r."testRunId"=${input.testRunId} AND ${window} ${input.afterId === undefined ? Prisma.empty : Prisma.sql`AND r.id COLLATE "C" > ${input.afterId} COLLATE "C"`} ORDER BY r.id COLLATE "C" ASC LIMIT ${input.limit + 1} FOR SHARE`,
    );
    if (
      candidates.length > input.limit + 1 ||
      new Set(candidates.map((row) => row.id)).size !== candidates.length ||
      candidates.some(
        (row, index) =>
          !supportedId(row.id) ||
          input.throughResultId === null ||
          ciRunDetailCompareId(row.id, input.throughResultId) > 0 ||
          (input.afterId !== undefined &&
            ciRunDetailCompareId(row.id, input.afterId) <= 0) ||
          (index > 0 &&
            ciRunDetailCompareId(candidates[index - 1]!.id, row.id) >= 0),
      )
    )
      throw unsupported();
    const selected = candidates.slice(0, input.limit).map((row) => row.id),
      hasMore = candidates.length > input.limit;
    if (selected.length) {
      await tx.$queryRaw(
        Prisma.sql`/* CI_DETAIL_CASE_SOURCE_LOCKS */ SELECT c.id FROM "TestCase" c WHERE c.id IN(SELECT r."testCaseId" FROM "TestResult" r WHERE r.id IN(${Prisma.join(selected)})) ORDER BY c.id COLLATE "C" FOR SHARE`,
      );
      await tx.$queryRaw(
        Prisma.sql`/* CI_DETAIL_SOURCE_LOCKS */ SELECT s.id FROM "TestCaseSource" s WHERE s."testCaseId" IN(SELECT r."testCaseId" FROM "TestResult" r WHERE r.id IN(${Prisma.join(selected)})) ORDER BY s.id COLLATE "C" FOR SHARE`,
      );
    }
    const selectedSQL = selected.length
      ? Prisma.sql`r.id IN(${Prisma.join(selected)})`
      : Prisma.sql`FALSE`;
    const [headerAdmission] = await tx.$queryRaw<
      Array<{ bytes: bigint; valid: boolean }>
    >(
      Prisma.sql`/* CI_DETAIL_HEADER_ADMISSION */ SELECT CASE WHEN octet_length("ciProvider")<=32768 AND octet_length(branch)<=32768 AND octet_length("commitSha")<=32768 THEN octet_length(jsonb_build_array(id,"projectId","ciProvider",branch,"commitSha",status,"startedAt","finishedAt")::text)::bigint+512 ELSE 524289::bigint END AS bytes, isfinite("startedAt") AND "startedAt"=date_trunc('milliseconds',"startedAt") AND EXTRACT(YEAR FROM "startedAt") BETWEEN 1 AND 9999 AND ("finishedAt" IS NULL OR isfinite("finishedAt") AND "finishedAt"=date_trunc('milliseconds',"finishedAt") AND EXTRACT(YEAR FROM "finishedAt") BETWEEN 1 AND 9999) AS valid FROM "TestRun" WHERE id=${input.testRunId} AND "projectId"=${input.projectId}`,
    );
    const [pageAdmission] = await tx.$queryRaw<
      Array<{ bytes: bigint; artifacts: bigint; valid: boolean }>
    >(Prisma.sql`/* CI_DETAIL_PAGE_ADMISSION */
   WITH projected AS(SELECT r.id,CASE WHEN COALESCE(octet_length(r.note),0)<=131072 AND COALESCE(octet_length(r."errorMessage"),0)<=131072 AND COALESCE(octet_length(r."externalTestId"),0)<=131072 AND COALESCE(octet_length(r."externalFilePath"),0)<=32768 AND COALESCE(octet_length(c.title),0)<=32768 AND COALESCE(octet_length(c."displayId"),0)<=800 AND COALESCE(octet_length(s.id),0)<=800 AND COALESCE(octet_length(s."filePath"),0)<=32768 AND COALESCE(octet_length(s."functionName"),0)<=32768 AND COALESCE(octet_length(s.framework),0)<=32768 AND COALESCE(octet_length(s."externalTestId"),0)<=131072 AND COALESCE(octet_length(s."lastSyncedCommitSha"),0)<=32768
   THEN octet_length(jsonb_build_array(r.id,r."testRunId",r."testCaseId",r."externalTestId",r."externalFilePath",r.status,r."durationMs",r."errorMessage",r.note,c.id,c."displayId",c.title,c.archived,c."reviewStatus",s.id,s."filePath",s."functionName",s.framework,s."frameworkFamily",s."externalTestId",s."lastSyncedCommitSha",s."lastSyncedAt")::text)::bigint+1024 ELSE 524289::bigint END AS bytes,
   COALESCE(octet_length(r.note),0)<=131072 AND COALESCE(octet_length(r."errorMessage"),0)<=131072 AND COALESCE(octet_length(r."externalTestId"),0)<=131072 AND COALESCE(octet_length(r."externalFilePath"),0)<=32768 AND COALESCE(octet_length(c.title),0)<=32768 AND COALESCE(octet_length(c."displayId"),0)<=800 AND COALESCE(octet_length(s.id),0)<=800 AND COALESCE(octet_length(s."filePath"),0)<=32768 AND COALESCE(octet_length(s."functionName"),0)<=32768 AND COALESCE(octet_length(s.framework),0)<=32768 AND COALESCE(octet_length(s."externalTestId"),0)<=131072 AND COALESCE(octet_length(s."lastSyncedCommitSha"),0)<=32768 AND (s."lastSyncedAt" IS NULL OR isfinite(s."lastSyncedAt") AND s."lastSyncedAt"=date_trunc('milliseconds',s."lastSyncedAt") AND EXTRACT(YEAR FROM s."lastSyncedAt") BETWEEN 1 AND 9999) AS valid
   FROM "TestResult" r LEFT JOIN "TestCase" c ON c.id=r."testCaseId" LEFT JOIN "TestCaseSource" s ON s."testCaseId"=c.id WHERE ${selectedSQL}), artifact_metadata AS(SELECT CASE WHEN length(a.id) BETWEEN 1 AND 200 AND octet_length(a.id)<=800 THEN octet_length(jsonb_build_array(a.id,a."testResultId",a.type,a."capturedAt",a."durationMs")::text)::bigint+128 ELSE 524289::bigint END AS bytes,isfinite(a."capturedAt") AND a."capturedAt"=date_trunc('milliseconds',a."capturedAt") AND EXTRACT(YEAR FROM a."capturedAt") BETWEEN 1 AND 9999 AND length(a.id) BETWEEN 1 AND 200 AND octet_length(a.id)<=800 AS valid FROM "TestResultArtifact" a JOIN "TestResult" r ON r.id=a."testResultId" WHERE ${selectedSQL})
   SELECT (COALESCE((SELECT SUM(bytes) FROM projected),0)+COALESCE((SELECT SUM(bytes) FROM artifact_metadata),0))::bigint AS bytes,(SELECT COUNT(*) FROM artifact_metadata)::bigint AS artifacts,COALESCE((SELECT bool_and(valid) FROM projected),true) AND COALESCE((SELECT bool_and(valid) FROM artifact_metadata),true) AS valid`);
    if (
      headerAdmission?.valid !== true ||
      pageAdmission?.valid !== true ||
      !nonnegative(headerAdmission.bytes) ||
      headerAdmission.bytes > 131072n ||
      !nonnegative(pageAdmission.bytes) ||
      !nonnegative(pageAdmission.artifacts) ||
      pageAdmission.artifacts > 200n ||
      headerAdmission.bytes + pageAdmission.bytes + 32768n > 524288n
    )
      throw unsupported();
    const [header] = await tx.$queryRaw<
      Array<{
        id: string;
        projectId: string;
        ciProvider: string;
        branch: string;
        commitSha: string;
        status: string;
        startedAt: Date;
        finishedAt: Date | null;
      }>
    >(
      Prisma.sql`/* CI_DETAIL_HEADER_BODY */ SELECT id,"projectId","ciProvider",branch,"commitSha",status::text AS status,"startedAt","finishedAt" FROM "TestRun" WHERE id=${input.testRunId} AND "projectId"=${input.projectId}`,
    );
    const flat = await tx.$queryRaw<FlatResult[]>(
      Prisma.sql`/* CI_DETAIL_RESULT_BODY */ SELECT r.id,r."testRunId",r."testCaseId",r."externalTestId",r."externalFilePath",r.status::text AS status,r."durationMs",r."errorMessage",r.note,c.id AS "caseId",c."displayId" AS "caseDisplayId",c.title AS "caseTitle",c.archived AS "caseArchived",c."reviewStatus"::text AS "caseReviewStatus",s.id AS "sourceId",s."filePath" AS "sourceFilePath",s."functionName" AS "sourceFunctionName",s.framework AS "sourceFramework",s."frameworkFamily"::text AS "sourceFrameworkFamily",s."externalTestId" AS "sourceExternalTestId",s."lastSyncedCommitSha" AS "sourceLastCommit",s."lastSyncedAt" AS "sourceLastAt" FROM "TestResult" r LEFT JOIN "TestCase" c ON c.id=r."testCaseId" LEFT JOIN "TestCaseSource" s ON s."testCaseId"=c.id WHERE ${selectedSQL} ORDER BY r.id COLLATE "C" ASC`,
    );
    const artifacts = await tx.$queryRaw<
      Array<{
        id: string;
        testResultId: string;
        type: string;
        capturedAt: Date;
        durationMs: number | null;
      }>
    >(
      Prisma.sql`/* CI_DETAIL_ARTIFACT_METADATA */ SELECT a.id,a."testResultId",a.type::text AS type,a."capturedAt",a."durationMs" FROM "TestResultArtifact" a JOIN "TestResult" r ON r.id=a."testResultId" WHERE ${selectedSQL} ORDER BY a.id COLLATE "C" ASC`,
    );
    if (
      !header ||
      flat.length !== selected.length ||
      flat.some(
        (row, index) =>
          row.id !== selected[index] ||
          row.testRunId !== input.testRunId ||
          (row.testCaseId !== null && row.caseId !== row.testCaseId),
      ) ||
      artifacts.length !== number(pageAdmission.artifacts, 200) ||
      artifacts.some((row) => !selected.includes(row.testResultId))
    )
      throw unsupported();
    const groups = await tx.$queryRaw<Array<{ status: string; count: bigint }>>(
      Prisma.sql`/* CI_DETAIL_RAW_STATUS_COUNTS */ SELECT r.status::text AS status,COUNT(*)::bigint AS count FROM "TestResult" r WHERE r."testRunId"=${input.testRunId} AND ${window} GROUP BY r.status`,
    );
    const summary = {
      total: count,
      pass: 0,
      fail: 0,
      skip: 0,
      flaky: 0,
      blocked: 0,
      other: 0,
    };
    for (const group of groups) {
      const key =
        group.status === "PASS"
          ? "pass"
          : group.status === "FAIL"
            ? "fail"
            : group.status === "SKIP"
              ? "skip"
              : group.status === "FLAKY"
                ? "flaky"
                : group.status === "BLOCKED"
                  ? "blocked"
                  : "other";
      summary[key] += number(group.count);
    }
    const rows = flat.map((row) => ({
      id: row.id,
      testRunId: row.testRunId,
      testCaseId: row.testCaseId,
      linkState: row.testCaseId === null ? "UNMATCHED" : "LINKED_CURRENT_CASE",
      linkedCase:
        row.testCaseId === null
          ? null
          : {
              id: row.caseId,
              displayId: row.caseDisplayId,
              title: row.caseTitle,
              archived: row.caseArchived,
              reviewStatus: row.caseReviewStatus,
              source:
                row.sourceId === null
                  ? null
                  : {
                      id: row.sourceId,
                      filePath: row.sourceFilePath,
                      functionName: row.sourceFunctionName,
                      framework: row.sourceFramework,
                      frameworkFamily: row.sourceFrameworkFamily,
                      externalTestId: row.sourceExternalTestId,
                      lastSyncedCommitSha: row.sourceLastCommit,
                      lastSyncedAt:
                        row.sourceLastAt === null
                          ? null
                          : iso(row.sourceLastAt),
                    },
              provenance:
                "CURRENT_CASE_METADATA_NOT_FROZEN_EXECUTION_DEFINITION",
            },
      externalTestId: row.externalTestId,
      externalFilePath: row.externalFilePath,
      status: row.status,
      durationMs: row.durationMs,
      errorMessage: row.errorMessage,
      note: row.note,
      artifacts: artifacts
        .filter((artifact) => artifact.testResultId === row.id)
        .map((artifact) => ({
          id: artifact.id,
          type: artifact.type,
          capturedAt: iso(artifact.capturedAt),
          durationMs: artifact.durationMs,
        })),
      bodyProvenance: "CURRENT_STORED_RESULT_NOT_IMMUTABLE_HISTORY",
    }));
    const parsed = ciRunDetailPageOutput.safeParse({
      readContext: {
        requestId: input.requestId,
        requestedKey: ciRunDetailReadKey(input),
        projection: "PAGE",
        scope,
      },
      header: {
        ...header,
        startedAt: iso(header.startedAt),
        finishedAt: header.finishedAt === null ? null : iso(header.finishedAt),
      },
      throughResultId: input.throughResultId,
      rows,
      summary,
      limit: input.limit,
      hasMore,
      nextAfterId: hasMore ? selected.at(-1)! : null,
      limitations,
    });
    if (
      !parsed.success ||
      Buffer.byteLength(JSON.stringify(parsed.data), "utf8") > 524288
    )
      throw unsupported();
    return parsed.data;
  }, options);
}
function supportedId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    ciRunDetailAccessInput.shape.testRunId.safeParse(value).success
  );
}
