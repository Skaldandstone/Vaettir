import { createHash, randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { Prisma, type PrismaClient } from "@vaettir/db";
import { z } from "zod";
import { lockCaseFieldProject } from "./caseFields.js";
import { lockCaseFieldReadScope, lockCurrentCaseFieldActor, caseFieldReadScopeSchema, pairedCaseFieldReadPins, type CaseFieldReadAuthorization } from "./caseFieldReadScope.js";
import { testCaseContentRevision } from "./testCaseContentRevision.js";
import { sharedLibraryStepSchema } from "./sharedStepHistorySchema.js";
import { caseFieldPresentationJsonBytes } from "./caseFieldPresentationSchema.js";

const id = z.string().min(1).max(200), priority = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export const casePriorityInput = z.object({
  projectId: id, caseId: id, priority,
  expectedCaseRevision: z.string().regex(/^[a-f0-9]{64}$/),
  requestId: z.string().uuid(),
  originalOrganizationId: id, expectedClerkActorId: id,
}).strict();
// Preserve the original inner payload/order/hash. Native intent is additive.
export const casePriorityReviewedInput = z.object({ input: casePriorityInput, expectedNativeActorId: id }).strict();
export const casePriorityPreviewInput = z.object({ projectId: id, caseId: id, requestId: z.string().uuid(), originalOrganizationId: id.optional(), expectedClerkActorId: id.optional(), expectedNativeActorId: id.optional() }).strict().superRefine(pairedCaseFieldReadPins);
export const casePriorityLegacyOutput = z.object({ priority, replayed: z.boolean(), requestId: z.string().uuid() });
export const casePriorityAck = casePriorityLegacyOutput.extend({ projectId: id, caseId: id, requestHash: z.string().regex(/^[a-f0-9]{64}$/), readScope: caseFieldReadScopeSchema }).strict();
export const casePriorityPreviewOutput = z.object({ projectId: id, caseId: id, requestId: z.string().uuid(), readScope: caseFieldReadScopeSchema, priority, caseRevision: z.string().regex(/^[a-f0-9]{64}$/).nullable(), canChange: z.boolean(), canRecover: z.boolean(), blockedReason: z.string().max(1000).nullable() }).strict();
export const casePriorityRequestHash = (input: z.infer<typeof casePriorityInput>) => createHash("sha256").update(JSON.stringify(input)).digest("hex");
const options = { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 10000, maxWait: 5000 };
const refused = () => new TRPCError({ code: "PRECONDITION_FAILED", message: "This complete priority-change snapshot cannot be represented within supported native bounds. No case fields, verification metadata or history were replaced." });
type PriorityScope = z.infer<typeof caseFieldReadScopeSchema>;
type Ref = { projectId: string; caseId: string };

/** Caller already holds current native scope + case lock. No unrelated custom
 * fields/AI snapshots or field definitions enter this priority-only projection. */
async function boundedPriorityState(tx: Prisma.TransactionClient, ref: Ref) {
  const [relationships] = await tx.$queryRaw<Array<{ foreignShared: boolean; missingShared: boolean }>>`
    SELECT EXISTS(SELECT 1 FROM "SharedStepGroup" g WHERE g.id=c."sharedStepGroupId" AND g."projectId"<>c."projectId") AS "foreignShared",
      (c."sharedStepGroupId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "SharedStepGroup" g WHERE g.id=c."sharedStepGroupId")) AS "missingShared"
    FROM "TestCase" c WHERE c.id=${ref.caseId} AND c."projectId"=${ref.projectId}`;
  if (!relationships) throw new TRPCError({ code: "NOT_FOUND", message: "Case not found in this project." });
  if (relationships.foreignShared) throw new TRPCError({ code: "FORBIDDEN", message: "The retained shared procedure does not belong to this project." });
  if (relationships.missingShared) throw refused();
  // Count-only projection holds the native library stable without loading it.
  await tx.$queryRaw`SELECT count(*)::bigint FROM (SELECT 1 FROM "SharedStepGroup" g JOIN "TestCase" c ON c."sharedStepGroupId"=g.id WHERE c.id=${ref.caseId} AND c."projectId"=${ref.projectId} AND g."projectId"=${ref.projectId} FOR SHARE OF g) locked`;
  const [size] = await tx.$queryRaw<Array<{ baseBytes: bigint; bytes: bigint; steps: bigint; sharedSteps: number }>>`
    SELECT octet_length(concat(c.id,c."projectId",c.title,c.background,c.given::text,c."when"::text,c."then"::text,c.tags::text,c."suitePath",c."testPlanId",c."sharedStepGroupId",c."validationDomain"::text,c.priority::text,c."testType"::text,c."verificationProfile"::text))::bigint AS "baseBytes",
      (octet_length(concat(c.id,c."projectId",c.title,c.background,c.given::text,c."when"::text,c."then"::text,c.tags::text,c."suitePath",c."testPlanId",c."sharedStepGroupId",c."validationDomain"::text,c.priority::text,c."testType"::text,c."verificationProfile"::text))
        + coalesce((SELECT sum(octet_length(to_jsonb(s)::text)) FROM "TestCaseStep" s WHERE s."testCaseId"=c.id),0)
        + coalesce((SELECT octet_length(g.steps::text) FROM "SharedStepGroup" g WHERE g.id=c."sharedStepGroupId"),0))::bigint AS bytes,
      (SELECT count(*)::bigint FROM "TestCaseStep" s WHERE s."testCaseId"=c.id) AS steps,
      coalesce((SELECT CASE WHEN jsonb_typeof(g.steps)='array' THEN jsonb_array_length(g.steps) ELSE 501 END FROM "SharedStepGroup" g WHERE g.id=c."sharedStepGroupId"),0) AS "sharedSteps"
    FROM "TestCase" c WHERE c.id=${ref.caseId} AND c."projectId"=${ref.projectId}`;
  if (!size || typeof size.bytes !== "bigint" || typeof size.baseBytes !== "bigint" || typeof size.steps !== "bigint" || size.baseBytes < 0n || size.bytes < size.baseBytes || size.bytes > 524288n || size.steps < 0n || size.steps > 500n || !Number.isInteger(size.sharedSteps) || size.sharedSteps < 0 || size.sharedSteps > 500) throw refused();
  // Parent case lock + bounded child locks and RR freeze the complete source.
  await tx.$queryRaw`SELECT count(*)::bigint FROM (SELECT 1 FROM "TestCaseStep" WHERE "testCaseId"=${ref.caseId} ORDER BY "order" LIMIT 501 FOR SHARE) locked`;
  const current = await tx.testCase.findFirstOrThrow({ where: { id: ref.caseId, projectId: ref.projectId }, select: {
    id: true, projectId: true, title: true, background: true, given: true, when: true, then: true, tags: true, testType: true, priority: true, suitePath: true, testPlanId: true, validationDomain: true, verificationProfile: true, archived: true, sharedStepGroupId: true,
    steps: { orderBy: { order: "asc" }, select: { id: true, testCaseId: true, order: true, action: true, expectedActionOrData: true, expectedResult: true, expectedResponse: true, mediaAttachmentIds: true } },
    sharedStepGroup: { select: { id: true, projectId: true, steps: true } },
  } });
  if (current.steps.length !== Number(size.steps) || current.sharedStepGroup && current.sharedStepGroup.projectId !== ref.projectId) throw refused();
  let profileText: string, sharedText: string;
  try {
    // Structure admission before canonical/hash recursion or stringification.
    for (const value of [current.verificationProfile, current.sharedStepGroup?.steps ?? null])
      if (caseFieldPresentationJsonBytes(value) > 524288) throw refused();
    if (caseFieldPresentationJsonBytes(current) > 524288) throw refused();
    profileText = JSON.stringify(current.verificationProfile);
    sharedText = JSON.stringify(current.sharedStepGroup?.steps ?? null);
  } catch { throw refused(); }
  // Distinguishes native JSON null from SQL NULL and detects decoded precision
  // loss. Shared raw JSON is checked before legacy effective-step normalization.
  const [exact] = await tx.$queryRaw<Array<{ profileExact: boolean; sharedExact: boolean }>>`
    SELECT (c."verificationProfile" IS NOT DISTINCT FROM ${profileText}::jsonb) AS "profileExact",
      (c."sharedStepGroupId" IS NULL OR g.steps IS NOT DISTINCT FROM ${sharedText}::jsonb) AS "sharedExact"
    FROM "TestCase" c LEFT JOIN "SharedStepGroup" g ON g.id=c."sharedStepGroupId" AND g."projectId"=c."projectId"
    WHERE c.id=${ref.caseId} AND c."projectId"=${ref.projectId}`;
  if (exact?.profileExact !== true || exact.sharedExact !== true) throw refused();
  let frozenSteps: Array<{ order: number; action: string; expectedActionOrData: string | null; expectedResult: string | null; expectedResponse: string | null; mediaAttachmentIds: string[] }>;
  try {
    frozenSteps = current.sharedStepGroup ? z.array(sharedLibraryStepSchema).max(500).parse(current.sharedStepGroup.steps).map(step => ({ ...step, expectedActionOrData: step.expectedActionOrData ?? null, expectedResult: step.expectedResult ?? null, expectedResponse: step.expectedResponse ?? null, mediaAttachmentIds: step.mediaAttachmentIds ?? [] })) : current.steps.map(step => ({ order: step.order, action: step.action, expectedActionOrData: step.expectedActionOrData, expectedResult: step.expectedResult, expectedResponse: step.expectedResponse, mediaAttachmentIds: [...step.mediaAttachmentIds] }));
    if (current.sharedStepGroup && (!Array.isArray(current.sharedStepGroup.steps) || current.sharedStepGroup.steps.length !== size.sharedSteps || !frozenSteps.every((step, index) => step.order === index))) throw refused();
    if (caseFieldPresentationJsonBytes(frozenSteps) > 524288) throw refused();
  } catch { throw refused(); }
  const frozenText = JSON.stringify(frozenSteps);
  const [frozenSize] = await tx.$queryRaw<Array<{ bytes: bigint }>>`SELECT octet_length(${frozenText}::jsonb::text)::bigint AS bytes`;
  if (!frozenSize || typeof frozenSize.bytes !== "bigint" || frozenSize.bytes < 0n || size.baseBytes + frozenSize.bytes > 524288n) throw refused();
  return { current, frozenText, caseRevision: testCaseContentRevision(current) };
}

export async function previewCasePriority(db: PrismaClient, userId: string, input: z.input<typeof casePriorityPreviewInput>, authorized: CaseFieldReadAuthorization) {
  const parsed = casePriorityPreviewInput.parse(input);
  return db.$transaction(async tx => {
    const readScope = await lockCaseFieldReadScope(tx, userId, { ...parsed, caseId: parsed.caseId }, authorized);
    if (parsed.expectedNativeActorId !== undefined && parsed.expectedNativeActorId !== readScope.actorId) throw new TRPCError({ code: "FORBIDDEN", message: "Restore the original native priority author before reviewing or recovering this decision." });
    const membership = await tx.membership.findUniqueOrThrow({ where: { organizationId_userId: { organizationId: readScope.organizationId, userId } }, select: { role: true, seatType: true } });
    const identity = await tx.testCase.findFirstOrThrow({ where: { id: parsed.caseId, projectId: parsed.projectId }, select: { priority: true, archived: true } });
    const canRecover = membership.seatType === "FULL" && ["OWNER", "ADMIN", "EDITOR"].includes(membership.role);
    const base = { projectId: parsed.projectId, caseId: parsed.caseId, requestId: parsed.requestId, readScope, priority: identity.priority, canRecover };
    if (!canRecover || identity.archived) return { ...base, canChange: false, caseRevision: null, blockedReason: identity.archived ? "Restore this archived case before starting a new priority decision. Existing exact requests remain recoverable by their original full editor." : "A current full editor seat is required to change priority." };
    try { const state = await boundedPriorityState(tx, parsed); return { ...base, canChange: true, caseRevision: state.caseRevision, blockedReason: null }; }
    catch (cause) { if (cause instanceof TRPCError && cause.code === "PRECONDITION_FAILED") return { ...base, canChange: false, caseRevision: null, blockedReason: cause.message }; throw cause; }
  }, options);
}

async function nextPriorityVersion(tx: Prisma.TransactionClient, ref: Ref) {
  const last = await tx.testCaseVersion.findFirst({ where: { testCaseId: ref.caseId }, orderBy: { versionNumber: "desc" }, select: { versionNumber: true } });
  const versionNumber = (last?.versionNumber ?? 0) + 1;
  if (!Number.isSafeInteger(versionNumber) || versionNumber > 2147483647 || versionNumber < 1) throw refused();
  return versionNumber;
}
async function snapshotPriorityVersion(tx: Prisma.TransactionClient, ref: Ref, userId: string, frozenText: string, versionNumber: number) {
  // Native column copy preserves JSON null and unknown/numeric profile siblings.
  // Existing effective steps/version fields stay unchanged; this is NOT a new
  // complete custom-field, placement, prerequisite or approval snapshot.
  const rows = await tx.$queryRaw<Array<{ id: string; versionNumber: number }>>`
    INSERT INTO "TestCaseVersion" (id,"testCaseId","versionNumber",title,background,given,"when","then",steps,tags,priority,"testType","validationDomain","verificationProfile","createdById","createdAt")
    SELECT ${randomUUID()},c.id,${versionNumber},c.title,c.background,c.given,c."when",c."then",${frozenText}::jsonb,c.tags,c.priority,c."testType",c."validationDomain",c."verificationProfile",${userId},CURRENT_TIMESTAMP
    FROM "TestCase" c WHERE c.id=${ref.caseId} AND c."projectId"=${ref.projectId}
    RETURNING id,"versionNumber"`;
  if (rows.length !== 1 || rows[0]?.versionNumber !== versionNumber) throw refused();
}

export async function setCasePriority(db: PrismaClient, userId: string, input: z.input<typeof casePriorityInput>, authorized: CaseFieldReadAuthorization, expectedNativeActorId?: string) {
  const parsed = casePriorityInput.parse(input), requestHash = casePriorityRequestHash(parsed);
  return db.$transaction(async tx => {
    await tx.$executeRaw(Prisma.sql`SET LOCAL statement_timeout = '8000ms'`);
    await lockCaseFieldProject(tx, userId, parsed.projectId);
    const actorClerkUserId = await lockCurrentCaseFieldActor(tx, userId, authorized);
    const project = await tx.project.findUniqueOrThrow({ where: { id: parsed.projectId }, select: { organizationId: true } });
    if (project.organizationId !== parsed.originalOrganizationId || actorClerkUserId !== parsed.expectedClerkActorId || expectedNativeActorId !== undefined && userId !== expectedNativeActorId) throw new TRPCError({ code: "FORBIDDEN", message: "Restore the original signed-in native author and workspace before retrying this priority decision." });
    const readScope: PriorityScope = caseFieldReadScopeSchema.parse({ projectId: parsed.projectId, organizationId: project.organizationId, actorId: userId, actorClerkUserId });
    const ack = (value: z.infer<typeof priority>, replayed: boolean) => ({ priority: value, replayed, requestId: parsed.requestId, requestHash, readScope, projectId: parsed.projectId, caseId: parsed.caseId });
    // Exact prior receipt recovery precedes current case/profile/procedure reads.
    const receipt = await tx.auditLog.findFirst({ where: { projectId: parsed.projectId, actorId: userId, entityType: "TestCasePriority", entityId: parsed.caseId, metadata: { path: ["requestId"], equals: parsed.requestId } }, select: { metadata: true, organizationId: true } });
    if (receipt) {
      const saved = z.object({ requestHash: z.string(), to: casePriorityInput.shape.priority }).safeParse(receipt.metadata);
      if (receipt.organizationId !== project.organizationId) throw new TRPCError({ code: "FORBIDDEN", message: "This retained priority receipt belongs to its original organization." });
      if (!saved.success || saved.data.requestHash !== requestHash) throw new TRPCError({ code: "CONFLICT", message: "This priority request already has different content. Retry the original decision." });
      return ack(saved.data.to, true);
    }
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "TestCase" WHERE id=${parsed.caseId} AND "projectId"=${parsed.projectId} FOR UPDATE`;
    if (rows.length !== 1) throw new TRPCError({ code: "NOT_FOUND", message: "Case not found in this project." });
    const { current, frozenText, caseRevision } = await boundedPriorityState(tx, parsed);
    if (caseRevision !== parsed.expectedCaseRevision) throw new TRPCError({ code: "CONFLICT", message: "This case changed since it was opened. Refresh before setting priority." });
    if (current.archived) throw new TRPCError({ code: "BAD_REQUEST", message: "Restore the archived case before changing its priority." });
    const versionNumber = await nextPriorityVersion(tx, parsed);
    await tx.testCase.update({ where: { id: current.id }, data: { priority: parsed.priority, updatedById: userId }, select: { id: true } });
    await snapshotPriorityVersion(tx, parsed, userId, frozenText, versionNumber);
    await tx.auditLog.create({ data: { organizationId: project.organizationId, projectId: parsed.projectId, actorId: userId, entityType: "TestCasePriority", entityId: current.id, action: "UPDATE", summary: `Set case priority ${parsed.priority}`, metadata: { mode: "MANUAL", from: current.priority, to: parsed.priority, requestId: parsed.requestId, requestHash } } });
    return ack(parsed.priority, false);
  }, options);
}
