import { Prisma } from "@vaettir/db";
import { TRPCError } from "@trpc/server";

export type CaseHistoryWholeCaseSummary = {
  revisionCount: number;
  correctionCount: number;
  lastRecorderName: string;
  lastRecordedAt: Date;
  lastStatus: "PASS" | "FAIL" | "BLOCKED" | "SKIP";
};
type Input = { projectId: string; testCaseId: string; originalOrganizationId: string; runIds: string[] };
const refuse = (message: string): never => { throw new TRPCError({ code: "PRECONDITION_FAILED", message }); };
const identity = (value: string) => typeof value === "string" && value.length > 0 && value.length <= 200;

/** Read-only metadata helper. Caller already holds fresh original-org/member/project
 * authorization in its bounded RepeatableRead transaction with statement timeout.
 * No independent authorization, body/source reads, backfill or new execution claim.
 */
export async function readCaseHistoryWholeCaseSummaries(
  tx: Prisma.TransactionClient,
  input: Input,
): Promise<Record<string, CaseHistoryWholeCaseSummary>> {
  if (![input.projectId, input.testCaseId, input.originalOrganizationId].every(identity) ||
    !Array.isArray(input.runIds) || input.runIds.length > 25 || !input.runIds.every(identity) || new Set(input.runIds).size !== input.runIds.length)
    return refuse("Whole-case history requires at most25 distinct bounded native run identities.");
  const [scope] = await tx.$queryRaw<Array<{ projectValid: boolean; caseValid: boolean; runCount: number }>>`
    SELECT EXISTS(SELECT 1 FROM "Project" WHERE id=${input.projectId} AND "organizationId"=${input.originalOrganizationId}) AS "projectValid",
      EXISTS(SELECT 1 FROM "TestCase" WHERE id=${input.testCaseId} AND "projectId"=${input.projectId}) AS "caseValid",
      (SELECT count(*)::int FROM "TestRun" WHERE "projectId"=${input.projectId} AND id=ANY(${input.runIds}::text[])) AS "runCount"`;
  if (!scope?.projectValid || !scope.caseValid || scope.runCount !== input.runIds.length)
    return refuse("The original project, case or selected native runs are unavailable. No foreign history was substituted.");
  if (!input.runIds.length) return {};
  // Metadata-only complete preflight. SQL compares native projection, but never
  // returns note/observations/legacy bodies or current private profile/source data.
  const [gate] = await tx.$queryRaw<Array<{ population: number; heads: number; bytes: bigint; invalid: boolean }>>(Prisma.sql`
    WITH selected AS (SELECT id,"ciProvider","manualTestCaseIds" FROM "TestRun" WHERE "projectId"=${input.projectId} AND id IN (${Prisma.join(input.runIds)})),
    bounded AS (
      SELECT run.id, h."currentRevisionId", r."actorLabel", r."recordedAt", r.status,
        (coalesce(octet_length(run.id),0)+coalesce(octet_length(h."currentRevisionId"),0)+coalesce(octet_length(r."actorLabel"),0))::bigint AS bytes,
        CASE WHEN h."currentRevisionId" IS NULL THEN history.count<>0 ELSE
          h."organizationId" IS DISTINCT FROM ${input.originalOrganizationId} OR h."projectId" IS DISTINCT FROM ${input.projectId}
          OR h."testCaseId" IS DISTINCT FROM ${input.testCaseId} OR run."ciProvider" IS DISTINCT FROM 'manual'
          OR (${input.testCaseId}=ANY(run."manualTestCaseIds")) IS DISTINCT FROM true OR cardinality(run."manualTestCaseIds")>500
          OR h."revisionCount" NOT BETWEEN 1 AND 100 OR h."currentPayloadBytes" NOT BETWEEN 2048 AND 262144
          OR r.id IS NULL OR native.id IS NULL OR r."organizationId" IS DISTINCT FROM h."organizationId"
          OR r."projectId" IS DISTINCT FROM h."projectId" OR r."testRunId" IS DISTINCT FROM run.id
          OR r."testCaseId" IS DISTINCT FROM h."testCaseId" OR r."testResultId" IS DISTINCT FROM h."testResultId"
          OR r."revisionNumber" IS DISTINCT FROM h."revisionCount" OR r."payloadBytes" IS DISTINCT FROM h."currentPayloadBytes"
          OR octet_length(concat(r.note,r.observations::text,r."legacyPrior"::text,r."actorLabel",r."correctionReason"))+2048>r."payloadBytes"
          OR native."testRunId" IS DISTINCT FROM run.id OR native."testCaseId" IS DISTINCT FROM h."testCaseId"
          OR (native.status,native.note,native.observations) IS DISTINCT FROM (r.status,r.note,r.observations)
          OR r.status::text NOT IN ('PASS','FAIL','BLOCKED','SKIP') OR r."recordedAt" IS NULL OR NOT isfinite(r."recordedAt")
          OR r."actorLabel" IS NULL OR length(r."actorLabel") NOT BETWEEN 1 AND 200 OR octet_length(r."actorLabel")>800
          OR length(r.id)>200 OR octet_length(r.id)>800
          OR history.invalid OR history.count<>h."revisionCount" OR history.min<>1 OR history.max<>h."revisionCount"
          OR (SELECT count(*) FROM "TestResult" WHERE "testRunId"=run.id AND "testCaseId"=${input.testCaseId})<>1
          OR EXISTS(SELECT 1 FROM "ManualStepResultHead" WHERE "testRunId"=run.id AND "testCaseId"=${input.testCaseId})
        END AS invalid
      FROM selected run
      LEFT JOIN "ManualCaseResultHead" h ON h."testRunId"=run.id AND h."testCaseId"=${input.testCaseId}
      LEFT JOIN "ManualCaseResultRevision" r ON r.id=h."currentRevisionId"
      LEFT JOIN "TestResult" native ON native.id=h."testResultId"
      LEFT JOIN LATERAL (SELECT count(*)::int AS count, min(q."revisionNumber") AS min,max(q."revisionNumber") AS max,
        coalesce(bool_or(q."organizationId" IS DISTINCT FROM ${input.originalOrganizationId} OR q."projectId" IS DISTINCT FROM ${input.projectId}
          OR q."testResultId" IS DISTINCT FROM h."testResultId" OR q."revisionNumber" NOT BETWEEN 1 AND 100
          OR q.status::text NOT IN ('PASS','FAIL','BLOCKED','SKIP')
          OR (q."legacyPrior" IS NOT NULL AND (
            q."revisionNumber"<>1 OR q."previousRevisionId" IS NOT NULL
            OR jsonb_typeof(q."legacyPrior") IS DISTINCT FROM 'object'
            OR q."legacyPrior"->>'basis' IS DISTINCT FROM 'UNVERSIONED_OBSERVATION_CAPTURED_NOW'
            OR q."legacyPrior"->'originalRecorder' IS DISTINCT FROM 'null'::jsonb
            OR q."legacyPrior"->'originalRecordedAt' IS DISTINCT FROM 'null'::jsonb
            OR jsonb_typeof(q."legacyPrior"->'captured') IS DISTINCT FROM 'object'
            OR q."legacyPrior"->'captured'->>'resultId' IS DISTINCT FROM q."testResultId"
            OR coalesce(q."legacyPrior"->'captured'->>'status','') NOT IN ('PASS','FAIL','BLOCKED','SKIP')
            OR CASE WHEN jsonb_typeof(q."legacyPrior")='object' THEN
              (q."legacyPrior" - ARRAY['basis','originalRecorder','originalRecordedAt','captured']) IS DISTINCT FROM '{}'::jsonb ELSE true END
            OR CASE WHEN jsonb_typeof(q."legacyPrior"->'captured')='object' THEN
              ((q."legacyPrior"->'captured') - ARRAY['resultId','status','note','observations']) IS DISTINCT FROM '{}'::jsonb ELSE true END
            OR NOT ((q."legacyPrior"->'captured') ?& ARRAY['resultId','status','note','observations'])
            OR coalesce(jsonb_typeof(q."legacyPrior"->'captured'->'note'),'missing') NOT IN ('string','null')
            OR jsonb_typeof(q."legacyPrior"->'captured'->'observations') IS DISTINCT FROM 'object'))
          OR (q."revisionNumber"=1 AND q."previousRevisionId" IS NOT NULL)
          OR (q."revisionNumber">1 AND NOT EXISTS(SELECT 1 FROM "ManualCaseResultRevision" prior WHERE prior.id=q."previousRevisionId"
            AND prior."testRunId"=q."testRunId" AND prior."testCaseId"=q."testCaseId" AND prior."organizationId"=q."organizationId"
            AND prior."projectId"=q."projectId" AND prior."testResultId"=q."testResultId" AND prior."revisionNumber"=q."revisionNumber"-1))),false) AS invalid
        FROM "ManualCaseResultRevision" q WHERE q."testRunId"=run.id AND q."testCaseId"=${input.testCaseId}) history ON true
    ) SELECT count(*)::int AS population,count("currentRevisionId")::int AS heads,
      coalesce(sum(bytes),0)::bigint AS bytes,coalesce(bool_or(invalid),false) AS invalid FROM bounded`);
  if (!gate || gate.population !== input.runIds.length || gate.heads < 0 || gate.heads > 25 || gate.invalid || gate.bytes < 0n || gate.bytes > 65536n)
    return refuse("The complete whole-case history metadata is ambiguous, unsupported or overbound. No zero/partial history was reported.");
  if (!gate.heads) return {};
  const rows = await tx.$queryRaw<Array<{ runId: string; revisionCount: number; correctionCount: number; lastRecorderName: string; lastRecordedAt: Date; lastStatus: string }>>(Prisma.sql`
    SELECT h."testRunId" AS "runId",h."revisionCount" AS "revisionCount",r."actorLabel" AS "lastRecorderName",
      r."recordedAt" AS "lastRecordedAt",r.status::text AS "lastStatus",
      (SELECT count(*)::int FROM "ManualCaseResultRevision" q WHERE q."testRunId"=h."testRunId" AND q."testCaseId"=h."testCaseId"
        AND q."organizationId"=h."organizationId" AND q."projectId"=h."projectId"
        AND (q."previousRevisionId" IS NOT NULL OR q."legacyPrior" IS NOT NULL)) AS "correctionCount"
    FROM "ManualCaseResultHead" h JOIN "ManualCaseResultRevision" r ON r.id=h."currentRevisionId"
    WHERE h."organizationId"=${input.originalOrganizationId} AND h."projectId"=${input.projectId}
      AND h."testCaseId"=${input.testCaseId} AND h."testRunId" IN (${Prisma.join(input.runIds)}) ORDER BY h."testRunId" ASC LIMIT 26`);
  if (rows.length !== gate.heads) return refuse("The complete verified history population changed. No partial projection was used.");
  const result: Record<string, CaseHistoryWholeCaseSummary> = Object.create(null);
  for (const row of rows) {
    if (!identity(row.runId) || !input.runIds.includes(row.runId) || Object.hasOwn(result,row.runId) ||
      !Number.isInteger(row.revisionCount) || row.revisionCount < 1 || row.revisionCount > 100 ||
      !Number.isInteger(row.correctionCount) || row.correctionCount < 0 || row.correctionCount > row.revisionCount ||
      !identity(row.lastRecorderName) || !(row.lastRecordedAt instanceof Date) || !Number.isFinite(row.lastRecordedAt.getTime()) ||
      !["PASS","FAIL","BLOCKED","SKIP"].includes(row.lastStatus)) return refuse("A verified whole-case summary exceeds its supported metadata contract. It was not truncated.");
    result[row.runId] = { revisionCount: row.revisionCount, correctionCount: row.correctionCount,
      lastRecorderName: row.lastRecorderName, lastRecordedAt: row.lastRecordedAt, lastStatus: row.lastStatus as CaseHistoryWholeCaseSummary["lastStatus"] };
  }
  if (Buffer.byteLength(JSON.stringify(result),"utf8")>65536) return refuse("The complete whole-case summary exceeds64KiB. No partial history was substituted.");
  return result;
}
