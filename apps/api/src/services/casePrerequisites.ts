import { Prisma, type PrismaClient } from "@vaettir/db";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { lockCaseFieldProject } from "./caseFields.js";
import { lockCaseFieldReadScope, lockCurrentCaseFieldActor, type CaseFieldReadAuthorization } from "./caseFieldReadScope.js";
import { prerequisiteAccessInput, prerequisiteAccessOutput, prerequisitePageInput, prerequisitePageOutput, prerequisiteCaseMetadata, prerequisiteSetInput, prerequisiteSetOutput, prerequisiteRequestHash, prerequisiteGraphHash, prerequisiteDigest, samePrerequisiteSet, reviewedPrerequisiteGraph, type PrerequisiteEdge } from "./casePrerequisiteSchema.js";

const options = { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 10000, maxWait: 5000 };
const refuse = (message = "Saved prerequisite metadata exceeds supported bounds. Nothing was clipped, pruned or replaced.") => new TRPCError({ code: "PRECONDITION_FAILED", message });
type Metadata = z.infer<typeof prerequisitePageOutput>["items"][number];
async function access(tx: Prisma.TransactionClient, userId: string, input: z.infer<typeof prerequisiteAccessInput>, authorized: CaseFieldReadAuthorization) {
  const readScope = await lockCaseFieldReadScope(tx, userId, input, authorized);
  if (input.expectedActorId !== undefined && input.expectedActorId !== readScope.actorId) throw new TRPCError({ code: "FORBIDDEN", message: "Restore the original native account before reading retained prerequisite metadata." });
  const member = await tx.membership.findUniqueOrThrow({ where: { organizationId_userId: { organizationId: readScope.organizationId, userId } }, select: { role: true, seatType: true } });
  return prerequisiteAccessOutput.parse({ projectId: input.projectId, caseId: input.caseId, readRequestId: input.readRequestId, readScope, canEdit: member.seatType === "FULL" && ["OWNER", "ADMIN", "EDITOR"].includes(member.role) });
}
export async function readPrerequisiteAccess(db: PrismaClient, userId: string, raw: z.input<typeof prerequisiteAccessInput>, authorized: CaseFieldReadAuthorization) {
  const input = prerequisiteAccessInput.parse(raw);
  return db.$transaction(tx => access(tx, userId, input, authorized), options);
}
async function graph(tx: Prisma.TransactionClient, projectId: string) {
  // Count/byte/identifier/ref preflight occurs before identifiers are materialized.
  // Missing refs remain in the graph; existing foreign-project bodies never do.
  const [size] = await tx.$queryRaw<Array<{ count: bigint; bytes: bigint; unsupported: boolean }>>`
    SELECT count(*)::bigint AS count,coalesce(sum(octet_length(e."dependentId")+octet_length(e."prerequisiteId")),0)::bigint AS bytes,
      coalesce(bool_or(length(e."dependentId") NOT BETWEEN 1 AND 200 OR length(e."prerequisiteId") NOT BETWEEN 1 AND 200 OR octet_length(e."dependentId")>800 OR octet_length(e."prerequisiteId")>800 OR (d.id IS NOT NULL AND d."projectId"<>e."projectId") OR (p.id IS NOT NULL AND p."projectId"<>e."projectId")),false) AS unsupported
    FROM "TestCasePrerequisite" e LEFT JOIN "TestCase" d ON d.id=e."dependentId" LEFT JOIN "TestCase" p ON p.id=e."prerequisiteId" WHERE e."projectId"=${projectId}`;
  if (!size || size.count > 10000n || size.bytes > 2097152n || size.unsupported) throw refuse();
  const edges = await tx.testCasePrerequisite.findMany({ where: { projectId }, select: { dependentId: true, prerequisiteId: true }, orderBy: [{ dependentId: "asc" }, { prerequisiteId: "asc" }], take: 10001 });
  if (edges.length !== Number(size.count) || edges.length > 10000) throw refuse();
  return { edges, graphHash: prerequisiteGraphHash(projectId, edges) };
}
async function metadata(tx: Prisma.TransactionClient, projectId: string, ids: readonly string[]) {
  if (!ids.length) return [] as Metadata[];
  const [size] = await tx.$queryRaw<Array<{ bytes: bigint; unsupported: boolean }>>(Prisma.sql`
    SELECT coalesce(sum(octet_length(c.id)+octet_length(c."displayId")+octet_length(c.title)+octet_length(c."reviewStatus"::text)),0)::bigint AS bytes,
      coalesce(bool_or(length(c.id) NOT BETWEEN 1 AND 200 OR length(c."displayId")>200 OR length(c.title)>2000 OR octet_length(c.id)>800 OR octet_length(c."displayId")>800 OR octet_length(c.title)>8000),false) AS unsupported
    FROM "TestCase" c WHERE c."projectId"=${projectId} AND c.id IN (${Prisma.join([...ids])})`);
  if (!size || size.bytes > 1048576n || size.unsupported) throw refuse();
  const rows = await tx.testCase.findMany({ where: { projectId, id: { in: [...ids] } }, select: { id: true, displayId: true, title: true, reviewStatus: true, archived: true }, take: ids.length + 1 });
  if (rows.length > ids.length) throw refuse();
  const byId = new Map(rows.map(row => [row.id, row]));
  // PostgreSQL length counts Unicode code points; JS/Zod counts UTF-16 units.
  // Decode-time admission is also required. Never return Zod issues containing
  // retained text or substitute a clipped/empty value after native admission.
  try { return ids.map(id => { const row = byId.get(id); return prerequisiteCaseMetadata.parse(row ? { ...row, unavailable: false } : { id, displayId: null, title: null, reviewStatus: null, archived: null, unavailable: true }); }); }
  catch { throw refuse(); }
}
export async function readPrerequisitePage(db: PrismaClient, userId: string, raw: z.input<typeof prerequisitePageInput>, authorized: CaseFieldReadAuthorization) {
  const input = prerequisitePageInput.parse(raw);
  return db.$transaction(async tx => {
    const admitted = await access(tx, userId, input, authorized), stored = await graph(tx, input.projectId);
    const prerequisiteIds = stored.edges.filter(edge => edge.dependentId === input.caseId).map(edge => edge.prerequisiteId);
    if (prerequisiteIds.length > 50) throw refuse("This retained case has more than 50 direct prerequisites. Its complete saved links require an owned recovery review; no empty list was substituted.");
    const filter = Prisma.sql`c."projectId"=${input.projectId} AND c.id<>${input.caseId} AND c.archived=false AND c."reviewStatus"='APPROVED' AND NOT EXISTS (SELECT 1 FROM "TestCasePrerequisite" e WHERE e."projectId"=${input.projectId} AND e."dependentId"=${input.caseId} AND e."prerequisiteId"=c.id) AND position(lower(${input.search}) in lower(c.title||' '||c."displayId"||' '||c.id))>0`;
    // Only a digest/count of native matching metadata reaches this projection.
    // Native row text is admitted separately for the selected page below.
    const [populationSize] = await tx.$queryRaw<Array<{ count: bigint; bytes: bigint; unsupported: boolean }>>(Prisma.sql`SELECT count(*)::bigint AS count,coalesce(sum(octet_length(c.id)+octet_length(c."displayId")+octet_length(c.title)),0)::bigint AS bytes,coalesce(bool_or(length(c.id) NOT BETWEEN 1 AND 200 OR length(c."displayId")>200 OR length(c.title)>2000 OR octet_length(c.id)>800 OR octet_length(c."displayId")>800 OR octet_length(c.title)>8000),false) AS unsupported FROM "TestCase" c WHERE ${filter}`);
    if (!populationSize || populationSize.count > 1000000n || populationSize.bytes > 16777216n || populationSize.unsupported) throw refuse("The approved candidate population exceeds supported metadata bounds.");
    const [population] = await tx.$queryRaw<Array<{ digest: string }>>(Prisma.sql`SELECT md5(coalesce(string_agg(md5(jsonb_build_array(c.id,c."displayId",c.title,c."updatedAt",c."caseNumber")::text),'' ORDER BY c.id),'')) AS digest FROM "TestCase" c WHERE ${filter}`);
    if (!population) throw refuse();
    const populationHash = prerequisiteDigest([admitted.readScope, input.caseId, input.search, input.sort, population.digest, populationSize.count.toString()]);
    const offset = input.cursor?.offset ?? 0;
    if (input.cursor && (input.cursor.populationHash !== populationHash || input.cursor.graphHash !== stored.graphHash)) throw new TRPCError({ code: "CONFLICT", message: "The candidate population or saved graph changed. Refresh the page; retained drafts were not replaced." });
    if (offset > Number(populationSize.count)) throw new TRPCError({ code: "CONFLICT", message: "This candidate cursor is outside the current population." });
    const order = input.sort === "title" ? Prisma.sql`c.title COLLATE "C" ASC,c.id ASC` : input.sort === "inventory" ? Prisma.sql`c."updatedAt" DESC,c.id ASC` : Prisma.sql`c."caseNumber" ASC,c.id ASC`;
    const [pageSize] = await tx.$queryRaw<Array<{ unsupported: boolean }>>(Prisma.sql`SELECT coalesce(bool_or(length(p.id) NOT BETWEEN 1 AND 200 OR octet_length(p.id)>800),false) AS unsupported FROM (SELECT c.id FROM "TestCase" c WHERE ${filter} ORDER BY ${order} LIMIT 20 OFFSET ${offset}) p`);
    if (!pageSize || pageSize.unsupported) throw refuse();
    const pageIds = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT c.id FROM "TestCase" c WHERE ${filter} ORDER BY ${order} LIMIT 20 OFFSET ${offset}`);
    const [linked, items] = await Promise.all([metadata(tx, input.projectId, prerequisiteIds), metadata(tx, input.projectId, pageIds.map(row => row.id))]);
    try { return prerequisitePageOutput.parse({ ...admitted, graphHash: stored.graphHash, prerequisiteIds, linked, items, total: Number(populationSize.count), offset, populationHash, nextCursor: offset + items.length < Number(populationSize.count) ? { offset: offset + 20, populationHash, graphHash: stored.graphHash } : null }); }
    catch { throw refuse(); }
  }, options);
}
export async function setReviewedPrerequisites(db: PrismaClient, userId: string, raw: z.input<typeof prerequisiteSetInput>, authorized: CaseFieldReadAuthorization) {
  const input = prerequisiteSetInput.parse(raw), requestHash = prerequisiteRequestHash(input);
  return db.$transaction(async tx => {
    await tx.$executeRaw(Prisma.sql`SET LOCAL statement_timeout='8000ms'`);
    await lockCaseFieldProject(tx, userId, input.projectId);
    const actorClerkUserId = await lockCurrentCaseFieldActor(tx, userId, authorized);
    const project = await tx.project.findUniqueOrThrow({ where: { id: input.projectId }, select: { organizationId: true } });
    if (input.expectedActorId !== userId || input.originalOrganizationId !== project.organizationId || input.expectedClerkActorId !== actorClerkUserId) throw new TRPCError({ code: "FORBIDDEN", message: "Restore the original native account and organization before retrying prerequisites." });
    // Exact accepted UUID recovery precedes later graph admission. Native actor
    // identity and current full-editor authorization precede private receipts.
    const receipts = await tx.$queryRaw<Array<{ organizationId: string | null; requestHash: string | null }>>`SELECT CASE WHEN length("organizationId") BETWEEN 1 AND 200 AND octet_length("organizationId")<=800 THEN "organizationId" ELSE NULL END AS "organizationId",CASE WHEN jsonb_typeof(metadata->'requestHash')='string' AND length(metadata->>'requestHash')=64 AND (metadata->>'requestHash') ~ '^[a-f0-9]{64}$' THEN metadata->>'requestHash' ELSE NULL END AS "requestHash" FROM "AuditLog" WHERE "projectId"=${input.projectId} AND "actorId"=${userId} AND "entityType"='CasePrerequisiteWrite' AND "entityId"=${input.requestId} LIMIT 2`;
    const ack = (replayed: boolean) => prerequisiteSetOutput.parse({ projectId: input.projectId, caseId: input.caseId, organizationId: project.organizationId, actorId: userId, actorClerkUserId, requestId: input.requestId, requestHash, prerequisiteIds: input.prerequisiteIds, replayed });
    if (receipts.length) {
      if (receipts.some(row => row.organizationId !== project.organizationId)) throw new TRPCError({ code: "FORBIDDEN", message: "The retained prerequisite receipt belongs to another original organization." });
      if (receipts.length !== 1 || receipts[0]!.requestHash !== requestHash) throw new TRPCError({ code: "CONFLICT", message: "Retry the exact original prerequisite request. Its UUID cannot approve replacement links." });
      return ack(true);
    }
    const stored = await graph(tx, input.projectId), before = stored.edges.filter(edge => edge.dependentId === input.caseId).map(edge => edge.prerequisiteId);
    if (stored.graphHash !== input.expectedGraphHash || !samePrerequisiteSet(before, input.expectedPrerequisiteIds)) throw new TRPCError({ code: "CONFLICT", message: "Saved prerequisites changed. Review current links before a new request; the retained draft was not applied." });
    if (before.length > 50) throw refuse();
    const additions = input.prerequisiteIds.filter(id => !before.includes(id));
    const lockIds = [...new Set([input.caseId, ...input.prerequisiteIds])].sort();
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "TestCase" WHERE "projectId"=${input.projectId} AND id IN (${Prisma.join(lockIds)}) ORDER BY id FOR SHARE`);
    const state = await tx.testCase.findMany({ where: { projectId: input.projectId, id: { in: lockIds } }, select: { id: true, archived: true, reviewStatus: true }, take: lockIds.length + 1 });
    const dependent = state.find(row => row.id === input.caseId);
    if (!dependent || dependent.archived) throw new TRPCError({ code: "NOT_FOUND", message: "An active case in this original project is required to edit prerequisites." });
    if (additions.some(id => !state.some(row => row.id === id && !row.archived && row.reviewStatus === "APPROVED"))) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "New prerequisites must be currently approved active cases in the same project. Retained old links were not pruned or approved." });
    let afterGraph: PrerequisiteEdge[];
    try { afterGraph = reviewedPrerequisiteGraph(stored.edges, input.caseId, input.prerequisiteIds); } catch (cause) { throw refuse(cause instanceof Error ? cause.message : undefined); }
    const removed = before.filter(id => !input.prerequisiteIds.includes(id));
    if (removed.length) await tx.testCasePrerequisite.deleteMany({ where: { projectId: input.projectId, dependentId: input.caseId, prerequisiteId: { in: removed } } });
    if (additions.length) await tx.testCasePrerequisite.createMany({ data: additions.map(prerequisiteId => ({ projectId: input.projectId, dependentId: input.caseId, prerequisiteId, createdById: userId })) });
    await tx.auditLog.create({ data: { organizationId: project.organizationId, projectId: input.projectId, actorId: userId, entityType: "CasePrerequisiteWrite", entityId: input.requestId, action: "UPDATE", summary: "Saved explicitly reviewed test case prerequisites", metadata: { version: 1, caseId: input.caseId, requestHash, before, after: input.prerequisiteIds, beforeGraphHash: stored.graphHash, afterGraphHash: prerequisiteGraphHash(input.projectId, afterGraph) } } });
    return ack(false);
  }, options);
}
