import { Prisma, type PrismaClient } from "@vaettir/db";
import { TRPCError } from "@trpc/server";
import { reportRunWhere } from "../routers/reportSnapshotScope.js";
import { recordedExecutionTrendInput, recordedExecutionTrendKey, type RecordedExecutionTrendInput } from "./recordedExecutionTrendSchema.js";
import { supportedManualExecutionIdentity as identity } from "./manualExecutionReadScopeSchema.js";
import { assembleManualRunDashboard, manualDashboardBudget, type DashboardScope, type DashboardResult, type DashboardCaseHead, type DashboardStepHead } from "./manualRunDashboardAssembly.js";
import { manualRunDashboardOutputSchema } from "./manualRunDashboardSchema.js";

const MiB = 1024n * 1024n;
const unavailable = (message = "Manual dashboard exceeds its bounded native scope. Narrow the window; no partial aggregate was returned.") => new TRPCError({ code: "PRECONDITION_FAILED", message });
const forbidden = () => new TRPCError({ code: "FORBIDDEN", message: "Current signed-in membership in the original organization and project is required. Foreign evidence was not counted." });
export const manualRunDashboardRequestKey = (input: RecordedExecutionTrendInput) => `manual-case-heads:${recordedExecutionTrendKey(input)}`;
export const manualRunDashboardLimitations = [
  "Planned, recorded and remaining count case instances within each trusted saved manual run. The same case in two runs counts twice; these are not raw result rows, revision events or globally distinct repository cases.",
  "Remaining means no trusted current whole-case verdict. It includes partially recorded structured procedures and does not prove that nobody attempted the case. Skip and Blocked count recorded, not passed; this is not release readiness or a defect-fix verdict.",
  "Legacy/unsupported frozen scopes, untracked legacy results, duplicate verdicts and head/projection disagreement exclude an entire run. Exclusion counts are explicit. Trusted totals are not completion for excluded runs or the whole project.",
  "Current whole-case revision heads and complete current structured-step heads must agree with the unique native result status. Notes, error text, procedure bodies, media and full history are not read, compared or certified by this status-only overview.",
  "Frozen scope inspection checks saved version-one planned identities and procedure shape, not complete procedure-field validation. No live case content or current profile substitutes for a saved scope.",
  "Days use stored run startedAt in UTC, not result-recorded times. This is a changing read-time aggregate, not an immutable approved report. Historical original tenant/session attribution is not inferred where native records do not store it.",
  "Bounds: at most 90 inclusive UTC days; 20,000 manual date-window run identities/4 MiB before optional filters; 1,000 planned identities/run; 100,000 planned instances, result rows, whole-case heads and step heads each; 16 MiB projected identity/status metadata; 4 MiB frozen JSON/run and 64 MiB/cohort, measured natively without loading those bodies.",
] as const;

/** Read-only source service mounted through the scoped trend router. Native SQL
 * execution/runtime acceptance remains separate from pure and mocked checks.
 * bounded stable snapshot. No database/provider calls are made at import time. */
