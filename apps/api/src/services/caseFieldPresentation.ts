import { Prisma, type PrismaClient } from "@vaettir/db";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { caseFieldSchema } from "./caseFieldSchema.js";
import { lockCaseFieldProject, caseFieldAuthoringSchemaHash } from "./caseFields.js";
import { caseFieldReadPinFields, pairedCaseFieldReadPins, caseFieldReadScopeSchema, lockCaseFieldReadScope, lockCurrentCaseFieldActor, type CaseFieldReadAuthorization } from "./caseFieldReadScope.js";
import { qualityProfileHash } from "./qualityExperienceProfile.js";
import { caseFieldPresentationSchema, caseFieldPresentationJsonBytes, caseFieldPresentationWriteProblems, readCaseFieldPresentation, mergeCaseFieldPresentation } from "./caseFieldPresentationSchema.js";

const id = z.string().min(1).max(200), hash = z.string().regex(/^[a-f0-9]{64}$/);
export const caseFieldPresentationGetInput = z.object({ projectId: id, ...caseFieldReadPinFields }).strict().superRefine(pairedCaseFieldReadPins);
export const caseFieldPresentationConfigureInput = z.object({ projectId: id, originalOrganizationId: id, expectedClerkActorId: id, expectedProfileHash: hash, expectedFieldSchemaHash: hash, configuration: caseFieldPresentationSchema, requestId: z.string().uuid(), confirmed: z.literal(true), reason: z.string().trim().min(1).max(1000) }).strict();
/** Validate the whitelist without trimming native labels or changing the raw
 * snapshot. Hashes are computed separately on raw native data before parsing. */
const rawDefinitionSnapshot = z.unknown().superRefine((value, ctx) => {
  const parsed = caseFieldSchema.safeParse(value);
  if (!parsed.success) ctx.addIssue({ code: "custom", message: "Native field definitions are unsupported." });
}).transform(value => value as z.infer<typeof caseFieldSchema>);
export const caseFieldPresentationStateOutput = z.object({ projectId: id, organizationId: id, caseId: z.null(), readScope: caseFieldReadScopeSchema, profileHash: hash, fieldSchemaHash: hash, fieldAuthoringSchemaHash: hash.nullable(), definitionSchema: rawDefinitionSnapshot.nullable(), definitionSchemaVersion: z.number().int().nonnegative(), definitionSupported: z.boolean(), configuration: caseFieldPresentationSchema.optional(), configurationSupported: z.boolean(), canConfigure: z.boolean(), warnings: z.array(z.string().max(1000)).max(5) }).strict();
export const caseFieldPresentationWriteOutput = z.object({ projectId: id, organizationId: id, actorClerkUserId: id, requestId: z.string().uuid(), replayed: z.boolean() }).strict();
type ReadScope = z.infer<typeof caseFieldReadScopeSchema>;
const unavailable = () => new TRPCError({ code: "BAD_REQUEST", message: "Saved project context or field definitions exceed supported presentation bounds. Existing settings and values were not replaced." });
export function caseFieldPresentationRequestHash(input: z.infer<typeof caseFieldPresentationConfigureInput>) { return qualityProfileHash(caseFieldPresentationConfigureInput.parse(input)); }
export function caseFieldPresentationDefinitionHash(projectId: string, organizationId: string, actorId: string, actorClerkUserId: string, version: number, rawSchema: unknown) { return qualityProfileHash({ kind: "CaseFieldPresentationNativeSchema/v1", projectId, organizationId, actorId, actorClerkUserId, version, schema: rawSchema }); }

