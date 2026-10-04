import { TRPCError } from "@trpc/server";
import { Prisma } from "@vaettir/db";
import { caseHistoryMetadataSchema, type CaseExecutionHistoryInput } from "./caseExecutionHistoryScopeSchema.js";
import { caseHistoryRunPredicate } from "./caseHistoryRunFilters.js";

type Tx = Prisma.TransactionClient;
const bounded = () => new TRPCError({ code: "PRECONDITION_FAILED", message: "Recorded configuration history exceeds its metadata bounds. Refine the UTC interval; no partial history was substituted." });
export async function lockCaseHistoryAccess(tx: Tx, userId: string, input: CaseExecutionHistoryInput,
  authorized: { organizationId: string; clerkActorId: string }) {
  await tx.$executeRaw(Prisma.sql`SET LOCAL statement_timeout = '8000ms'`);
  if (input.originalOrganizationId && input.originalOrganizationId !== authorized.organizationId)
    throw new TRPCError({ code: "FORBIDDEN", message: "This retained history belongs to another original organization. Filters were not rebound." });
  const org = await tx.$queryRaw<Array<{ suspendedAt: Date | null }>>`SELECT "suspendedAt" FROM "Organization" WHERE id=${authorized.organizationId} FOR SHARE`;
  const members = await tx.$queryRaw<Array<{ role: string; seatType: string }>>`SELECT role::text AS role,"seatType"::text AS "seatType" FROM "Membership" WHERE "organizationId"=${authorized.organizationId} AND "userId"=${userId} FOR SHARE`;
  const projects = await tx.$queryRaw<Array<{ organizationId: string }>>`SELECT "organizationId" FROM "Project" WHERE id=${input.projectId} FOR SHARE`;
  const actors = await tx.$queryRaw<Array<{ clerkUserId: string }>>`SELECT "clerkUserId" FROM "User" WHERE id=${userId} FOR SHARE`;
  const actor = actors[0];
  if (!org[0] || org[0].suspendedAt || !members[0] || !["OWNER", "ADMIN", "EDITOR", "VIEWER", "COMPLIANCE_AUDITOR"].includes(members[0].role) ||
    !["FULL", "READ_ONLY"].includes(members[0].seatType) || projects[0]?.organizationId !== authorized.organizationId ||
    !actor || actor.clerkUserId !== authorized.clerkActorId || (input.expectedClerkActorId && actor.clerkUserId !== input.expectedClerkActorId))
    throw new TRPCError({ code: "FORBIDDEN", message: "Current original-organization and signed-in actor access is required. Retained history was not rebound." });
  return { projectId: input.projectId, organizationId: authorized.organizationId, actorClerkUserId: actor.clerkUserId };
}
export function caseHistoryWindow(input: CaseExecutionHistoryInput, observedAt: Date) {
  const interval = input.filters?.interval;
  if (!interval) return null;
  if (interval.end > observedAt.toISOString().slice(0, 10)) throw new TRPCError({ code: "BAD_REQUEST", message: "Future UTC dates cannot be selected." });
  return { start: new Date(`${interval.start}T00:00:00.000Z`),
    end: new Date(Math.min(Date.parse(`${interval.end}T00:00:00.000Z`) + 86400000 - 1, observedAt.getTime())) };
}
/** Candidate count/byte gates precede materialization. No procedures, notes or artifact URLs leave PostgreSQL. */
export async function readCaseHistoryConfigurationIds(tx: Tx, input: CaseExecutionHistoryInput, window: ReturnType<typeof caseHistoryWindow>) {
  const filters = input.filters;
  if (!filters?.platform && !filters?.build && !filters?.environment) return undefined;
  const candidate = Prisma.sql`r."projectId"=${input.projectId}
    ${caseHistoryRunPredicate(filters)}
    AND (${input.testCaseId}=ANY(r."manualTestCaseIds") OR EXISTS(SELECT 1 FROM "TestResult" t WHERE t."testRunId"=r.id AND t."testCaseId"=${input.testCaseId}))
    ${window ? Prisma.sql`AND r."startedAt">=${window.start} AND r."startedAt"<=${window.end}` : Prisma.empty}`;
  const population = await tx.$queryRaw<Array<{ count: number; invalid: boolean }>>(Prisma.sql`
    SELECT count(*)::int AS count,coalesce(bool_or(length(r.id)>200),false) AS invalid FROM "TestRun" r WHERE ${candidate}`);
  if (!population[0] || population[0].count > 20000 || population[0].invalid) throw bounded();
  const projection = Prisma.sql`SELECT r.id,"executionContext"->'version' AS version,
    left("executionContext"->>'profileHash',65) AS "profileHash",jsonb_array_length(defs.value)::int AS "caseCount",m.count::int AS "matchedCount",
    (jsonb_typeof(m.value->'title')='string' AND jsonb_typeof(m.value->'given')='array' AND jsonb_typeof(m.value->'when')='array'
      AND jsonb_typeof(m.value->'then')='array' AND jsonb_typeof(m.value->'steps')='array' AND jsonb_typeof(m.value->'verificationProfile')='object'
      AND jsonb_typeof("executionContext"->'configuration')='object' AND jsonb_typeof("executionContext"->'configuration'->'platform')='string'
      AND jsonb_typeof("executionContext"->'configuration'->'build')='string' AND jsonb_typeof("executionContext"->'configuration'->'environment')='string') AS "metadataValid",
    left(m.value->>'title',10001) AS title,
    CASE WHEN jsonb_typeof(m.value->'steps')='array' THEN jsonb_array_length(m.value->'steps') ELSE 0 END::int AS "stepCount",
    left("executionContext"->'configuration'->>'platform',301) AS platform,left("executionContext"->'configuration'->>'build',301) AS build,
    left("executionContext"->'configuration'->>'environment',2001) AS environment
    FROM "TestRun" r CROSS JOIN LATERAL(SELECT CASE WHEN octet_length("executionContext"::text)<=2097152
      AND jsonb_typeof("executionContext"->'caseDefinitions')='array' THEN CASE WHEN jsonb_array_length("executionContext"->'caseDefinitions')<=500
      THEN "executionContext"->'caseDefinitions' ELSE '[]'::jsonb END ELSE '[]'::jsonb END AS value)defs
    CROSS JOIN LATERAL(SELECT count(*) AS count,(jsonb_agg(d.value)->0) AS value FROM jsonb_array_elements(defs.value)d(value)
      WHERE d.value->>'testCaseId'=${input.testCaseId})m WHERE ${candidate} AND r."ciProvider"='manual'`;
  const size = await tx.$queryRaw<Array<{ bytes: bigint }>>(Prisma.sql`SELECT coalesce(sum(octet_length(row_to_json(p)::text)),0)::bigint AS bytes FROM (${projection})p`);
  if (!size[0] || size[0].bytes > 4194304n) throw bounded();
  const summaries = await tx.$queryRaw<Array<{ id: string } & Record<string, unknown>>>(projection);
  return summaries.filter(row => {
    const parsed = caseHistoryMetadataSchema.safeParse(row);
    if (!parsed.success) return false;
    return (["platform", "build", "environment"] as const).every(key => filters[key] === undefined || parsed.data[key] === filters[key]);
  }).map(row => row.id);
}