export async function readManualRunDashboard(db: PrismaClient, actorId: string, clerkActorId: string, raw: RecordedExecutionTrendInput) {
  const input = recordedExecutionTrendInput.parse(raw);
  if (![actorId, clerkActorId, input.projectId, input.originalOrganizationId].every(identity)) throw forbidden();
  return db.$transaction(async tx => {
    const deadline = Date.now() + 18000;
    await tx.$executeRaw(Prisma.sql`SET LOCAL statement_timeout='8000ms'`);
    const [org] = await tx.$queryRaw<Array<{ suspendedAt: Date | null }>>`SELECT "suspendedAt" FROM "Organization" WHERE id=${input.originalOrganizationId} FOR SHARE`;
    const [member] = await tx.$queryRaw<Array<{ role: string; seatType: string }>>`SELECT role::text AS role,"seatType"::text AS "seatType" FROM "Membership" WHERE "organizationId"=${input.originalOrganizationId} AND "userId"=${actorId} FOR SHARE`;
    const [project] = await tx.$queryRaw<Array<{ organizationId: string | null }>>`SELECT CASE WHEN length("organizationId")<=200 AND octet_length("organizationId")<=800 THEN "organizationId" ELSE NULL END AS "organizationId" FROM "Project" WHERE id=${input.projectId} FOR SHARE`;
    const [user] = await tx.$queryRaw<Array<{ clerkUserId: string | null }>>`SELECT CASE WHEN length("clerkUserId")<=200 AND octet_length("clerkUserId")<=800 THEN "clerkUserId" ELSE NULL END AS "clerkUserId" FROM "User" WHERE id=${actorId} FOR SHARE`;
    if (!org || org.suspendedAt || !member || !["OWNER", "ADMIN", "EDITOR", "VIEWER", "COMPLIANCE_AUDITOR"].includes(member.role) || !["FULL", "READ_ONLY"].includes(member.seatType) || project?.organizationId !== input.originalOrganizationId || user?.clerkUserId !== clerkActorId) throw forbidden();
    manualDashboardBudget(deadline);
    const asOf = new Date(), start = new Date(`${input.start}T00:00:00.000Z`), end = new Date(Math.min(Date.parse(`${input.end}T00:00:00.000Z`) + 86400000 - 1, asOf.getTime()));
    const [datePopulation] = await tx.$queryRaw<Array<{ count: bigint; bytes: bigint; invalid: boolean }>>`SELECT count(*) AS count,coalesce(sum(octet_length(id)),0)::bigint AS bytes,coalesce(bool_or(length(id) NOT BETWEEN 1 AND 200),false) AS invalid FROM "TestRun" WHERE "projectId"=${input.projectId} AND "ciProvider"='manual' AND "startedAt">=${start} AND "startedAt"<=${end}`;
    if (!datePopulation || datePopulation.count > 20000n || datePopulation.bytes > 4n * MiB || datePopulation.invalid) throw unavailable();
    manualDashboardBudget(deadline);
    // Reuse the maintained exact configuration compiler, not guessed provider labels.
    const selected = await tx.testRun.findMany({ where: { AND: [reportRunWhere(input.projectId, start, end, { ...(input.platform === undefined ? {} : { platform: input.platform }), ...(input.environment === undefined ? {} : { environment: input.environment }), ...(input.build === undefined ? {} : { build: input.build }) }), { ciProvider: "manual" }] }, select: { id: true }, orderBy: { id: "asc" }, take: 20001 });
    if (selected.length > 20000 || selected.some(row => !identity(row.id)) || new Set(selected.map(row => row.id)).size !== selected.length) throw unavailable();
    manualDashboardBudget(deadline);
    if (!selected.length) return echo(input, clerkActorId, asOf, assembleManualRunDashboard(input.projectId, input.originalOrganizationId, input.start, input.end, [], [], [], [], deadline));
    const selectedRuns = Prisma.sql`SELECT r.id,r."projectId",r."manualTestCaseIds",r."executionContext",r."startedAt",r.status FROM "TestRun" r WHERE r."projectId"=${input.projectId} AND r."ciProvider"='manual' AND r.id IN (${Prisma.join(selected.map(row => row.id))})`;
    const [scopeSize] = await tx.$queryRaw<Array<{ count: bigint; instances: bigint; definitions: bigint; scopeBytes: bigint; bytes: bigint; maxBytes: bigint }>>(Prisma.sql`WITH selected AS (${selectedRuns})
      SELECT count(*) AS count,coalesce(sum(cardinality("manualTestCaseIds")),0)::bigint AS instances,
        coalesce(sum(CASE WHEN jsonb_typeof("executionContext"->'caseDefinitions')='array' THEN jsonb_array_length("executionContext"->'caseDefinitions') ELSE 0 END),0)::bigint AS definitions,
        coalesce(sum(octet_length("manualTestCaseIds"::text)),0)::bigint AS "scopeBytes",coalesce(sum(octet_length("executionContext"::text)),0)::bigint AS bytes,coalesce(max(octet_length("executionContext"::text)),0)::bigint AS "maxBytes" FROM selected`);
    if (!scopeSize || scopeSize.count !== BigInt(selected.length) || scopeSize.instances > 100000n || scopeSize.definitions > 100000n || scopeSize.scopeBytes > 8n * MiB || scopeSize.bytes > 64n * MiB || scopeSize.maxBytes > 4n * MiB) throw unavailable();
    manualDashboardBudget(deadline);
    // Authorization relationships are checked before any status projection or
    // per-run exclusion. A foreign original head is not an exclusion statistic.
    const [relationship] = await tx.$queryRaw<Array<{ foreign: boolean }>>(Prisma.sql`WITH selected AS (${selectedRuns}) SELECT (
      EXISTS(SELECT 1 FROM selected r CROSS JOIN LATERAL unnest(r."manualTestCaseIds") x(id) JOIN "TestCase" c ON c.id=x.id WHERE c."projectId"<>${input.projectId}) OR
      EXISTS(SELECT 1 FROM selected r JOIN "TestResult" t ON t."testRunId"=r.id JOIN "TestCase" c ON c.id=t."testCaseId" WHERE c."projectId"<>${input.projectId}) OR
      EXISTS(SELECT 1 FROM selected r JOIN "ManualCaseResultHead" h ON h."testRunId"=r.id LEFT JOIN "ManualCaseResultRevision" v ON v.id=h."currentRevisionId" WHERE h."organizationId"<>${input.originalOrganizationId} OR h."projectId"<>${input.projectId} OR v."organizationId"<>${input.originalOrganizationId} OR v."projectId"<>${input.projectId}) OR
      EXISTS(SELECT 1 FROM selected r JOIN "ManualCaseResultHead" h ON h."testRunId"=r.id JOIN "TestCase" c ON c.id=h."testCaseId" WHERE c."projectId"<>${input.projectId}) OR
      EXISTS(SELECT 1 FROM selected r JOIN "ManualCaseResultHead" h ON h."testRunId"=r.id
        LEFT JOIN "TestResult" hr ON hr.id=h."testResultId" LEFT JOIN "TestRun" hrr ON hrr.id=hr."testRunId" LEFT JOIN "TestCase" hrc ON hrc.id=hr."testCaseId"
        LEFT JOIN "ManualCaseResultRevision" v ON v.id=h."currentRevisionId" LEFT JOIN "TestRun" vr ON vr.id=v."testRunId" LEFT JOIN "TestCase" vc ON vc.id=v."testCaseId"
        LEFT JOIN "TestResult" rr ON rr.id=v."testResultId" LEFT JOIN "TestRun" rrr ON rrr.id=rr."testRunId" LEFT JOIN "TestCase" rrc ON rrc.id=rr."testCaseId"
        WHERE hrr."projectId"<>${input.projectId} OR hrc."projectId"<>${input.projectId} OR vr."projectId"<>${input.projectId} OR vc."projectId"<>${input.projectId} OR rrr."projectId"<>${input.projectId} OR rrc."projectId"<>${input.projectId}) OR
      EXISTS(SELECT 1 FROM selected r JOIN "ManualStepResultHead" h ON h."testRunId"=r.id
        LEFT JOIN "TestCase" c ON c.id=h."testCaseId" LEFT JOIN "ManualStepResultRevision" v ON v.id=h."currentRevisionId"
        LEFT JOIN "TestRun" vr ON vr.id=v."testRunId" LEFT JOIN "TestCase" vc ON vc.id=v."testCaseId"
        WHERE c."projectId"<>${input.projectId} OR vr."projectId"<>${input.projectId} OR vc."projectId"<>${input.projectId})
    ) AS "foreign"`);
    if (!relationship || relationship.foreign) throw forbidden();
    manualDashboardBudget(deadline);
    const resultProjection = Prisma.sql`SELECT t.id,t."testRunId" AS "runId",t."testCaseId" AS "caseId",t.status::text AS status FROM "TestResult" t JOIN selected r ON r.id=t."testRunId"`;
    const caseProjection = Prisma.sql`SELECT h."testRunId" AS "runId",h."testCaseId" AS "caseId",h."organizationId",h."projectId",h."testResultId" AS "resultId",h."currentRevisionId" AS "revisionId",h."revisionCount",v."testRunId" AS "revisionRunId",v."testCaseId" AS "revisionCaseId",v."organizationId" AS "revisionOrganizationId",v."projectId" AS "revisionProjectId",v."testResultId" AS "revisionResultId",v."revisionNumber",v.status::text AS status FROM "ManualCaseResultHead" h JOIN selected r ON r.id=h."testRunId" LEFT JOIN "ManualCaseResultRevision" v ON v.id=h."currentRevisionId"`;
    const stepProjection = Prisma.sql`SELECT h."testRunId" AS "runId",h."testCaseId" AS "caseId",h."stepIndex",h."currentRevisionId" AS "revisionId",h."revisionCount",v."testRunId" AS "revisionRunId",v."testCaseId" AS "revisionCaseId",v."stepIndex" AS "revisionStepIndex",v."revisionNumber",v.status::text AS status FROM "ManualStepResultHead" h JOIN selected r ON r.id=h."testRunId" LEFT JOIN "ManualStepResultRevision" v ON v.id=h."currentRevisionId"`;
    const validPlannedIdentities = Prisma.sql`NOT EXISTS(SELECT 1 FROM unnest(r."manualTestCaseIds") x(id) WHERE x.id IS NULL OR length(x.id) NOT BETWEEN 1 AND 200 OR octet_length(x.id)>800)`;
    // Native width guards precede transfer, including malformed JSON IDs. Invalid
    // scope identities yield an explicitly unsupported run, not a partial scope.
    const scopeProjection = Prisma.sql`SELECT r.id,r."projectId",r."startedAt",r.status::text AS status,
      coalesce(jsonb_typeof(r."executionContext")='object' AND r."executionContext"->'version'='1'::jsonb AND
        (CASE WHEN jsonb_typeof(r."executionContext"->'caseDefinitions')='array' THEN jsonb_array_length(r."executionContext"->'caseDefinitions') BETWEEN 0 AND 1000 ELSE false END) AND cardinality(r."manualTestCaseIds") BETWEEN 0 AND 1000 AND ${validPlannedIdentities},false) AS "scopeSupported",
      CASE WHEN cardinality(r."manualTestCaseIds") BETWEEN 0 AND 1000 AND ${validPlannedIdentities} THEN r."manualTestCaseIds" ELSE ARRAY[]::text[] END AS "plannedIds",
      coalesce((SELECT jsonb_agg(jsonb_build_object('caseId',CASE WHEN jsonb_typeof(d->'testCaseId')='string' AND length(d->>'testCaseId') BETWEEN 1 AND 200 AND octet_length(d->>'testCaseId')<=800 THEN d->>'testCaseId' ELSE NULL END,
        'stepCount',CASE WHEN jsonb_typeof(d->'steps')='array' THEN jsonb_array_length(d->'steps') ELSE -1 END,
        'completeProcedure',(CASE WHEN jsonb_typeof(d->'steps')='array' THEN jsonb_array_length(d->'steps') ELSE 0 END)>0 OR
          ((CASE WHEN jsonb_typeof(d->'given')='array' THEN jsonb_array_length(d->'given') ELSE 0 END) BETWEEN 1 AND 500 AND (CASE WHEN jsonb_typeof(d->'when')='array' THEN jsonb_array_length(d->'when') ELSE 0 END) BETWEEN 1 AND 500 AND (CASE WHEN jsonb_typeof(d->'then')='array' THEN jsonb_array_length(d->'then') ELSE 0 END) BETWEEN 1 AND 500)))
        FROM jsonb_array_elements(CASE WHEN jsonb_typeof(r."executionContext"->'caseDefinitions')='array' THEN CASE WHEN jsonb_array_length(r."executionContext"->'caseDefinitions')<=1000 THEN r."executionContext"->'caseDefinitions' ELSE '[]'::jsonb END ELSE '[]'::jsonb END) d),'[]'::jsonb) AS definitions FROM selected r`;
    const [projectionSize] = await tx.$queryRaw<Array<{ results: bigint; caseHeads: bigint; stepHeads: bigint; bytes: bigint; invalid: boolean }>>(Prisma.sql`WITH selected AS (${selectedRuns}), results AS (${resultProjection}), cases AS (${caseProjection}), steps AS (${stepProjection}), scopes AS (${scopeProjection}), metadata AS (SELECT to_jsonb(t) AS value FROM results t UNION ALL SELECT to_jsonb(t) FROM cases t UNION ALL SELECT to_jsonb(t) FROM steps t UNION ALL SELECT to_jsonb(t) FROM scopes t)
      SELECT (SELECT count(*) FROM results) AS results,(SELECT count(*) FROM cases) AS "caseHeads",(SELECT count(*) FROM steps) AS "stepHeads",coalesce(sum(octet_length(value::text)),0)::bigint AS bytes,
        coalesce(bool_or(EXISTS(SELECT 1 FROM jsonb_each(value) f WHERE f.key NOT IN ('status','startedAt','stepIndex','revisionStepIndex','revisionNumber','revisionCount') AND jsonb_typeof(f.value)='string' AND length(f.value#>>'{}') NOT BETWEEN 1 AND 200)),false) AS invalid FROM metadata`);
    if (!projectionSize || projectionSize.results > 100000n || projectionSize.caseHeads > 100000n || projectionSize.stepHeads > 100000n || projectionSize.bytes > 16n * MiB || projectionSize.invalid) throw unavailable();
    manualDashboardBudget(deadline);
    const scopes = await tx.$queryRaw<DashboardScope[]>(Prisma.sql`WITH selected AS (${selectedRuns}) ${scopeProjection} ORDER BY r.id`);
    manualDashboardBudget(deadline);
    const results = await tx.$queryRaw<DashboardResult[]>(Prisma.sql`WITH selected AS (${selectedRuns}) ${resultProjection} LIMIT 100001`); manualDashboardBudget(deadline);
    const cases = await tx.$queryRaw<DashboardCaseHead[]>(Prisma.sql`WITH selected AS (${selectedRuns}) ${caseProjection} LIMIT 100001`); manualDashboardBudget(deadline);
    const steps = await tx.$queryRaw<DashboardStepHead[]>(Prisma.sql`WITH selected AS (${selectedRuns}) ${stepProjection} LIMIT 100001`); manualDashboardBudget(deadline);
    if (scopes.length !== selected.length || BigInt(results.length) !== projectionSize.results || BigInt(cases.length) !== projectionSize.caseHeads || BigInt(steps.length) !== projectionSize.stepHeads) throw unavailable("The entire selected native population was not available. No smaller dashboard was substituted.");
    return echo(input, clerkActorId, asOf, assembleManualRunDashboard(input.projectId, input.originalOrganizationId, input.start, input.end, scopes, results, cases, steps, deadline));
  }, { isolationLevel: "RepeatableRead", timeout: 20000 });
}
function echo(input: RecordedExecutionTrendInput, clerkActorId: string, asOf: Date, summary: ReturnType<typeof assembleManualRunDashboard>) {
  const output = { projectId: input.projectId, organizationId: input.originalOrganizationId, clerkActorId, requestKey: manualRunDashboardRequestKey(input), asOf: asOf.toISOString(), scope: { start: input.start, end: input.end, ...(input.platform === undefined ? {} : { platform: input.platform }), ...(input.environment === undefined ? {} : { environment: input.environment }), ...(input.build === undefined ? {} : { build: input.build }) }, ...summary, limitations: [...manualRunDashboardLimitations] };
  if (Buffer.byteLength(JSON.stringify(output), "utf8") > 256 * 1024) throw unavailable("The bounded aggregate response is oversized. No partial summary was returned.");
  return manualRunDashboardOutputSchema.parse(output);
}