async function snapshot(tx: Prisma.TransactionClient, userId: string, projectId: string, readScope: ReadScope) {
  const [size] = await tx.$queryRaw<Array<{ profileBytes: number; schemaBytes: number }>>`SELECT octet_length("qualityProfile"::text)::int AS "profileBytes",octet_length("caseFieldSchema"::text)::int AS "schemaBytes" FROM "Project" WHERE id=${projectId} AND "organizationId"=${readScope.organizationId}`;
  if (!size || size.profileBytes > 262144 || size.schemaBytes > 32768) throw unavailable();
  const project = await tx.project.findUniqueOrThrow({ where: { id: projectId }, select: { qualityProfile: true, caseFieldSchema: true, caseFieldSchemaVersion: true } });
  if (!Number.isSafeInteger(project.caseFieldSchemaVersion) || project.caseFieldSchemaVersion < 0) throw unavailable();
  // Native JSON may still be a malformed future/legacy shape. Bound its safe
  // structure before hashing/parsing; never fabricate an empty profile.
  try { caseFieldPresentationJsonBytes(project.qualityProfile); caseFieldPresentationJsonBytes(project.caseFieldSchema); }
  catch { throw unavailable(); }
  if (!project.qualityProfile || typeof project.qualityProfile !== "object" || Array.isArray(project.qualityProfile)) throw unavailable();
  const profileHash = qualityProfileHash(project.qualityProfile);
  const fieldSchemaHash = caseFieldPresentationDefinitionHash(projectId, readScope.organizationId, userId, readScope.actorClerkUserId, project.caseFieldSchemaVersion, project.caseFieldSchema);
  const definition = caseFieldSchema.safeParse(project.caseFieldSchema);
  const presentation = readCaseFieldPresentation(project.qualityProfile);
  const nativeDefinitions = definition.success ? project.caseFieldSchema as z.infer<typeof caseFieldSchema> : null;
  const problems = presentation.configuration && nativeDefinitions ? caseFieldPresentationWriteProblems(presentation.configuration, nativeDefinitions.fields, presentation.configuration) : [];
  const member = await tx.membership.findUniqueOrThrow({ where: { organizationId_userId: { organizationId: readScope.organizationId, userId } }, select: { role: true, seatType: true } });
  const warnings = !definition.success || presentation.warning || problems.length ? ["Some saved field definitions or presentation settings are unsupported. Native values and saved settings remain unchanged; use compatible native controls for retained metadata."] : [];
  return {
    public: { projectId, organizationId: readScope.organizationId, caseId: null, readScope, profileHash, fieldSchemaHash, fieldAuthoringSchemaHash: definition.success ? caseFieldAuthoringSchemaHash({ projectId, organizationId: readScope.organizationId, version: project.caseFieldSchemaVersion, schema: definition.data }, userId, readScope.actorClerkUserId) : null, definitionSchema: nativeDefinitions, definitionSchemaVersion: project.caseFieldSchemaVersion, definitionSupported: definition.success, ...(presentation.configuration ? { configuration: presentation.configuration } : {}), configurationSupported: definition.success && !presentation.warning && problems.length === 0, canConfigure: member.seatType === "FULL" && ["OWNER", "ADMIN"].includes(member.role), warnings },
    rawProfile: project.qualityProfile, rawSchema: project.caseFieldSchema,
  };
}
export async function getCaseFieldPresentation(db: PrismaClient, userId: string, raw: z.infer<typeof caseFieldPresentationGetInput>, authorized: CaseFieldReadAuthorization) {
  const input = caseFieldPresentationGetInput.parse(raw);
  return db.$transaction(async tx => {
    const scope = await lockCaseFieldReadScope(tx, userId, input, authorized);
    const state = await snapshot(tx, userId, input.projectId, scope);
    return caseFieldPresentationStateOutput.parse(state.public);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 10000, maxWait: 5000 });
}
export async function configureCaseFieldPresentation(db: PrismaClient, userId: string, raw: z.infer<typeof caseFieldPresentationConfigureInput>, authorized: CaseFieldReadAuthorization) {
  const input = caseFieldPresentationConfigureInput.parse(raw), requestHash = caseFieldPresentationRequestHash(input);
  return db.$transaction(async tx => {
    await tx.$executeRaw(Prisma.sql`SET LOCAL statement_timeout='8000ms'`);
    await lockCaseFieldProject(tx, userId, input.projectId);
    const actorClerkUserId = await lockCurrentCaseFieldActor(tx, userId, authorized);
    const project = await tx.project.findUniqueOrThrow({ where: { id: input.projectId }, select: { organizationId: true } });
    if (project.organizationId !== input.originalOrganizationId || actorClerkUserId !== input.expectedClerkActorId) throw new TRPCError({ code: "FORBIDDEN", message: "Restore the original signed-in account and organization before retrying field presentation." });
    const member = await tx.membership.findUniqueOrThrow({ where: { organizationId_userId: { organizationId: project.organizationId, userId } }, select: { role: true, seatType: true } });
    if (member.seatType !== "FULL" || !["OWNER", "ADMIN"].includes(member.role)) throw new TRPCError({ code: "FORBIDDEN", message: "Current full Owner/Admin access is required for field presentation settings." });
    // Project lock serializes writers. Current role/scope admission precedes this
    // identity/digest-only projection, never another tenant's private receipt body.
    const receipts = await tx.$queryRaw<Array<{ organizationId: string | null; requestHash: string | null }>>`SELECT CASE WHEN length("organizationId") BETWEEN 1 AND 200 AND octet_length("organizationId")<=800 THEN "organizationId" ELSE NULL END AS "organizationId",CASE WHEN jsonb_typeof(metadata->'requestHash')='string' AND length(metadata->>'requestHash')=64 AND octet_length(metadata->>'requestHash')=64 AND (metadata->>'requestHash') ~ '^[a-f0-9]{64}$' THEN metadata->>'requestHash' ELSE NULL END AS "requestHash" FROM "AuditLog" WHERE "projectId"=${input.projectId} AND "actorId"=${userId} AND "entityType"='CaseFieldPresentationWrite' AND "entityId"=${input.requestId} LIMIT 2`;
    if (receipts.length) {
      if (receipts.some(receipt => receipt.organizationId !== project.organizationId)) throw new TRPCError({ code: "FORBIDDEN", message: "This presentation receipt belongs to another original organization." });
      if (receipts.length !== 1 || receipts[0]!.requestHash !== requestHash) throw new TRPCError({ code: "CONFLICT", message: "Retry the exact original presentation request; its UUID cannot approve replacement content." });
      return caseFieldPresentationWriteOutput.parse({ projectId: input.projectId, organizationId: project.organizationId, actorClerkUserId, requestId: input.requestId, replayed: true });
    }
    const readScope = { projectId: input.projectId, organizationId: project.organizationId, actorId: userId, actorClerkUserId };
    const current = await snapshot(tx, userId, input.projectId, readScope);
    if (current.public.profileHash !== input.expectedProfileHash || current.public.fieldSchemaHash !== input.expectedFieldSchemaHash) throw new TRPCError({ code: "CONFLICT", message: "Project context or native field definitions changed. The presentation draft remains retained; review current snapshots before a new save." });
    if (!current.public.definitionSupported || !current.public.definitionSchema) throw unavailable();
    let merged: ReturnType<typeof mergeCaseFieldPresentation>;
    try { merged = mergeCaseFieldPresentation(current.rawProfile, input.configuration, current.public.definitionSchema.fields); }
    catch { throw new TRPCError({ code: "BAD_REQUEST", message: "Presentation is incompatible with retained definitions/settings or exceeds supported bounds. Nothing was reset, removed or saved." }); }
    const [nativeSize] = await tx.$queryRaw<Array<{ siblingBytes: number; mergedBytes: number }>>`SELECT octet_length(${JSON.stringify(input.configuration)}::jsonb::text)::int AS "siblingBytes",octet_length(${JSON.stringify(merged)}::jsonb::text)::int AS "mergedBytes"`;
    if (!nativeSize || nativeSize.siblingBytes > 32768 || nativeSize.mergedBytes > 262144) throw unavailable();
    const updated = await tx.project.updateMany({ where: { id: input.projectId, organizationId: project.organizationId, qualityProfile: { equals: current.rawProfile as Prisma.InputJsonValue }, caseFieldSchema: { equals: current.rawSchema as Prisma.InputJsonValue }, caseFieldSchemaVersion: current.public.definitionSchemaVersion }, data: { qualityProfile: merged as Prisma.InputJsonObject } });
    if (updated.count !== 1) throw new TRPCError({ code: "CONFLICT", message: "Native field definitions or project context changed before saving. No presentation receipt was created." });
    await tx.auditLog.create({ data: { organizationId: project.organizationId, projectId: input.projectId, actorId: userId, entityType: "CaseFieldPresentationWrite", entityId: input.requestId, action: "UPDATE", summary: "Configured reviewed native case field presentation", metadata: { version: 1, mode: "PRESENTATION_ONLY", requestHash, reason: input.reason, before: current.public.configuration ?? null, after: input.configuration, beforeProfileHash: current.public.profileHash, afterProfileHash: qualityProfileHash(merged), fieldSchemaHash: current.public.fieldSchemaHash, fieldSchemaVersion: current.public.definitionSchemaVersion } } });
    return caseFieldPresentationWriteOutput.parse({ projectId: input.projectId, organizationId: project.organizationId, actorClerkUserId, requestId: input.requestId, replayed: false });
  }, { timeout: 10000, maxWait: 5000 });
}
