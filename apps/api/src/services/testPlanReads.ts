import { Prisma, type PrismaClient } from "@vaettir/db";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { lockCaseFieldReadScope, type CaseFieldReadAuthorization } from "./caseFieldReadScope.js";
import { supportedManualExecutionIdentity as identity } from "./manualExecutionReadScopeSchema.js";
import { caseFieldPresentationJsonBytes } from "./caseFieldPresentationSchema.js";

const MAX_PLAN_BYTES = 128n * 1024n, MAX_HISTORY_BYTES = 16n * 1024n * 1024n;
const unavailable = (message: string) => new TRPCError({ code: "PRECONDITION_FAILED", message });
function assertReadJsonStructure(value: unknown) {
  try { caseFieldPresentationJsonBytes(value); }
  catch { throw unavailable("Retained plan JSON exceeds its bounded safe structure. No values were discarded, repaired or substituted."); }
}
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
/** Validate a supported ordinary JSON record without Zod record cloning, which
 * can discard an own __proto__ key. No defaults or shape repair are applied. */
export const legacyPlanCustomFieldRecord = z.unknown().superRefine((value, ctx) => {
  let supported = isRecord(value);
  if (supported) try { caseFieldPresentationJsonBytes(value); } catch { supported = false; }
  if (!supported) ctx.addIssue({ code: "custom", message: "Plan metadata edits require a supported JSON object root; retained roots are not converted." });
}).transform(value => value as Record<string, unknown>);
export function assertLegacyPlanMetadataRetention(savedRoot: unknown, proposed: Record<string, unknown> | undefined) {
  return assertLegacyPlanMetadataRootKind(isRecord(savedRoot) ? "object" : "retained", proposed);
}
export function assertLegacyPlanMetadataRootKind(nativeKind: string | null, proposed: Record<string, unknown> | undefined) {
  if (proposed !== undefined && nativeKind !== "object") throw unavailable("This plan retains non-object native metadata. Save status without customFields; explicit metadata replacement is refused, not converted to an empty object.");
  // Undefined means do not include the native column in the write. Even a JSON
  // null saved root is preserved; Prisma.JsonNull is handled by version capture.
  return proposed;
}
async function scope(tx: Prisma.TransactionClient, actorId: string, testPlanId: string, authorized: CaseFieldReadAuthorization) {
  if (!identity(testPlanId)) throw unavailable("Plan identity exceeds the bounded read; nothing was clipped or substituted.");
  // Identity-only discovery precedes every private plan/type/relation body.
  const [found] = await tx.$queryRaw<Array<{ projectId: string | null; organizationId: string | null }>>`SELECT CASE WHEN length(p."projectId") BETWEEN 1 AND 200 AND octet_length(p."projectId")<=800 THEN p."projectId" ELSE NULL END AS "projectId",CASE WHEN length(j."organizationId") BETWEEN 1 AND 200 AND octet_length(j."organizationId")<=800 THEN j."organizationId" ELSE NULL END AS "organizationId" FROM "TestPlan" p JOIN "Project" j ON j.id=p."projectId" WHERE p.id=${testPlanId}`;
  if (!found?.projectId || !found.organizationId) throw new TRPCError({ code: "NOT_FOUND", message: "Plan is unavailable in a supported project scope." });
  const current = await lockCaseFieldReadScope(tx, actorId, { projectId: found.projectId, originalOrganizationId: found.organizationId, expectedClerkActorId: authorized.clerkActorId }, authorized);
  const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "TestPlan" WHERE id=${testPlanId} AND "projectId"=${current.projectId} FOR SHARE`;
  if (locked.length !== 1) throw new TRPCError({ code: "NOT_FOUND", message: "Plan left this current authorized project." });
  return current;
}
export async function readTestPlanDetail(db: PrismaClient, actorId: string, testPlanId: string, authorized: CaseFieldReadAuthorization) {
  return db.$transaction(async tx => {
    await tx.$executeRaw(Prisma.sql`SET LOCAL statement_timeout='8000ms'`);
    const current = await scope(tx, actorId, testPlanId, authorized);
    const [relationship] = await tx.$queryRaw<Array<{ foreign: boolean }>>`SELECT coalesce(s."projectId"<>${current.projectId},false) OR EXISTS(SELECT 1 FROM "TestPlan" l WHERE l."strategyId"=p.id AND l."projectId"<>${current.projectId}) AS "foreign" FROM "TestPlan" p LEFT JOIN "TestPlan" s ON s.id=p."strategyId" WHERE p.id=${testPlanId} AND p."projectId"=${current.projectId}`;
    if (!relationship) throw unavailable("The exact plan relationship scope is unavailable.");
    if (relationship.foreign) throw new TRPCError({ code: "FORBIDDEN", message: "Strategy or linked-plan relationships leave this project. No foreign plan bodies were loaded." });
    const [population] = await tx.$queryRaw<Array<{ bytes: bigint; criteria: bigint; links: bigint }>>`
      SELECT (octet_length(concat(p.id,p."projectId",p."testPlanTypeId",p.name,p.description,p.status::text,p."releaseId",p."strategyId",p."createdById",p."updatedById",p."createdAt"::text,p."updatedAt"::text,p."customFields"::text,p."executionTemplate"::text,t.id,t.key,t.name,t.category::text,t."fieldSchema"::text,s.name))
        +coalesce((SELECT sum(octet_length(concat(c.id,c.description,c.status::text,c."requirementId"))) FROM "AcceptanceCriterion" c WHERE c."testPlanId"=p.id),0)
        +coalesce((SELECT sum(octet_length(concat(l.id,l.name,l.status::text))) FROM "TestPlan" l WHERE l."strategyId"=p.id),0))::bigint AS bytes,
        (SELECT count(*) FROM "AcceptanceCriterion" c WHERE c."testPlanId"=p.id) AS criteria,(SELECT count(*) FROM "TestPlan" l WHERE l."strategyId"=p.id) AS links
      FROM "TestPlan" p JOIN "TestPlanType" t ON t.id=p."testPlanTypeId" LEFT JOIN "TestPlan" s ON s.id=p."strategyId" WHERE p.id=${testPlanId} AND p."projectId"=${current.projectId}`;
    if (!population) throw unavailable("The complete plan/type scope is unavailable; no empty metadata was substituted.");
    if (population.bytes > MAX_PLAN_BYTES || population.criteria > 200n || population.links > 200n) throw unavailable("The complete plan read exceeds 128 KiB or 200 criteria/linked plans. Nothing was truncated; retain the original plan and choose a bounded view.");
    // Only admitted identity sets are returned while acquiring relation locks.
    await tx.$queryRaw`SELECT t.id FROM "TestPlanType" t JOIN "TestPlan" p ON p."testPlanTypeId"=t.id WHERE p.id=${testPlanId} FOR SHARE OF t`;
    await tx.$queryRaw`SELECT l.id FROM "TestPlan" l WHERE l.id=(SELECT "strategyId" FROM "TestPlan" WHERE id=${testPlanId}) OR l."strategyId"=${testPlanId} ORDER BY l.id FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM "AcceptanceCriterion" WHERE "testPlanId"=${testPlanId} ORDER BY id FOR SHARE`;
    const plan = await tx.testPlan.findFirstOrThrow({ where: { id: testPlanId, projectId: current.projectId }, select: { id: true, projectId: true, name: true, description: true, status: true, releaseId: true, customFields: true, strategyId: true, testPlanType: { select: { id: true, key: true, name: true, category: true, fieldSchema: true } }, strategy: { select: { name: true } }, linkedPlans: { select: { id: true, name: true, status: true }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 201 }, acceptanceCriteria: { select: { id: true, description: true, status: true, requirementId: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 201 } } });
    if (BigInt(plan.linkedPlans.length) !== population.links || BigInt(plan.acceptanceCriteria.length) !== population.criteria) throw unavailable("The complete admitted plan relationships are unavailable. No smaller list was substituted.");
    assertReadJsonStructure(plan.customFields);
    assertReadJsonStructure(plan.testPlanType.fieldSchema);
    const { strategy, ...result } = plan;
    const output = { ...result, strategyName: strategy?.name ?? null };
    if (Buffer.byteLength(JSON.stringify(output), "utf8") > Number(MAX_PLAN_BYTES)) throw unavailable("The complete encoded plan exceeds 128 KiB. No prose or metadata was truncated.");
    return output;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 20000, maxWait: 5000 });
}
export async function readTestPlanHistory(db: PrismaClient, actorId: string, testPlanId: string, authorized: CaseFieldReadAuthorization) {
  return db.$transaction(async tx => {
    await tx.$executeRaw(Prisma.sql`SET LOCAL statement_timeout='8000ms'`);
    await scope(tx, actorId, testPlanId, authorized);
    const [population] = await tx.$queryRaw<Array<{ count: bigint; bytes: bigint }>>`SELECT count(*) AS count,coalesce(sum(octet_length(concat(v.id,v."testPlanId",v."versionNumber"::text,v.name,v.description,v.status::text,v."customFields"::text,v."executionTemplate"::text,v."createdAt"::text,u.id,u.name,u.email))),0)::bigint AS bytes FROM "TestPlanVersion" v LEFT JOIN "User" u ON u.id=v."createdById" WHERE v."testPlanId"=${testPlanId}`;
    if (!population || population.count > 500n || population.bytes > MAX_HISTORY_BYTES) throw unavailable("The complete legacy version history exceeds 500 versions or 16 MiB. No partial history or empty result was substituted; paginated history is a separate workflow.");
    await tx.$queryRaw`SELECT id FROM "TestPlanVersion" WHERE "testPlanId"=${testPlanId} ORDER BY id FOR SHARE`;
    await tx.$queryRaw`SELECT u.id FROM "User" u JOIN "TestPlanVersion" v ON v."createdById"=u.id WHERE v."testPlanId"=${testPlanId} ORDER BY u.id FOR SHARE OF u`;
    const versions = await tx.testPlanVersion.findMany({ where: { testPlanId }, select: { versionNumber: true, name: true, description: true, status: true, customFields: true, executionTemplate: true, createdAt: true, createdBy: { select: { id: true, name: true, email: true } } }, orderBy: { versionNumber: "desc" }, take: 501 });
    if (BigInt(versions.length) !== population.count) throw unavailable("The complete admitted legacy history is unavailable. No subset or empty history was substituted.");
    for (const version of versions) { assertReadJsonStructure(version.customFields); assertReadJsonStructure(version.executionTemplate); }
    if (Buffer.byteLength(JSON.stringify(versions), "utf8") > Number(MAX_HISTORY_BYTES)) throw unavailable("The complete encoded legacy history exceeds 16 MiB. No versions or JSON values were truncated.");
    return versions;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 20000, maxWait: 5000 });
}
