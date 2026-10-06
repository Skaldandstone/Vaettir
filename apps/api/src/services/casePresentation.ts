import { TRPCError } from "@trpc/server";
import { Prisma, type PrismaClient } from "@vaettir/db";
import { casePresentationSchema, defaultCasePresentation } from "@vaettir/core";
import { z } from "zod";
import { lockCaseFieldProject } from "./caseFields.js";
import { caseFieldReadPinFields, pairedCaseFieldReadPins, caseFieldReadScopeSchema, lockCaseFieldReadScope, lockCurrentCaseFieldActor, type CaseFieldReadAuthorization } from "./caseFieldReadScope.js";
import { qualityProfileHash, qualityProfileRecord, readQualityExperience } from "./qualityExperienceProfile.js";

const id = z.string().min(1).max(200), hash = z.string().regex(/^[a-f0-9]{64}$/);
export const casePresentationGetInput = z.object({ projectId: id, ...caseFieldReadPinFields }).strict().superRefine(pairedCaseFieldReadPins);
export const casePresentationConfigureInput = z.object({ projectId: id, originalOrganizationId: id, expectedClerkActorId: id, expectedProfileHash: hash, configuration: casePresentationSchema, requestId: z.string().uuid(), confirmed: z.literal(true), reason: z.string().trim().min(1).max(1000) }).strict();
export const casePresentationStateOutput = z.object({ projectId: id, organizationId: id, caseId: z.null(), readScope: caseFieldReadScopeSchema, profileHash: hash, configuration: casePresentationSchema.nullable(), defaults: casePresentationSchema, canConfigure: z.boolean() });
export const casePresentationWriteOutput = z.object({ projectId: id, organizationId: id, actorClerkUserId: id, requestId: z.string().uuid(), replayed: z.boolean() });

