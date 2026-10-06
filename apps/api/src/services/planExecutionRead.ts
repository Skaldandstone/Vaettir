import { Prisma, type PrismaClient } from "@vaettir/db";
import { TRPCError } from "@trpc/server";
import { lockCaseFieldReadScope, type CaseFieldReadAuthorization } from "./caseFieldReadScope.js";
import { caseFieldPresentationJsonBytes } from "./caseFieldPresentationSchema.js";
import { executionTemplateHash, readPlanExecutionTemplate } from "./testPlanExecution.js";
import {
  PLAN_EXECUTION_READ_BOUNDS as bounds,
  planExecutionAccessInput, planExecutionAccessOutput,
  planExecutionPageInput, planExecutionPageOutput,
  planExecutionReadSubject, planExecutionReadKey, planExecutionCandidateScopeKey,
  type PlanExecutionAccessInput, type PlanExecutionPageInput,
} from "./planExecutionReadSchema.js";

const options = { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 20000, maxWait: 5000 };
const refused = () => new TRPCError({ code: "PRECONDITION_FAILED", message: "The complete plan execution read is unsupported or exceeds its explicit bounds. No template, hash, case list or context was repaired, clipped or substituted." });
const foreign = () => new TRPCError({ code: "FORBIDDEN", message: "Current original project, organization and independently verified native actor are required. The retained plan read was not rebound." });
const absent = () => new TRPCError({ code: "NOT_FOUND", message: "The plan is unavailable in the original project." });
const nativeBytes = (value: unknown, maximum: number) => typeof value === "bigint" && value >= 0n && value <= BigInt(maximum);

