import { Prisma, type PrismaClient, type TestResultStatus } from "@vaettir/db";
import { TRPCError } from "@trpc/server";
import { defectClusterId, defectDocumentSchema, defectSourceKey } from "@vaettir/core";
import { reportRunWhere, reportWindow } from "../routers/reportSnapshotScope.js";
import { withRequirementBaselineAccess } from "./requirementBaselines.js";
import { requirementCoverageLimitations, requirementCoverageRequestKey, type RequirementCoverageInput, type RequirementCoverageListInput,
  type RequirementCoverageCasesInput, type RequirementCoverageEvidenceInput } from "./requirementCoverageSchema.js";
type Tx = Prisma.TransactionClient;
const unavailable = () => new TRPCError({ code: "NOT_FOUND", message: "This explicit relationship or native record is unavailable in this project. Refresh the current inventory." });
const bounded = () => new TRPCError({ code: "PRECONDITION_FAILED", message: "This evidence population exceeds the bounded matrix or contains unavailable relationships. Refine the scope; no partial coverage has been substituted." });
const statuses = ["PASS", "FAIL", "FLAKY", "SKIP", "BLOCKED"] as const;
export function coverageOutcomes(rows: Array<{ status: TestResultStatus; _count: { _all: number } }>) {
  const counts = { PASS: 0, FAIL: 0, FLAKY: 0, SKIP: 0, BLOCKED: 0 };
  for (const row of rows) {
    if (!statuses.includes(row.status) || !Number.isSafeInteger(row._count._all) || row._count._all < 0 || row._count._all > 100000) throw bounded();
    counts[row.status] += row._count._all;
  }
  const total = statuses.reduce((n, key) => n + counts[key], 0);
  if (total > 100000) throw bounded();
  return { ...counts, total, state: !total ? "NO_RECORDED_RESULT" as const
    : counts.PASS + counts.FAIL + counts.FLAKY === 0 ? "ONLY_SKIPPED_OR_BLOCKED" as const : "RECORDED_OUTCOMES" as const };
}
export function withRequirementCoverageAccess<T>(db: PrismaClient, input: RequirementCoverageInput, actorId: string,
  organizationId: string, work: (tx: Tx, scope: { projectId: string; organizationId: string; actorClerkUserId: string }) => Promise<T>, authenticatedClerkActorId?: string) {
  return withRequirementBaselineAccess(db, input.projectId, actorId, organizationId, async (tx, access) => {
    if (input.originalOrganizationId && input.originalOrganizationId !== organizationId) throw unavailable();
    const defect = await tx.defectMapState.findUnique({ where: { projectId: input.projectId }, select: { organizationId: true } });
    if (defect && defect.organizationId !== organizationId) throw unavailable();
    const actor = await tx.user.findUnique({ where: { id: access.actorId }, select: { clerkUserId: true } });
    const member = await tx.membership.findUnique({ where: { organizationId_userId: { organizationId: access.organizationId, userId: access.actorId } }, select: { role: true, seatType: true } });
    if (!actor || !actor.clerkUserId || actor.clerkUserId.length > 200 || !member ||
      !["OWNER", "ADMIN", "EDITOR", "VIEWER", "COMPLIANCE_AUDITOR"].includes(member.role) || !["FULL", "READ_ONLY"].includes(member.seatType) ||
      (authenticatedClerkActorId && actor.clerkUserId !== authenticatedClerkActorId) ||
      (input.expectedClerkActorId && actor.clerkUserId !== input.expectedClerkActorId))
      throw new TRPCError({ code: "FORBIDDEN", message: "The original authenticated actor and current project membership are required for this coverage scope." });
    return work(tx, { projectId: input.projectId, organizationId: access.organizationId, actorClerkUserId: actor.clerkUserId });
  }).then(({ clerkActorId, ...value }) => {
    // Baseline access also emits its own actor alias. Coverage deliberately
    // exposes the independently checked actorClerkUserId contract instead;
    // do not pass an extra alias into the strict portable-export response.
    void clerkActorId;
    return value;
  });
}
async function scope(tx: Tx, input: RequirementCoverageInput) {
  const anchor = new Date(input.asOf), now = new Date();
  if (anchor.getTime() > now.getTime()) throw new TRPCError({ code: "BAD_REQUEST", message: "The run-start upper bound cannot be in the future." });
  let window: ReturnType<typeof reportWindow>;
  try { window = reportWindow(anchor, 30, input.interval); }
  catch { throw new TRPCError({ code: "BAD_REQUEST", message: "Use a valid past UTC run-start interval within 366 days." }); }
  const runWhere = reportRunWhere(input.projectId, window.start, window.end, input.scope);
  if (input.scope?.runId && !await tx.testRun.findFirst({ where: { projectId: input.projectId, id: input.scope.runId }, select: { id: true } })) throw unavailable();
  if (input.scope?.planId && !await tx.testPlan.findFirst({ where: { id: input.scope.planId, projectId: input.projectId }, select: { id: true } }) &&
    !await tx.testRun.findFirst({ where: { projectId: input.projectId, AND: [
      { executionContext: { path: ["version"], equals: 1 } },
      { executionContext: { path: ["plan", "testPlanId"], equals: input.scope.planId } } ] }, select: { id: true } })) throw unavailable();
  if (await tx.testRun.count({ where: runWhere }) > 10000 || await tx.testResult.count({ where: { testRun: runWhere } }) > 100000) throw bounded();
  return { runWhere, window };
}
export { scope as readRequirementCoverageRunScope };
const edge = (projectId: string, requirementId: string) => ({ projectId, requirementId, provider: "requirement", kind: "requirement", removedAt: null });
async function requirement(tx: Tx, projectId: string, requirementId: string) {
  const row = await tx.$queryRaw<Array<{ id: string; title: string; titleIsExcerpt: boolean }>>`
    SELECT id,left(title,180) AS title,length(title)>180 AS "titleIsExcerpt"
    FROM "Requirement" WHERE id=${requirementId} AND "projectId"=${projectId}`;
  if (!row[0]) throw unavailable(); return row[0];
}
async function directCount(tx: Tx, projectId: string, requirementId: string) {
  // Refuse malformed/unavailable direct edges rather than making them zero.
  const count = await tx.$queryRaw<Array<{ total: bigint; invalid: bigint }>>`
    SELECT count(DISTINCT l."caseId") AS total,
      count(*) FILTER (WHERE c.id IS NULL OR c."projectId"<>${projectId} OR l."providerOrigin"<>'vaettir' OR l."nativeId"<>${requirementId}) AS invalid
    FROM "CaseTraceabilityLink" l LEFT JOIN "TestCase" c ON c.id=l."caseId"
    WHERE l."projectId"=${projectId} AND l."requirementId"=${requirementId} AND l.provider='requirement'
      AND l.kind='requirement' AND l."removedAt" IS NULL`;
  if (Number(count[0]?.invalid ?? 0) || Number(count[0]?.total ?? 0) > 1000) throw bounded();
  return Number(count[0]?.total ?? 0);
}
const requested = requirementCoverageRequestKey;
export async function requirementCoverageList(tx: Tx, organizationId: string, input: RequirementCoverageListInput) {
  const { runWhere, window } = await scope(tx, input);
  const escaped = `%${input.search.replace(/[\\%_]/g, "\\$&")}%`;
  const totals = await tx.$queryRaw<Array<{ total: bigint }>>`SELECT count(*) AS total FROM "Requirement"
    WHERE "projectId"=${input.projectId} AND (${input.search}='' OR title ILIKE ${escaped})`;
  const total = Number(totals[0]?.total ?? 0);
  if (total > 10000) throw bounded();
  const rows = await tx.$queryRaw<Array<{ id: string; title: string; titleIsExcerpt: boolean }>>`
    SELECT id,left(title,180) AS title,length(title)>180 AS "titleIsExcerpt" FROM "Requirement"
    WHERE "projectId"=${input.projectId} AND (${input.search}='' OR title ILIKE ${escaped})
    ORDER BY id LIMIT 21 OFFSET ${input.offset}`;
  const items = [];
  for (const row of rows.slice(0, 20)) items.push({ ...row, directCases: await directCount(tx, input.projectId, row.id) });
  const [runCount, resultCount, unmatched, currentMatched] = await Promise.all([
    tx.testRun.count({ where: runWhere }), tx.testResult.count({ where: { testRun: runWhere } }),
    tx.testResult.count({ where: { testRun: runWhere, testCaseId: null } }),
    tx.testResult.count({ where: { testRun: runWhere, testCase: { projectId: input.projectId } } }),
  ]);
  return { projectId: input.projectId, organizationId, requested: requested(input), observedAt: new Date().toISOString(),
    window: { start: window.start.toISOString(), end: window.end.toISOString() }, items, total, hasMore: rows.length > 20,
    projectExecution: { runs: runCount, resultRecords: resultCount, currentMatched, unmatched,
      unavailableCaseReferences: resultCount - currentMatched - unmatched }, limits: requirementCoverageLimitations };
}
export async function requirementCoverageCases(tx: Tx, organizationId: string, input: RequirementCoverageCasesInput) {
  const { runWhere, window } = await scope(tx, input), req = await requirement(tx, input.projectId, input.requirementId);
  const total = await directCount(tx, input.projectId, input.requirementId);
  const rows = await tx.$queryRaw<Array<{ id: string; displayId: string; title: string; titleIsExcerpt: boolean; archived: boolean }>>`
    SELECT DISTINCT c.id,c."displayId",left(c.title,180) AS title,length(c.title)>180 AS "titleIsExcerpt",c.archived
    FROM "CaseTraceabilityLink" l JOIN "TestCase" c ON c.id=l."caseId" AND c."projectId"=${input.projectId}
    WHERE l."projectId"=${input.projectId} AND l."requirementId"=${input.requirementId} AND l.provider='requirement'
      AND l.kind='requirement' AND l."removedAt" IS NULL
    ORDER BY c."displayId",c.id LIMIT 21 OFFSET ${input.offset}`;
  const ids = rows.slice(0, 20).map(row => row.id);
  const outcomes = ids.length ? await tx.testResult.groupBy({ by: ["testCaseId", "status"],
    where: { testCaseId: { in: ids }, testCase: { projectId: input.projectId }, testRun: runWhere }, _count: { _all: true } }) : [];
  const items = [];
  for (const row of rows.slice(0, 20)) {
    const plannedWithoutResult = await tx.testRun.count({ where: { AND: [runWhere, { ciProvider: "manual", manualTestCaseIds: { has: row.id },
      results: { none: { testCaseId: row.id } } }] } });
    items.push({ ...row, outcomes: coverageOutcomes(outcomes.filter(value => value.testCaseId === row.id)), plannedWithoutResult });
  }
  return { projectId: input.projectId, organizationId, requested: requested(input), requirement: req,
    window: { start: window.start.toISOString(), end: window.end.toISOString() }, observedAt: new Date().toISOString(),
    items, total, hasMore: rows.length > 20, limits: requirementCoverageLimitations };
}
async function defects(tx: Tx, input: RequirementCoverageEvidenceInput, organizationId: string) {
  const where = { projectId: input.projectId, caseId: input.caseId, provider: "defect", kind: "defect", removedAt: null };
  if (await tx.caseTraceabilityLink.count({ where }) > 100) throw bounded();
  const rows = await tx.$queryRaw<Array<{ id: string; nativeId: string | null; validOrigin: boolean; title: string; titleIsExcerpt: boolean; tooLarge: boolean }>>`
    SELECT id,CASE WHEN octet_length("nativeId")<=4000 THEN "nativeId" END AS "nativeId","providerOrigin"='vaettir' AS "validOrigin",
      left(title,180) AS title,length(title)>180 AS "titleIsExcerpt",octet_length("nativeId")>4000 AS "tooLarge"
    FROM "CaseTraceabilityLink" WHERE "projectId"=${input.projectId} AND "caseId"=${input.caseId}
      AND provider='defect' AND kind='defect' AND "removedAt" IS NULL ORDER BY id LIMIT 11 OFFSET ${input.defectOffset}`;
  if (rows.some(row => row.tooLarge || !row.validOrigin)) throw bounded();
  const retained = await tx.$queryRaw<Array<{ organizationId: string; document: unknown; tooLarge: boolean }>>`
    SELECT "organizationId",CASE WHEN octet_length(document::text)<=524288 THEN document END AS document,
      octet_length(document::text)>524288 AS "tooLarge" FROM "DefectMapState" WHERE "projectId"=${input.projectId}`;
  if (retained[0] && (retained[0].organizationId !== organizationId || retained[0].tooLarge)) throw bounded();
  const parsed = retained[0] ? defectDocumentSchema.safeParse(retained[0].document) : null;
  if (parsed && !parsed.success) throw bounded();
  const document = parsed?.success ? parsed.data : null;
  return { hasMore: rows.length > 10, items: rows.slice(0, 10).map(row => {
    const signal = document?.signals.find(value => defectClusterId(value) === row.nativeId);
    const source = signal && document?.sources.find(value => defectSourceKey(value) === defectSourceKey(signal));
    return { linkId: row.id, nativeId: signal ? row.nativeId : null, title: row.title, titleIsExcerpt: row.titleIsExcerpt,
      available: !!signal, sourceState: !signal ? "CLUSTER_UNAVAILABLE" as const : !source ? "SOURCE_NOT_RECORDED" as const
        : source.status === "unavailable" ? "SOURCE_UNAVAILABLE" as const : "AVAILABLE_SOURCE_SNAPSHOT" as const,
      sourceObservedAt: source?.observedAt ?? null };
  }) };
}
export async function requirementCoverageEvidence(tx: Tx, organizationId: string, input: RequirementCoverageEvidenceInput) {
  const { runWhere, window } = await scope(tx, input), req = await requirement(tx, input.projectId, input.requirementId);
  await directCount(tx, input.projectId, input.requirementId);
  if (!await tx.caseTraceabilityLink.findFirst({ where: { ...edge(input.projectId, input.requirementId), caseId: input.caseId }, select: { id: true } })) throw unavailable();
  const selectedCase = await tx.$queryRaw<Array<{ id: string; displayId: string; title: string; titleIsExcerpt: boolean; archived: boolean }>>`
    SELECT id,"displayId",left(title,180) AS title,length(title)>180 AS "titleIsExcerpt",archived FROM "TestCase" WHERE id=${input.caseId} AND "projectId"=${input.projectId}`;
  if (!selectedCase[0]) throw unavailable();
  const where = { testCaseId: input.caseId, testCase: { projectId: input.projectId }, testRun: runWhere };
  const count = await tx.testResult.count({ where }); if (count > 10000) throw bounded();
  const groupedOutcomes = await tx.testResult.groupBy({ by: ["status"], where, _count: { _all: true } });
  const outcomes = coverageOutcomes(groupedOutcomes);
  const results = await tx.testResult.findMany({ where, take: 21, skip: input.resultOffset,
    orderBy: [{ testRun: { startedAt: "desc" } }, { testRunId: "desc" }, { id: "desc" }],
    select: { id: true, status: true, testRunId: true, testRun: { select: { startedAt: true, finishedAt: true, status: true } } } });
  // Legacy provider labels are not database-bounded; never materialize arbitrary
  // executionContext, URLs, raw notes, traces or an unbounded provider string.
  const runIds = [...new Set(results.slice(0, 20).map(value => value.testRunId))];
  const providers = runIds.length ? await tx.$queryRaw<Array<{ id: string; ciProvider: string; providerIsExcerpt: boolean }>>(
    Prisma.sql`SELECT id,left("ciProvider",100) AS "ciProvider",length("ciProvider")>100 AS "providerIsExcerpt"
      FROM "TestRun" WHERE "projectId"=${input.projectId} AND id IN (${Prisma.join(runIds)})`) : [];
  const providerMap = new Map(providers.map(value => [value.id, value]));
  if (runIds.some(id => !providerMap.has(id))) throw unavailable();
  const plannedWithoutResult = await tx.testRun.count({ where: { AND: [runWhere, { ciProvider: "manual", manualTestCaseIds: { has: input.caseId },
    results: { none: { testCaseId: input.caseId } } }] } });
  return { projectId: input.projectId, organizationId, requested: requested(input), requirement: req, selectedCase: selectedCase[0],
    observedAt: new Date().toISOString(), window: { start: window.start.toISOString(), end: window.end.toISOString() },
    outcomes, plannedWithoutResult, results: results.slice(0, 20).map(value => ({ ...value, testRun: { ...value.testRun,
      ciProvider: providerMap.get(value.testRunId)!.ciProvider, providerIsExcerpt: providerMap.get(value.testRunId)!.providerIsExcerpt } })),
    resultTotal: count, hasMoreResults: results.length > 20,
    defects: await defects(tx, input, organizationId), limits: requirementCoverageLimitations };
}