export function mergeCasePresentation(profile: unknown, configuration: z.infer<typeof casePresentationSchema>) {
  return { ...qualityProfileRecord(profile), casePresentation: casePresentationSchema.parse(configuration) };
}
export function casePresentationRequestHash(input: z.infer<typeof casePresentationConfigureInput>) {
  return qualityProfileHash(casePresentationConfigureInput.parse(input));
}
async function state(tx: Prisma.TransactionClient, userId: string, projectId: string, readScope: z.infer<typeof caseFieldReadScopeSchema>) {
  const [size] = await tx.$queryRaw<Array<{ bytes: number }>>`SELECT octet_length("qualityProfile"::text)::int AS bytes FROM "Project" WHERE id=${projectId} AND "organizationId"=${readScope.organizationId}`;
  if (!size || size.bytes > 262144) throw new TRPCError({ code: "BAD_REQUEST", message: "The saved project profile exceeds the bounded presentation-settings read. Existing values were not replaced." });
  const project = await tx.project.findUniqueOrThrow({ where: { id: projectId }, select: { qualityProfile: true } });
  const raw = qualityProfileRecord(project.qualityProfile);
  const parsed = raw.casePresentation === undefined ? null : casePresentationSchema.safeParse(raw.casePresentation);
  if (parsed && !parsed.success) throw new TRPCError({ code: "BAD_REQUEST", message: "Saved built-in field preferences are unsupported. They were retained, not reset." });
  const member = await tx.membership.findUniqueOrThrow({ where: { organizationId_userId: { organizationId: readScope.organizationId, userId } }, select: { role: true, seatType: true } });
  return { projectId, organizationId: readScope.organizationId, caseId: null, readScope, profileHash: qualityProfileHash(raw), configuration: parsed?.success ? parsed.data : null, defaults: defaultCasePresentation(readQualityExperience(raw).experience), canConfigure: member.seatType === "FULL" && ["OWNER", "ADMIN"].includes(member.role), raw };
}
export async function getCasePresentation(db: PrismaClient, userId: string, input: z.infer<typeof casePresentationGetInput>, authorized: CaseFieldReadAuthorization) {
  return db.$transaction(async tx => {
    const readScope = await lockCaseFieldReadScope(tx, userId, input, authorized);
    const { raw: _raw, ...result } = await state(tx, userId, input.projectId, readScope);
    return result;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 10000, maxWait: 5000 });
}
export async function configureCasePresentation(db: PrismaClient, userId: string, input: z.infer<typeof casePresentationConfigureInput>, authorized: CaseFieldReadAuthorization) {
  const parsed = casePresentationConfigureInput.parse(input), requestHash = casePresentationRequestHash(parsed);
  return db.$transaction(async tx => {
    await tx.$executeRaw(Prisma.sql`SET LOCAL statement_timeout='8000ms'`);
    await lockCaseFieldProject(tx, userId, parsed.projectId);
    const actorClerkUserId = await lockCurrentCaseFieldActor(tx, userId, authorized);
    const project = await tx.project.findUniqueOrThrow({ where: { id: parsed.projectId }, select: { organizationId: true } });
    if (project.organizationId !== parsed.originalOrganizationId || actorClerkUserId !== parsed.expectedClerkActorId) throw new TRPCError({ code: "FORBIDDEN", message: "Restore the original signed-in account and project before retrying field preferences." });
    const readScope = { projectId: parsed.projectId, organizationId: project.organizationId, actorId: userId, actorClerkUserId };
    const member = await tx.membership.findUniqueOrThrow({ where: { organizationId_userId: { organizationId: project.organizationId, userId } }, select: { role: true, seatType: true } });
    if (member.seatType !== "FULL" || !["OWNER", "ADMIN"].includes(member.role)) throw new TRPCError({ code: "FORBIDDEN", message: "Current full Owner/Admin access is required to configure built-in fields." });
    // Admission uses current locked scope before private receipt lookup. A later
    // unsupported/oversized profile must not trap an already accepted exact ACK.
    const receipt = await tx.auditLog.findFirst({ where: { projectId: parsed.projectId, actorId: userId, entityType: "CasePresentationWrite", entityId: parsed.requestId }, select: { organizationId: true, metadata: true } });
    if (receipt) {
      const saved = z.object({ requestHash: hash }).safeParse(receipt.metadata);
      if (receipt.organizationId !== project.organizationId) throw new TRPCError({ code: "FORBIDDEN", message: "This preference receipt belongs to the former organization." });
      if (!saved.success || saved.data.requestHash !== requestHash) throw new TRPCError({ code: "CONFLICT", message: "Retry the original preference request without changing its content." });
      return { ...readScope, requestId: parsed.requestId, replayed: true };
    }
    const current = await state(tx, userId, parsed.projectId, readScope);
    if (current.profileHash !== parsed.expectedProfileHash) throw new TRPCError({ code: "CONFLICT", message: "Project context changed. Your field-preference draft remains retained; review the current context before saving." });
    const merged = mergeCasePresentation(current.raw, parsed.configuration);
    const [mergedSize] = await tx.$queryRaw<Array<{ bytes: number }>>`SELECT octet_length(${JSON.stringify(merged)}::jsonb::text)::int AS bytes`;
    if (!mergedSize || mergedSize.bytes > 262144) throw new TRPCError({ code: "BAD_REQUEST", message: "The merged project profile exceeds the presentation-settings read limit. Nothing was saved or removed." });
    const written = await tx.project.updateMany({ where: { id: parsed.projectId, organizationId: project.organizationId, qualityProfile: { equals: current.raw as Prisma.InputJsonValue } }, data: { qualityProfile: merged as Prisma.InputJsonObject } });
    if (written.count !== 1) throw new TRPCError({ code: "CONFLICT", message: "Project context changed before saving. No case values were changed." });
    await tx.auditLog.create({ data: { organizationId: project.organizationId, projectId: parsed.projectId, actorId: userId, entityType: "CasePresentationWrite", entityId: parsed.requestId, action: "UPDATE", summary: "Configured built-in case field presentation", metadata: { mode: "PRESENTATION_ONLY", requestHash, reason: parsed.reason, before: current.configuration, after: parsed.configuration, beforeProfileHash: current.profileHash, afterProfileHash: qualityProfileHash(merged) } } });
    return { ...readScope, requestId: parsed.requestId, replayed: false };
  }, { timeout: 10000, maxWait: 5000 });
}
