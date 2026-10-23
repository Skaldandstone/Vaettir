import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@vaettir/db";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { lockCaseFieldProject } from "./caseFields.js";
import { lockCaseFieldReadScope, lockCurrentCaseFieldActor, type CaseFieldReadAuthorization } from "./caseFieldReadScope.js";

const id = z.string().min(1).max(200);
export const projectCaseKeySchema = z.string().trim().toLowerCase().regex(
  /^[a-z][a-z0-9-]{0,23}$/, "Use 1–24 letters, numbers or hyphens, starting with a letter.",
);
export const projectCaseKeySave = z.object({
  projectId: id, originalOrganizationId: id, expectedClerkActorId: id, expectedNativeActorId: id,
  requestId: z.string().uuid().toLowerCase(),
  expectedCaseKey: projectCaseKeySchema,
  expectedRevision: z.number().int().min(0).max(2147483646),
  caseKey: projectCaseKeySchema,
}).strict();
export const projectCaseKeyReceipt = z.object({
  projectId: id, organizationId: id, actorId: id, actorClerkUserId: id,
  requestId: z.string().uuid(), requestHash: z.string().regex(/^[a-f0-9]{64}$/),
  beforeKey: projectCaseKeySchema, caseKey: projectCaseKeySchema,
  beforeRevision: z.number().int().nonnegative(), revision: z.number().int().nonnegative(),
  keyLocked: z.literal(false), aliasesPreserved: z.literal(true),
}).strict();
export type ProjectCaseKeySave = z.infer<typeof projectCaseKeySave>;
export function projectCaseKeyRequestHash(input: ProjectCaseKeySave, actorId: string) {
  const v = projectCaseKeySave.parse(input);
  return createHash("sha256").update(JSON.stringify({ kind: "ProjectCaseKey/v1", actorId,
    projectId: v.projectId, originalOrganizationId: v.originalOrganizationId,
    expectedClerkActorId: v.expectedClerkActorId, expectedNativeActorId: v.expectedNativeActorId, requestId: v.requestId,
    expectedCaseKey: v.expectedCaseKey, expectedRevision: v.expectedRevision, caseKey: v.caseKey,
  })).digest("hex");
}
export function liveCaseDisplayId(caseKey: string, caseNumber: number) {
  const key = projectCaseKeySchema.parse(caseKey);
  if (!Number.isInteger(caseNumber) || caseNumber < 1 || caseNumber > 2147483647)
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Case identity is unavailable. No replacement ID was guessed." });
  return `${key}-${String(caseNumber).padStart(2, "0")}`;
}
export function parseCaseReference(reference: string) {
  const value = reference.trim().toLowerCase(), match = /^([a-z][a-z0-9-]{0,23})-([0-9]{2,})$/.exec(value);
  if (!match) return null;
  const number = Number(match[2]);
  if (!Number.isInteger(number) || number < 1 || number > 2147483647 || liveCaseDisplayId(match[1]!, number) !== value) return null;
  return { caseKey: match[1]!, caseNumber: number };
}
export function assertProjectCaseKeyReceipt(value: unknown, input: ProjectCaseKeySave, actorId: string) {
  const parsed = projectCaseKeyReceipt.safeParse(value);
  if (!parsed.success) throw new TRPCError({ code: "CONFLICT", message: "The retained key receipt is unavailable. Its original request was not replaced." });
  const receipt = parsed.data, requestHash = projectCaseKeyRequestHash(input, actorId);
  if (receipt.projectId !== input.projectId || receipt.organizationId !== input.originalOrganizationId
    || receipt.actorId !== actorId || receipt.actorId !== input.expectedNativeActorId || receipt.actorClerkUserId !== input.expectedClerkActorId
    || receipt.requestId !== input.requestId || receipt.requestHash !== requestHash
    || receipt.beforeKey !== input.expectedCaseKey || receipt.beforeRevision !== input.expectedRevision
    || receipt.caseKey !== input.caseKey || receipt.revision !== input.expectedRevision + (input.caseKey === input.expectedCaseKey ? 0 : 1))
    throw new TRPCError({ code: "CONFLICT", message: "The retained key receipt does not match the original request. It was not rebound." });
  return receipt;
}
const conflict = () => new TRPCError({ code: "CONFLICT", message: "The project key or revision changed, or this key is reserved in your workspace. Review current identity before creating a new request." });
type KeyRow = { caseKey: string; caseKeyRevision: number; nextCaseNumber: number; organizationId: string };
export async function readProjectCaseIdentity(db: PrismaClient, userId: string, projectId: string, authorized: CaseFieldReadAuthorization) {
  return db.$transaction(async tx => {
    const scope = await lockCaseFieldReadScope(tx, userId, { projectId }, authorized);
    const [row] = await tx.$queryRaw<KeyRow[]>`SELECT "caseKey","caseKeyRevision","nextCaseNumber","organizationId" FROM "Project" WHERE id=${projectId}`;
    if (!row || row.organizationId !== scope.organizationId) throw new TRPCError({ code: "FORBIDDEN", message: "Project ownership changed." });
    const member = await tx.membership.findUniqueOrThrow({ where: { organizationId_userId: { organizationId: scope.organizationId, userId } } });
    return { projectId, organizationId: scope.organizationId, actorId: userId, actorClerkUserId: scope.actorClerkUserId,
      caseKey: row.caseKey, revision: row.caseKeyRevision, allocatedCount: row.nextCaseNumber, keyLocked: false as const,
      canEdit: member.seatType === "FULL" && ["OWNER", "ADMIN", "EDITOR"].includes(member.role) };
  });
}
export async function saveProjectCaseKey(db: PrismaClient, userId: string, raw: z.input<typeof projectCaseKeySave>, authorized: CaseFieldReadAuthorization) {
  const input = projectCaseKeySave.parse(raw);
  if (authorized.clerkActorId !== input.expectedClerkActorId || userId !== input.expectedNativeActorId) throw new TRPCError({ code: "FORBIDDEN", message: "Restore the original signed-in native account before retrying this key request." });
  const requestHash = projectCaseKeyRequestHash(input, userId);
  try {
    return await db.$transaction(async tx => {
      // Shared org -> membership -> advisory -> project -> actor order. Reserve
      // the organization prefix namespace BEFORE taking the project allocation lock.
      const original = await tx.project.findUniqueOrThrow({ where: { id: input.projectId }, select: { organizationId: true } });
      if (original.organizationId !== input.originalOrganizationId) throw new TRPCError({ code: "FORBIDDEN", message: "This key request belongs to its original organization." });
      await tx.$queryRaw`SELECT id FROM "Organization" WHERE id=${original.organizationId} FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM "Membership" WHERE "organizationId"=${original.organizationId} AND "userId"=${userId} FOR SHARE`;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${'vaettir-case-key:' + original.organizationId}))::text`;
      await lockCaseFieldProject(tx, userId, input.projectId);
      const actor = await lockCurrentCaseFieldActor(tx, userId, authorized);
      const [row] = await tx.$queryRaw<KeyRow[]>`SELECT "caseKey","caseKeyRevision","nextCaseNumber","organizationId" FROM "Project" WHERE id=${input.projectId}`;
      if (!row || row.organizationId !== input.originalOrganizationId || actor !== input.expectedClerkActorId || userId !== input.expectedNativeActorId) throw new TRPCError({ code: "FORBIDDEN", message: "Current original project and account access is required." });
      // Recovery precedes current CAS, but only AFTER independently locked current authorization.
      const receipts = await tx.$queryRaw<Array<{ projectId: string; organizationId: string; actorId: string; clerkActorId: string; requestHash: string; receipt: unknown }>>`SELECT "projectId","organizationId","actorId","clerkActorId","requestHash",receipt FROM "ProjectCaseKeyWrite" WHERE id=${input.requestId}`;
      if (receipts.length) {
        const previous = receipts[0]!;
        if (receipts.length !== 1 || previous.projectId !== input.projectId || previous.organizationId !== input.originalOrganizationId || previous.actorId !== userId || previous.clerkActorId !== actor || previous.requestHash !== requestHash) throw conflict();
        return { ...assertProjectCaseKeyReceipt(previous.receipt, input, userId), replayed: true };
      }
      if (row.caseKey !== input.expectedCaseKey || row.caseKeyRevision !== input.expectedRevision) throw conflict();
      const reserved = await tx.$queryRaw<Array<{ projectId: string }>>`SELECT "projectId" FROM "ProjectCaseKeyAlias" WHERE "organizationId"=${row.organizationId} AND "caseKey"=${input.caseKey}`;
      if (reserved.some(item => item.projectId !== input.projectId)) throw conflict();
      const revision = row.caseKeyRevision + (row.caseKey === input.caseKey ? 0 : 1);
      const receipt = projectCaseKeyReceipt.parse({ projectId: input.projectId, organizationId: row.organizationId, actorId: userId,
        actorClerkUserId: actor, requestId: input.requestId, requestHash, beforeKey: row.caseKey, caseKey: input.caseKey,
        beforeRevision: row.caseKeyRevision, revision, keyLocked: false, aliasesPreserved: true });
      await tx.$executeRaw`INSERT INTO "ProjectCaseKeyWrite"(id,"projectId","organizationId","actorId","clerkActorId","requestHash","beforeKey","afterKey","beforeRevision","afterRevision",receipt) VALUES(${input.requestId},${input.projectId},${row.organizationId},${userId},${actor},${requestHash},${row.caseKey},${input.caseKey},${row.caseKeyRevision},${revision},${JSON.stringify(receipt)}::jsonb)`;
      if (revision !== row.caseKeyRevision) {
        await tx.$queryRaw`SELECT set_config('vaettir.project_case_key_request',${input.requestId},true)`;
        const changed = await tx.$executeRaw`UPDATE "Project" SET "caseKey"=${input.caseKey},"caseKeyRevision"=${revision} WHERE id=${input.projectId} AND "organizationId"=${row.organizationId} AND "caseKey"=${row.caseKey} AND "caseKeyRevision"=${row.caseKeyRevision}`;
        if (changed !== 1) throw conflict();
      }
      await tx.auditLog.create({ data: { organizationId: row.organizationId, projectId: input.projectId, actorId: userId,
        entityType: "ProjectCaseKeyWrite", entityId: input.requestId, action: "UPDATE", summary: "Changed test case project key; preserved issued aliases",
        metadata: { requestHash, from: row.caseKey, to: input.caseKey, beforeRevision: row.caseKeyRevision, revision } } });
      return { ...receipt, replayed: false };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2002" || (error.code === "P2010" && error.meta?.code === "23505"))) throw conflict();
    throw error;
  }
}

export async function resolveProjectCaseReference(db: PrismaClient, userId: string, projectId: string, reference: string, authorized: CaseFieldReadAuthorization) {
  const parsed = parseCaseReference(reference);
  if (!parsed) return null;
  return db.$transaction(async tx => {
    await lockCaseFieldReadScope(tx, userId, { projectId }, authorized);
    const [row] = await tx.$queryRaw<Array<{ id: string; displayId: string; title: string; archived: boolean }>>`
    SELECT c.id,vaettir_case_display_label(c."projectId",c."caseNumber") AS "displayId",c.title,c.archived
    FROM "TestCase" c JOIN "Project" p ON p.id=c."projectId"
    JOIN "ProjectCaseKeyAlias" a ON a."projectId"=p.id AND a."organizationId"=p."organizationId"
    WHERE c."projectId"=${projectId} AND a."caseKey"=${parsed.caseKey} AND c."caseNumber"=${parsed.caseNumber}`;
    return row ?? null;
  });
}
