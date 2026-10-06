import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { Prisma, type PrismaClient } from "@vaettir/db";
import { z } from "zod";
import { lockCaseFieldProject } from "./caseFields.js";
import { lockCaseFieldReadScope, lockCurrentCaseFieldActor, type CaseFieldReadAuthorization } from "./caseFieldReadScope.js";
import { caseFieldPresentationJsonBytes } from "./caseFieldPresentationSchema.js";
import { sharedLibraryStepSchema } from "./sharedStepHistorySchema.js";
import { reviewReadInput, reviewPreviewInput, reviewPageInput, reviewPageOutput, reviewMetadata, reviewDecisionInput, reviewSnapshotSchema, reviewSnapshotHashes, reviewRequestHash, reviewDecisionOutput } from "./caseReviewSchema.js";

const options = { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 10000, maxWait: 5000 };
const unsupported = () => new TRPCError({ code: "PRECONDITION_FAILED", message: "This case has retained material outside the supported complete review projection. Nothing was omitted, truncated, repaired or approved. Exact previously accepted requests remain recoverable." });
type Tx = Prisma.TransactionClient;
type Pins = z.infer<typeof reviewReadInput>;
async function readScope(tx: Tx, userId: string, input: Pins & { caseId?: string }, authorized: CaseFieldReadAuthorization) {
  const scope = await lockCaseFieldReadScope(tx, userId, input, authorized);
  if (input.expectedNativeActorId !== undefined && input.expectedNativeActorId !== scope.actorId) throw new TRPCError({ code: "FORBIDDEN", message: "Restore the original native reviewer. This request was not rebound." });
  const member = await tx.membership.findUniqueOrThrow({ where: { organizationId_userId: { organizationId: scope.organizationId, userId } }, select: { role: true, seatType: true } });
  return { scope, canRecover: member.seatType === "FULL" && ["OWNER", "ADMIN", "EDITOR"].includes(member.role) };
}
export async function readCaseReviewAccess(db: PrismaClient, userId: string, raw: z.input<typeof reviewReadInput>, authorized: CaseFieldReadAuthorization) {
  const input = reviewReadInput.parse(raw);
  return db.$transaction(async tx => { const access = await readScope(tx, userId, input, authorized); return { projectId: input.projectId, requestId: input.requestId, readScope: access.scope, canRecover: access.canRecover }; }, options);
}
async function queuePopulation(tx: Tx, projectId: string) {
  const [size] = await tx.$queryRaw<Array<{ count: bigint; bytes: bigint; unsupported: boolean }>>`
    SELECT count(*)::bigint AS count,coalesce(sum(octet_length(concat(c.id,c."displayId",c.title,c.confidence::text,s."filePath"))),0)::bigint AS bytes,
      coalesce(bool_or(length(c.id)>200 OR length(c."displayId")>200 OR length(c.title)>4000 OR coalesce(length(s."filePath"),0)>4000),false) AS unsupported
    FROM "TestCase" c LEFT JOIN "TestCaseSource" s ON s."testCaseId"=c.id
    WHERE c."projectId"=${projectId} AND c.archived=false AND c."reviewStatus"='PENDING_REVIEW'`;
  if (!size || typeof size.count !== "bigint" || typeof size.bytes !== "bigint" || size.count < 0n || size.count > 1000000n || size.bytes < 0n || size.bytes > 16777216n || size.unsupported !== false) throw unsupported();
  return Number(size.count);
}
export async function countCaseReviewQueue(db: PrismaClient, userId: string, raw: z.input<typeof reviewReadInput>, authorized: CaseFieldReadAuthorization) {
  const input = reviewReadInput.parse(raw);
  return db.$transaction(async tx => { const access = await readScope(tx, userId, input, authorized); return { projectId: input.projectId, requestId: input.requestId, readScope: access.scope, canRecover: access.canRecover, totalPending: await queuePopulation(tx, input.projectId) }; }, options);
}
export async function pageCaseReviewQueue(db: PrismaClient, userId: string, raw: z.input<typeof reviewPageInput>, authorized: CaseFieldReadAuthorization) {
  const input = reviewPageInput.parse(raw);
  return db.$transaction(async tx => {
    const access = await readScope(tx, userId, input, authorized), totalPending = await queuePopulation(tx, input.projectId);
    // Native population digest after whole metadata admission. SQL text is bound,
    // not assembled from a user sort/search. OFFSET never implies hidden selection.
    const search = Prisma.sql`AND (${input.search}='' OR strpos(lower(c.title),lower(${input.search}))>0 OR strpos(lower(c."displayId"),lower(${input.search}))>0 OR strpos(lower(coalesce(s."filePath",'')),lower(${input.search}))>0)`;
    const [population] = await tx.$queryRaw<Array<{ digest: string; count: bigint }>>(Prisma.sql`
      SELECT md5(coalesce(string_agg(md5(jsonb_build_array(c.id,c."caseNumber",c."displayId",c.title,c.confidence,s."filePath")::text),'' ORDER BY c.id),'')) AS digest,count(*)::bigint AS count
      FROM "TestCase" c LEFT JOIN "TestCaseSource" s ON s."testCaseId"=c.id WHERE c."projectId"=${input.projectId} AND c.archived=false AND c."reviewStatus"='PENDING_REVIEW' ${search}`);
    if (!population || typeof population.count !== "bigint" || population.count < 0n || population.count > BigInt(totalPending) || !/^[a-f0-9]{32}$/.test(population.digest)) throw unsupported();
    const populationHash = createHash("sha256").update(JSON.stringify([access.scope,input.search,input.sort,totalPending,population.digest])).digest("hex");
    if (input.populationHash && input.populationHash !== populationHash) throw new TRPCError({ code: "CONFLICT", message: "The pending queue changed. Return to the first page; no cases were selected or reviewed." });
    if (input.offset>Number(population.count)) throw new TRPCError({code:"CONFLICT",message:"This cursor is outside the current pending population. Return to the first page."});
    const order = input.sort === "confidence" ? Prisma.sql`c.confidence ASC NULLS LAST,c.id ASC` : input.sort === "case-id" ? Prisma.sql`c."caseNumber" ASC,c.id ASC` : Prisma.sql`c.title COLLATE "C" ASC,c.id ASC`;
    const rows = await tx.$queryRaw<Array<z.infer<typeof reviewMetadata>>>(Prisma.sql`SELECT c.id,c."displayId",c.title,c.confidence,s."filePath" AS "sourceFilePath"
      FROM "TestCase" c LEFT JOIN "TestCaseSource" s ON s."testCaseId"=c.id WHERE c."projectId"=${input.projectId} AND c.archived=false AND c."reviewStatus"='PENDING_REVIEW' ${search}
      ORDER BY ${order} LIMIT 25 OFFSET ${input.offset}`);
    if(rows.length!==Math.min(25,Number(population.count)-input.offset)) throw unsupported();
    try { return reviewPageOutput.parse({ projectId: input.projectId, requestId: input.requestId, readScope: access.scope, canRecover: access.canRecover, items: rows, totalPending, matching: Number(population.count), populationHash, offset: input.offset, nextOffset: input.offset + rows.length < Number(population.count) ? input.offset + 25 : null }); }
    catch { throw unsupported(); }
  }, options);
}