function verified(actorId: string, raw: PlanExecutionAccessInput, authorized: CaseFieldReadAuthorization) {
  if (!planExecutionReadSubject.safeParse(actorId).success || !planExecutionReadSubject.safeParse(authorized?.clerkActorId).success || authorized.clerkActorId !== raw.expectedClerkActorId || raw.expectedNativeActorId !== undefined && actorId !== raw.expectedNativeActorId) throw foreign();
  return { clerkActorId: authorized.clerkActorId };
}
async function current(tx: Prisma.TransactionClient, actorId: string, input: PlanExecutionAccessInput, authorized: CaseFieldReadAuthorization) {
  // Independently verified transport subject was checked before transaction or
  // even this bounded identity-only discovery. No name/template/profile here.
  await tx.$executeRaw`SET LOCAL statement_timeout='8000ms'`;
  const found = await tx.$queryRaw<Array<{ projectId: string | null; organizationId: string | null }>>`
    SELECT CASE WHEN length(p."projectId") BETWEEN 1 AND 200 AND octet_length(p."projectId")<=800 THEN p."projectId" END AS "projectId",
      CASE WHEN length(j."organizationId") BETWEEN 1 AND 200 AND octet_length(j."organizationId")<=800 THEN j."organizationId" END AS "organizationId"
    FROM "TestPlan" p JOIN "Project" j ON j.id=p."projectId" WHERE p.id=${input.testPlanId}`;
  if (found.length !== 1 || !found[0]?.projectId || !found[0]?.organizationId) throw absent();
  if (found[0].projectId !== input.projectId || found[0].organizationId !== input.originalOrganizationId) throw foreign();
  const scope = await lockCaseFieldReadScope(tx, actorId, input, authorized);
  if (scope.projectId !== input.projectId || scope.organizationId !== input.originalOrganizationId || scope.actorId !== actorId || scope.actorClerkUserId !== input.expectedClerkActorId || scope.actorClerkUserId !== authorized.clerkActorId || input.expectedNativeActorId !== undefined && scope.actorId !== input.expectedNativeActorId) throw foreign();
  const plan = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "TestPlan" WHERE id=${input.testPlanId} AND "projectId"=${scope.projectId} FOR SHARE`;
  if (plan.length !== 1 || plan[0]?.id !== input.testPlanId) throw absent();
  const member = await tx.$queryRaw<Array<{ role: string; seatType: string }>>`SELECT role::text AS role,"seatType"::text AS "seatType" FROM "Membership" WHERE "organizationId"=${scope.organizationId} AND "userId"=${scope.actorId} FOR SHARE`;
  if (member.length !== 1 || !["OWNER", "ADMIN", "EDITOR", "VIEWER", "COMPLIANCE_AUDITOR"].includes(member[0]!.role) || !["FULL", "READ_ONLY"].includes(member[0]!.seatType)) throw foreign();
  return { scope: { ...scope, testPlanId: input.testPlanId }, hasFullEditorAccess: member[0]!.seatType === "FULL" && ["OWNER", "ADMIN", "EDITOR"].includes(member[0]!.role) };
}
export async function readPlanExecutionAccess(db: PrismaClient, actorId: string, raw: PlanExecutionAccessInput, authorized: CaseFieldReadAuthorization) {
  const subject = verified(actorId, raw, authorized), input = planExecutionAccessInput.parse(raw);
  return db.$transaction(async tx => {
    const access = await current(tx, actorId, input, subject);
    return planExecutionAccessOutput.parse({ hasFullEditorAccess: access.hasFullEditorAccess, readContext: { requestId: input.requestId, requestedKey: planExecutionReadKey(input, "ACCESS"), projection: "ACCESS", scope: access.scope } });
  }, options);
}

/** Parse only bounded native text; before canonical legacy hashing, refuse deep,
 * unsafe/non-finite structure. Native equality is checked separately by caller.
 * Returning the parsed legacy view never replaces the original JSONB text. */
export function admitPlanExecutionTemplateText(text: unknown) {
  if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > bounds.templateBytes) throw refused();
  let value: unknown;
  try {
    value = JSON.parse(text);
    caseFieldPresentationJsonBytes(value);
  } catch { throw refused(); }
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded, "utf8") > bounds.templateBytes) throw refused();
  return { value, encoded };
}
type MetadataRow = { id: string; projectId: string; title: string; displayId: string; reviewStatus: string; archived: boolean };
function metadata(row: MetadataRow, projectId: string) {
  if (row.projectId !== projectId) throw foreign();
  // DTO validation later rejects unsupported UTF-16 labels, NULL and unknown
  // enums generically; no truthy fallback, truncation, native URL or email.
  return { id: row.id, title: row.title, displayId: row.displayId, reviewStatus: row.reviewStatus, archived: row.archived };
}
const limitations = [
  "Current template and candidate metadata only; not complete plan, procedure, prerequisite, configuration execution approval or globally frozen cohort.",
  "Exact JSONB text describes its native stored representation, not original submitted JSON formatting. The separate legacy interpretation may trim or default fields; it never silently replaces raw text.",
  "Membership/full-editor access is not a save/start permission receipt. Save and start must independently recheck current native scope and complete writer admission; historical UNKNOWN requests were not adopted.",
  "Saved identities include missing/archived cases. Active candidates may be unreviewed; only the run writer decides admission. Profiles, provider links, sources, media and private procedure bodies are not loaded.",
  "Paging uses literal search and UTF-8 ID order in each current transaction; it is not chronology, a project-wide count or an immutable cross-page snapshot.",
];
export async function readPlanExecutionPage(db: PrismaClient, actorId: string, raw: PlanExecutionPageInput, authorized: CaseFieldReadAuthorization) {
  const subject = verified(actorId, raw, authorized), input = planExecutionPageInput.parse(raw), candidateScopeKey = planExecutionCandidateScopeKey(input);
  if (input.cursor && input.cursor.scopeKey !== candidateScopeKey) throw new TRPCError({ code: "CONFLICT", message: "The candidate cursor belongs to another exact scope. Refresh and review the original plan read." });
  return db.$transaction(async tx => {
    const access = await current(tx, actorId, input, subject);
    const admission = await tx.$queryRaw<Array<{ templateBytes: bigint; planBytes: bigint; kind: string | null; sqlNull: boolean; cases: bigint; configurations: bigint; scalarSupported: boolean }>>`
      SELECT COALESCE(octet_length("executionTemplate"::text),0)::bigint AS "templateBytes",
        octet_length(concat(id,"projectId",name,status::text))::bigint AS "planBytes",
        jsonb_typeof("executionTemplate") AS kind,"executionTemplate" IS NULL AS "sqlNull",
        CASE WHEN jsonb_typeof("executionTemplate"->'testCaseIds')='array' THEN jsonb_array_length("executionTemplate"->'testCaseIds')::bigint ELSE 0::bigint END AS cases,
        CASE WHEN jsonb_typeof("executionTemplate"->'configurations')='array' THEN jsonb_array_length("executionTemplate"->'configurations')::bigint ELSE 0::bigint END AS configurations,
        length(name)<=10000 AND octet_length(name)<=40000 AND status::text IN ('DRAFT','ACTIVE','IN_REVIEW','APPROVED','ARCHIVED') AS "scalarSupported"
      FROM "TestPlan" WHERE id=${input.testPlanId} AND "projectId"=${input.projectId}`;
    if (admission.length !== 1) throw refused();
    const size = admission[0]!;
    if (!nativeBytes(size.templateBytes, bounds.templateBytes) || !nativeBytes(size.planBytes, 41000) || size.kind !== "object" || size.sqlNull !== false || size.scalarSupported !== true || !nativeBytes(size.cases, bounds.cases) || !nativeBytes(size.configurations, bounds.configurations)) throw refused();
    // Guard each identity BEFORE extraction to JS/metadata. JSON string type,
    // width and native project pointers are admitted for the WHOLE saved set.
    const relationships = await tx.$queryRaw<Array<{ foreign: boolean; invalid: boolean }>>`
      WITH refs AS (SELECT CASE WHEN jsonb_typeof(v)='string' AND length(v#>>'{}') BETWEEN 1 AND 200 AND octet_length(v#>>'{}')<=800 THEN v#>>'{}' END AS id
        FROM "TestPlan" p CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(p."executionTemplate"->'testCaseIds')='array' THEN p."executionTemplate"->'testCaseIds' ELSE '[]'::jsonb END) v WHERE p.id=${input.testPlanId} AND p."projectId"=${input.projectId})
      SELECT EXISTS(SELECT 1 FROM refs r JOIN "TestCase" c ON c.id=r.id WHERE c."projectId"<>${input.projectId}) AS foreign,
        EXISTS(SELECT 1 FROM refs WHERE id IS NULL) OR (SELECT count(*)<>count(DISTINCT id) FROM refs) AS invalid`;
    if (relationships.length !== 1 || typeof relationships[0]?.foreign !== "boolean" || typeof relationships[0]?.invalid !== "boolean") throw refused();
    if (relationships[0]!.foreign) throw foreign();
    if (relationships[0]!.invalid) throw refused();
    if (input.cursor) {
      const cursor = await tx.$queryRaw<Array<{ present: boolean }>>`SELECT EXISTS(SELECT 1 FROM "TestCase" WHERE id=${input.cursor.lastId} AND "projectId"=${input.projectId} AND NOT archived AND (${input.search}='' OR position(lower(${input.search}) in lower(title))>0)) AS present`;
      if (cursor.length !== 1 || cursor[0]?.present !== true) throw new TRPCError({ code: "CONFLICT", message: "The exact current candidate cursor is unavailable. Refresh rather than substituting another scope." });
    }
    const population = await tx.$queryRaw<Array<{ selectedBytes: bigint; selectedCount: bigint; candidateBytes: bigint; candidateCount: bigint; scalarSupported: boolean }>>`
      WITH refs AS (SELECT v#>>'{}' AS id FROM "TestPlan" p CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(p."executionTemplate"->'testCaseIds')='array' THEN p."executionTemplate"->'testCaseIds' ELSE '[]'::jsonb END) v WHERE p.id=${input.testPlanId} AND p."projectId"=${input.projectId}),
      selected AS (SELECT c.id,c."projectId",c.title,c."displayId",c."reviewStatus",c.archived FROM refs r JOIN "TestCase" c ON c.id=r.id AND c."projectId"=${input.projectId}),
      candidates AS (SELECT c.id,c."projectId",c.title,c."displayId",c."reviewStatus",c.archived FROM "TestCase" c WHERE c."projectId"=${input.projectId} AND NOT c.archived AND (${input.search}='' OR position(lower(${input.search}) in lower(c.title))>0)
        AND (${input.cursor?.lastId ?? null}::text IS NULL OR convert_to(c.id,'UTF8')>convert_to(${input.cursor?.lastId ?? null}::text,'UTF8')) ORDER BY convert_to(c.id,'UTF8') LIMIT ${input.limit + 1}),
      rows AS (SELECT id,"projectId",title,"displayId","reviewStatus",archived FROM selected UNION ALL SELECT id,"projectId",title,"displayId","reviewStatus",archived FROM candidates)
      SELECT COALESCE((SELECT sum(octet_length(concat(id,"projectId",title,"displayId","reviewStatus"::text,archived::text))::bigint) FROM selected),0)::bigint AS "selectedBytes",
        (SELECT count(*) FROM selected) AS "selectedCount",
        COALESCE((SELECT sum(octet_length(concat(id,"projectId",title,"displayId","reviewStatus"::text,archived::text))::bigint) FROM candidates),0)::bigint AS "candidateBytes",
        (SELECT count(*) FROM candidates) AS "candidateCount",
        NOT EXISTS(SELECT 1 FROM rows WHERE length(id) NOT BETWEEN 1 AND 200 OR octet_length(id)>800 OR length(title)>10000 OR octet_length(title)>40000 OR length("displayId")>200 OR octet_length("displayId")>800) AS "scalarSupported"`;
    if (population.length !== 1) throw refused();
    const count = population[0]!;
    if (!nativeBytes(count.selectedBytes, bounds.selectedBytes) || !nativeBytes(count.candidateBytes, bounds.candidateBytes) || !nativeBytes(count.selectedCount, bounds.cases) || count.selectedCount > size.cases || !nativeBytes(count.candidateCount, input.limit + 1) || count.scalarSupported !== true || size.templateBytes + size.planBytes + count.selectedBytes + count.candidateBytes > BigInt(bounds.responseBytes)) throw refused();
    // Acquire child SHARE locks only for the already admitted metadata sets.
    await tx.$queryRaw`SELECT c.id FROM "TestCase" c WHERE c."projectId"=${input.projectId} AND c.id IN (SELECT v#>>'{}' FROM "TestPlan" p CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(p."executionTemplate"->'testCaseIds')='array' THEN p."executionTemplate"->'testCaseIds' ELSE '[]'::jsonb END) v WHERE p.id=${input.testPlanId}) ORDER BY convert_to(c.id,'UTF8') FOR SHARE OF c`;
    await tx.$queryRaw`SELECT c.id FROM "TestCase" c WHERE c.id IN (SELECT q.id FROM "TestCase" q WHERE q."projectId"=${input.projectId} AND NOT q.archived AND (${input.search}='' OR position(lower(${input.search}) in lower(q.title))>0) AND (${input.cursor?.lastId ?? null}::text IS NULL OR convert_to(q.id,'UTF8')>convert_to(${input.cursor?.lastId ?? null}::text,'UTF8')) ORDER BY convert_to(q.id,'UTF8') LIMIT ${input.limit + 1}) ORDER BY convert_to(c.id,'UTF8') FOR SHARE OF c`;
    const bodies = await tx.$queryRaw<Array<{ id: string; projectId: string; name: string; status: string; templateText: string }>>`SELECT id,"projectId",name,status::text AS status,"executionTemplate"::text AS "templateText" FROM "TestPlan" WHERE id=${input.testPlanId} AND "projectId"=${input.projectId}`;
    if (bodies.length !== 1 || bodies[0]?.id !== input.testPlanId || bodies[0]?.projectId !== input.projectId || typeof bodies[0]?.templateText !== "string" || BigInt(Buffer.byteLength(bodies[0].templateText, "utf8")) !== size.templateBytes) throw refused();
    const body = bodies[0], admitted = admitPlanExecutionTemplateText(body.templateText);
    const equal = await tx.$queryRaw<Array<{ exact: boolean }>>`SELECT "executionTemplate"=${admitted.encoded}::jsonb AS exact FROM "TestPlan" WHERE id=${input.testPlanId} AND "projectId"=${input.projectId}`;
    if (equal.length !== 1 || equal[0]?.exact !== true) throw refused();
    let template: ReturnType<typeof readPlanExecutionTemplate>;
    try { template = readPlanExecutionTemplate(admitted.value); } catch { throw refused(); }
    if (BigInt(template?.testCaseIds.length ?? 0) !== size.cases || BigInt(template?.configurations.length ?? 0) !== size.configurations) throw refused();
    const templateHash = executionTemplateHash(admitted.value);
    const interpretation = template === null ? "UNCONFIGURED_EMPTY_OBJECT" : executionTemplateHash(template) === templateHash ? "EXACT_SUPPORTED" : "LEGACY_NORMALIZED";
    const selectedRows = await tx.$queryRaw<MetadataRow[]>`SELECT c.id,c."projectId",c.title,c."displayId",c."reviewStatus"::text AS "reviewStatus",c.archived FROM "TestCase" c WHERE c."projectId"=${input.projectId} AND c.id IN (SELECT v#>>'{}' FROM "TestPlan" p CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(p."executionTemplate"->'testCaseIds')='array' THEN p."executionTemplate"->'testCaseIds' ELSE '[]'::jsonb END) v WHERE p.id=${input.testPlanId})`;
    const candidateRows = await tx.$queryRaw<MetadataRow[]>`SELECT c.id,c."projectId",c.title,c."displayId",c."reviewStatus"::text AS "reviewStatus",c.archived FROM "TestCase" c WHERE c."projectId"=${input.projectId} AND NOT c.archived AND (${input.search}='' OR position(lower(${input.search}) in lower(c.title))>0) AND (${input.cursor?.lastId ?? null}::text IS NULL OR convert_to(c.id,'UTF8')>convert_to(${input.cursor?.lastId ?? null}::text,'UTF8')) ORDER BY convert_to(c.id,'UTF8') LIMIT ${input.limit + 1}`;
    if (BigInt(selectedRows.length) !== count.selectedCount || BigInt(candidateRows.length) !== count.candidateCount || new Set(selectedRows.map(row => row.id)).size !== selectedRows.length) throw refused();
    const byId = new Map(selectedRows.map(row => [row.id, metadata(row, input.projectId)]));
    const ids = template?.testCaseIds ?? [];
    if (selectedRows.some(row => !ids.includes(row.id))) throw refused();
    const allCandidates = candidateRows.map(row => metadata(row, input.projectId));
    for (let index = 0; index < allCandidates.length; index++) {
      const row = allCandidates[index]!;
      const before = index === 0 ? input.cursor?.lastId : allCandidates[index - 1]?.id;
      if (row.archived || before !== undefined && Buffer.compare(Buffer.from(before, "utf8"), Buffer.from(row.id, "utf8")) >= 0) throw refused();
    }
    const candidates = allCandidates.slice(0, input.limit);
    const result = planExecutionPageOutput.safeParse({
      hasFullEditorAccess: access.hasFullEditorAccess,
      readContext: { requestId: input.requestId, requestedKey: planExecutionReadKey(input, "PAGE"), projection: "PAGE", scope: access.scope },
      plan: { id: body.id, projectId: body.projectId, name: body.name, status: body.status },
      rawTemplate: { sqlNull: false, jsonText: body.templateText }, template, templateHash, interpretation,
      selected: ids.map(testCaseId => { const item = byId.get(testCaseId); return { testCaseId, state: !item ? "MISSING" : item.archived ? "ARCHIVED" : "AVAILABLE", metadata: item ?? null }; }),
      candidates, search: input.search, limit: input.limit, candidateScopeKey,
      nextCursor: allCandidates.length > input.limit ? { scopeKey: candidateScopeKey, lastId: candidates.at(-1)!.id } : null,
      limitations,
    });
    if (!result.success || Buffer.byteLength(JSON.stringify(result.data), "utf8") > bounds.responseBytes) throw refused();
    return result.data;
  }, options);
}