// Exact native projection: unrelated paid bodies never enter the admission or
// hashes. Retained relationships not represented here refuse NEW decisions.
function snapshotProjection(projectId: string, caseId: string) {
  return Prisma.sql`SELECT jsonb_build_object('kind','CaseReviewSnapshot/v1',
    'case',jsonb_build_object('id',c.id,'projectId',c."projectId",'displayId',c."displayId",'title',c.title,'background',c.background,'given',c.given,'when',c."when",'then',c."then",'tags',c.tags,'priority',c.priority,'testType',c."testType",'automationStatus',c."automationStatus",'validationDomain',c."validationDomain",'verificationProfile',c."verificationProfile",'verificationProfileSqlNull',c."verificationProfile" IS NULL,'customFields',c."customFields",'customFieldsSqlNull',c."customFields" IS NULL,'caseFieldSchemaVersion',c."caseFieldSchemaVersion",'suitePath',c."suitePath",'sortPosition',c."sortPosition",'sharedStepGroupId',c."sharedStepGroupId"),
    'authoredSteps',coalesce((SELECT jsonb_agg(jsonb_build_object('order',s."order",'action',s.action,'expectedActionOrData',s."expectedActionOrData",'expectedResult',s."expectedResult",'expectedResponse',s."expectedResponse",'mediaAttachmentIds',s."mediaAttachmentIds") ORDER BY s."order",s.id) FROM "TestCaseStep" s WHERE s."testCaseId"=c.id),'[]'::jsonb),
    'effectiveSteps',CASE WHEN g.id IS NULL THEN coalesce((SELECT jsonb_agg(jsonb_build_object('order',s."order",'action',s.action,'expectedActionOrData',s."expectedActionOrData",'expectedResult',s."expectedResult",'expectedResponse',s."expectedResponse",'mediaAttachmentIds',s."mediaAttachmentIds") ORDER BY s."order",s.id) FROM "TestCaseStep" s WHERE s."testCaseId"=c.id),'[]'::jsonb) ELSE g.steps END,
    'sharedProcedure',CASE WHEN g.id IS NULL THEN NULL ELSE jsonb_build_object('id',g.id,'name',g.name,'description',g.description,'revision',g.revision,'archivedAt',g."archivedAt",'steps',g.steps) END,
    'prerequisites',coalesce((SELECT jsonb_agg(jsonb_build_object('id',r.id,'displayId',r."displayId",'title',r.title,'status',r."reviewStatus",'archived',r.archived) ORDER BY r.id) FROM "TestCasePrerequisite" e JOIN "TestCase" r ON r.id=e."prerequisiteId" AND r."projectId"=c."projectId" WHERE e."dependentId"=c.id AND e."projectId"=c."projectId"),'[]'::jsonb),
    'context',jsonb_build_object('fieldSchema',p."caseFieldSchema",'fieldSchemaSqlNull',p."caseFieldSchema" IS NULL,'fieldSchemaVersion',p."caseFieldSchemaVersion",'projectQualityProfile',p."qualityProfile",'projectQualityProfileSqlNull',p."qualityProfile" IS NULL),
    'source',CASE WHEN src.id IS NULL THEN NULL ELSE to_jsonb(src)||jsonb_build_object('importSnapshotSqlNull',src."importSnapshot" IS NULL) END,
    'aiBaseline',jsonb_build_object('value',c."aiSnapshot",'sqlNull',c."aiSnapshot" IS NULL),
    'state',jsonb_build_object('status',c."reviewStatus",'archived',c.archived,'reviewedById',c."reviewedById",'reviewedAt',c."reviewedAt",'note',c."reviewNote",'origin',c.origin,'confidence',c.confidence)) AS snapshot
    FROM "TestCase" c JOIN "Project" p ON p.id=c."projectId" LEFT JOIN "SharedStepGroup" g ON g.id=c."sharedStepGroupId" AND g."projectId"=c."projectId" LEFT JOIN "TestCaseSource" src ON src."testCaseId"=c.id WHERE c.id=${caseId} AND c."projectId"=${projectId}`;
}
async function supportedSnapshot(tx: Tx, projectId: string, caseId: string) {
  const [links] = await tx.$queryRaw<Array<{ foreign: boolean; unsupported: boolean; missing: boolean }>>`
    SELECT (EXISTS(SELECT 1 FROM "SharedStepGroup" g WHERE g.id=c."sharedStepGroupId" AND g."projectId"<>c."projectId") OR EXISTS(SELECT 1 FROM "TestCasePrerequisite" e LEFT JOIN "TestCase" r ON r.id=e."prerequisiteId" WHERE e."dependentId"=c.id AND (e."projectId"<>c."projectId" OR r."projectId"<>c."projectId"))) AS foreign,
      (c."testPlanId" IS NOT NULL OR c."testPlanTypeId" IS NOT NULL OR EXISTS(SELECT 1 FROM "TestCaseDataset" d WHERE d."testCaseId"=c.id) OR EXISTS(SELECT 1 FROM "TestCaseAttachment" a WHERE a."testCaseId"=c.id) OR EXISTS(SELECT 1 FROM "TestCaseComplianceControl" m WHERE m."testCaseId"=c.id) OR EXISTS(SELECT 1 FROM "ComplianceEvidence" v WHERE v."testCaseId"=c.id) OR EXISTS(SELECT 1 FROM "CaseTraceabilityLink" l WHERE l."caseId"=c.id) OR EXISTS(SELECT 1 FROM "TestCaseStep" s WHERE s."testCaseId"=c.id AND cardinality(s."mediaAttachmentIds")>0)) AS unsupported,
      ((c."sharedStepGroupId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "SharedStepGroup" g WHERE g.id=c."sharedStepGroupId")) OR EXISTS(SELECT 1 FROM "TestCasePrerequisite" e WHERE e."dependentId"=c.id AND NOT EXISTS(SELECT 1 FROM "TestCase" r WHERE r.id=e."prerequisiteId"))) AS missing
    FROM "TestCase" c WHERE c.id=${caseId} AND c."projectId"=${projectId}`;
  if (!links) throw new TRPCError({ code: "NOT_FOUND", message: "Case not found in this project." });
  if (links.foreign) throw new TRPCError({ code: "FORBIDDEN", message: "Retained case relationships do not belong to this project." });
  if (links.unsupported || links.missing) throw unsupported();
  // Refuse giant collections before constructing a native JSON aggregate. The
  // final complete projection has its own stricter 512KiB admission below.
  const [rawSize] = await tx.$queryRaw<Array<{ bytes: bigint; steps: bigint; prerequisites: bigint; sharedSteps: number }>>`
    SELECT (octet_length(concat(c.id,c."projectId",c."displayId",c.title,c.background,c.given::text,c."when"::text,c."then"::text,c.tags::text,c.priority,c."testType",c."automationStatus",c."validationDomain",c."verificationProfile"::text,c."customFields"::text,c."aiSnapshot"::text,c."suitePath",c."sortPosition",c."caseFieldSchemaVersion",c."reviewStatus",c."reviewedById",c."reviewedAt",c."reviewNote",c.origin,c.confidence))::bigint+coalesce(octet_length(p."caseFieldSchema"::text),0)+coalesce(octet_length(p."qualityProfile"::text),0)
      +coalesce((SELECT sum(octet_length(to_jsonb(s)::text)) FROM "TestCaseStep" s WHERE s."testCaseId"=c.id),0)+coalesce(octet_length(to_jsonb(g)::text),0)+coalesce(octet_length(to_jsonb(src)::text),0)
      +coalesce((SELECT sum(octet_length(concat(r.id,r."displayId",r.title,r."reviewStatus",r.archived))) FROM "TestCasePrerequisite" e JOIN "TestCase" r ON r.id=e."prerequisiteId" AND r."projectId"=c."projectId" WHERE e."dependentId"=c.id AND e."projectId"=c."projectId"),0))::bigint AS bytes,
      (SELECT count(*)::bigint FROM "TestCaseStep" s WHERE s."testCaseId"=c.id) AS steps,(SELECT count(*)::bigint FROM "TestCasePrerequisite" e WHERE e."dependentId"=c.id) AS prerequisites,
      CASE WHEN g.id IS NULL THEN 0 WHEN jsonb_typeof(g.steps)='array' THEN jsonb_array_length(g.steps) ELSE 501 END AS "sharedSteps"
    FROM "TestCase" c JOIN "Project" p ON p.id=c."projectId" LEFT JOIN "SharedStepGroup" g ON g.id=c."sharedStepGroupId" AND g."projectId"=c."projectId" LEFT JOIN "TestCaseSource" src ON src."testCaseId"=c.id WHERE c.id=${caseId} AND c."projectId"=${projectId}`;
  if (!rawSize || [rawSize.bytes,rawSize.steps,rawSize.prerequisites].some(value => typeof value !== "bigint" || value<0n) || rawSize.bytes>524288n || rawSize.steps>500n || rawSize.prerequisites>50n || !Number.isInteger(rawSize.sharedSteps) || rawSize.sharedSteps<0 || rawSize.sharedSteps>500) throw unsupported();
  const [size] = await tx.$queryRaw<Array<{ bytes: bigint; customBytes: bigint; definitionBytes: bigint; steps: bigint; prerequisites: bigint; sharedSteps: number }>>(Prisma.sql`
    SELECT octet_length(q.snapshot::text)::bigint AS bytes,
      octet_length((q.snapshot->'case'->'customFields')::text)::bigint AS "customBytes",
      octet_length((q.snapshot->'context')::text)::bigint AS "definitionBytes",
      (SELECT count(*)::bigint FROM "TestCaseStep" s WHERE s."testCaseId"=${caseId}) AS steps,
      (SELECT count(*)::bigint FROM "TestCasePrerequisite" e WHERE e."dependentId"=${caseId}) AS prerequisites,
      CASE WHEN jsonb_typeof(q.snapshot->'effectiveSteps')='array' THEN jsonb_array_length(q.snapshot->'effectiveSteps') ELSE 501 END AS "sharedSteps"
    FROM (${snapshotProjection(projectId,caseId)}) q`);
  if (!size || [size.bytes,size.customBytes,size.definitionBytes,size.steps,size.prerequisites].some(value => typeof value !== "bigint" || value < 0n) || size.bytes > 524288n || size.customBytes > 65536n || size.definitionBytes > 32768n || size.steps > 500n || size.prerequisites > 50n || !Number.isInteger(size.sharedSteps) || size.sharedSteps < 0 || size.sharedSteps > 500) throw unsupported();
  // RR snapshot plus row locks for actual case/procedure/context writers. No
  // body is returned until complete native byte/count admission above.
  await tx.$queryRaw`SELECT count(*)::bigint FROM (SELECT 1 FROM "TestCaseStep" WHERE "testCaseId"=${caseId} LIMIT 501 FOR SHARE) locked`;
  await tx.$queryRaw`SELECT count(*)::bigint FROM (SELECT 1 FROM "SharedStepGroup" g JOIN "TestCase" c ON c."sharedStepGroupId"=g.id WHERE c.id=${caseId} AND g."projectId"=${projectId} FOR SHARE OF g) locked`;
  await tx.$queryRaw`SELECT count(*)::bigint FROM (SELECT 1 FROM "TestCasePrerequisite" e JOIN "TestCase" r ON r.id=e."prerequisiteId" WHERE e."dependentId"=${caseId} AND e."projectId"=${projectId} AND r."projectId"=${projectId} LIMIT 51 FOR SHARE OF e,r) locked`;
  await tx.$queryRaw`SELECT count(*)::bigint FROM (SELECT 1 FROM "TestCaseSource" WHERE "testCaseId"=${caseId} FOR SHARE) locked`;
  const [row] = await tx.$queryRaw<Array<{ snapshot: unknown }>>(snapshotProjection(projectId,caseId));
  let snapshot: z.infer<typeof reviewSnapshotSchema>;
  try {
    if (caseFieldPresentationJsonBytes(row?.snapshot) > 524288) throw unsupported();
    snapshot = reviewSnapshotSchema.parse(row?.snapshot);
    const effective = z.array(sharedLibraryStepSchema).max(500).parse(snapshot.effectiveSteps);
    if (effective.some((step,index) => step.order !== index || (step.mediaAttachmentIds?.length ?? 0)>0)) throw unsupported();
    if (!Array.isArray(snapshot.authoredSteps) || snapshot.authoredSteps.length !== Number(size.steps) || !Array.isArray(snapshot.prerequisites) || snapshot.prerequisites.length !== Number(size.prerequisites)) throw unsupported();
  } catch { throw unsupported(); }
  const encoded = JSON.stringify(snapshot);
  const [exact] = await tx.$queryRaw<Array<{ exact: boolean; bytes: bigint }>>(Prisma.sql`SELECT (q.snapshot IS NOT DISTINCT FROM ${encoded}::jsonb) AS exact,octet_length(${encoded}::jsonb::text)::bigint AS bytes FROM (${snapshotProjection(projectId,caseId)}) q`);
  if (exact?.exact !== true || typeof exact.bytes !== "bigint" || exact.bytes < 0n || exact.bytes > 524288n) throw unsupported();
  return { snapshot, ...reviewSnapshotHashes(snapshot) };
}
export async function previewCaseReview(db: PrismaClient, userId: string, raw: z.input<typeof reviewPreviewInput>, authorized: CaseFieldReadAuthorization) {
  const input = reviewPreviewInput.parse(raw);
  return db.$transaction(async tx => {
    const access = await readScope(tx,userId,input,authorized), base = { projectId: input.projectId,caseId: input.caseId,requestId: input.requestId,readScope: access.scope,canRecover: access.canRecover };
    try {
      const state = await supportedSnapshot(tx,input.projectId,input.caseId), canDecide = access.canRecover && !state.snapshot.state.archived && state.snapshot.state.status === "PENDING_REVIEW";
      return { ...base,...state,supported: true,canDecide,blockedReason: canDecide ? null : "Only a current full editor may decide an active pending case. Existing approvals and rejected cases were not reopened." };
    } catch (cause) { if (cause instanceof TRPCError && cause.code === "PRECONDITION_FAILED") return { ...base,supported: false,canDecide: false,snapshot: null,contentHash: null,reviewStateHash: null,blockedReason: cause.message }; throw cause; }
  },options);
}
export async function decideCaseReview(db: PrismaClient, userId: string, raw: z.input<typeof reviewDecisionInput>, authorized: CaseFieldReadAuthorization) {
  const input = reviewDecisionInput.parse(raw), requestHash = reviewRequestHash(input);
  return db.$transaction(async tx => {
    await tx.$executeRaw(Prisma.sql`SET LOCAL statement_timeout = '8000ms'`);
    await lockCaseFieldProject(tx,userId,input.projectId);
    const actorClerkUserId = await lockCurrentCaseFieldActor(tx,userId,authorized), project = await tx.project.findUniqueOrThrow({ where: { id: input.projectId },select: { organizationId: true } });
    if (project.organizationId !== input.originalOrganizationId || actorClerkUserId !== input.expectedClerkActorId || userId !== input.expectedNativeActorId) throw new TRPCError({ code: "FORBIDDEN",message: "Restore the original full native reviewer and workspace before retrying this decision." });
    const scope = { projectId: input.projectId,organizationId: project.organizationId,actorId: userId,actorClerkUserId };
    const ack = (replayed: boolean) => reviewDecisionOutput.parse({ projectId: input.projectId,caseId: input.caseId,requestId: input.requestId,requestHash,decision: input.decision,replayed,readScope: scope });
    // UUID recovery is current-authorized and bounded before NEW snapshot caps.
    const receipts = await tx.$queryRaw<Array<{ organizationId: string; requestHash: string | null; decision: string | null }>>`
      SELECT "organizationId",CASE WHEN length(metadata->>'requestHash')=64 THEN metadata->>'requestHash' ELSE NULL END AS "requestHash",CASE WHEN metadata->>'decision' IN ('APPROVED','REJECTED') THEN metadata->>'decision' ELSE NULL END AS decision
      FROM "AuditLog" WHERE "projectId"=${input.projectId} AND "actorId"=${userId} AND "entityType"='CaseReviewDecision/v1' AND "entityId"=${input.caseId} AND metadata->>'requestId'=${input.requestId} LIMIT 2`;
    if (receipts.length) {
      if (receipts.length !== 1 || receipts[0]!.organizationId !== scope.organizationId) throw new TRPCError({ code: "FORBIDDEN",message: "The retained review receipt cannot be recovered in this original scope." });
      if (receipts[0]!.requestHash !== requestHash || receipts[0]!.decision !== input.decision) throw new TRPCError({ code: "CONFLICT",message: "This UUID already has a different review decision. Recover its exact original request." });
      return ack(true);
    }
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "TestCase" WHERE id=${input.caseId} AND "projectId"=${input.projectId} FOR UPDATE`;
    if (rows.length !== 1) throw new TRPCError({ code: "NOT_FOUND",message: "Case not found in this project." });
    const state = await supportedSnapshot(tx,input.projectId,input.caseId);
    if (state.contentHash !== input.expectedContentHash || state.reviewStateHash !== input.expectedReviewStateHash) throw new TRPCError({ code: "CONFLICT",message: "The shown case content, context or trust state changed. Keep your decision and explicitly review the new snapshot." });
    if (state.snapshot.state.archived || state.snapshot.state.status !== "PENDING_REVIEW") throw new TRPCError({ code: "PRECONDITION_FAILED",message: "Only an active pending case can receive a new decision. No approved, rejected or archived case was re-reviewed." });
    const changed = await tx.testCase.updateMany({ where: { id: input.caseId,projectId: input.projectId,archived: false,reviewStatus: "PENDING_REVIEW" },data: { reviewStatus: input.decision,reviewedById: userId,reviewedAt: new Date(),...(input.note.operation === "KEEP" ? {} : { reviewNote: input.note.operation === "CLEAR" ? null : input.note.value }),updatedById: userId } });
    if (changed.count !== 1) throw new TRPCError({ code: "CONFLICT",message: "The pending case changed. Nothing was partially reviewed." });
    await tx.auditLog.create({ data: { organizationId: scope.organizationId,projectId: input.projectId,actorId: userId,entityType: "CaseReviewDecision/v1",entityId: input.caseId,action: "UPDATE",summary: `Case review ${input.decision}`,metadata: { requestId: input.requestId,requestHash,decision: input.decision,expectedContentHash: input.expectedContentHash,expectedReviewStateHash: input.expectedReviewStateHash,noteOperation: input.note.operation } } });
    return ack(false);
  },options);
}
