import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { Prisma, type PrismaClient } from "@vaettir/db";
import { z } from "zod";
import { lockManualRetestAccess } from "./manualRetestScope.js";
import { qualityProfileHash, runCaseDefinitionSchema } from "./qualityExperienceProfile.js";
import { aggregateStepStatus, savedStepEvidenceSchema, safeEvidenceFileName } from "./manualStepExecution.js";
import { caseFieldPresentationJsonBytes } from "./caseFieldPresentationSchema.js";
import { reviewedStepAckSchema, reviewedStepCurrentSchema, reviewedStepObservationsSchema, reviewedStepPreviewInputSchema, reviewedStepPreviewOutputSchema, reviewedStepScopeSchema, reviewedStepStatusSchema, reviewedStepWriteInputSchema, reviewedStepWriteKey, type ReviewedStepPreviewInput, type ReviewedStepWriteInput } from "./manualStepExecutionReviewSchema.js";

const refused = () => new TRPCError({ code: "PRECONDITION_FAILED", message: "The complete frozen procedure or observations are unsupported within native bounds. No evidence was truncated, normalized or replaced." });
const conflict = () => new TRPCError({ code: "CONFLICT", message: "The reviewed step baseline or exact request changed. Keep the original request and explicitly review current evidence." });
const options = { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 20000, maxWait: 5000 };
type Actor = { id: string; clerkUserId: string };
type Ref = Pick<ReviewedStepPreviewInput, "projectId" | "testRunId" | "testCaseId" | "stepIndex" | "originalOrganizationId" | "expectedClerkActorId" | "expectedNativeActorId">;
export const reviewedStepRequestHash = (input: ReviewedStepWriteInput) => createHash("sha256").update(reviewedStepWriteKey(input)).digest("hex");
/** Preserve the old normalized hash recipe; never apply it as the outer review. */
export function reviewedStepLegacyHash(input: ReviewedStepWriteInput) {
  return qualityProfileHash({ testCaseId: input.testCaseId, stepIndex: input.stepIndex, status: input.status,
    note: input.note?.trim() || null, observations: { ...input.observations, specimen: input.observations.specimen.trim(), hardwareRevision: input.observations.hardwareRevision.trim(), firmwareVersion: input.observations.firmwareVersion.trim(), environment: input.observations.environment.trim(), measurements: input.observations.measurements.map(m => ({ ...m, name: m.name.trim(), unit: m.unit.trim(), instrument: m.instrument.trim() })) },
    evidenceAttachmentIds: [...input.evidenceAttachmentIds].sort(), expectedRevisionId: input.expectedRevisionId, correctionReason: input.correctionReason?.trim() || null });
}
async function access(tx: Prisma.TransactionClient, actor: Actor, ref: Ref, write: boolean) {
  const scoped = await lockManualRetestAccess(tx, actor.id, { projectId: ref.projectId, sourceRunId: ref.testRunId, testCaseId: ref.testCaseId,
    ...(ref.originalOrganizationId === undefined ? {} : { expectedScope: { projectId: ref.projectId, organizationId: ref.originalOrganizationId, clerkActorId: ref.expectedClerkActorId! } }) }, write, actor.clerkUserId, write);
  if (ref.expectedNativeActorId !== undefined && ref.expectedNativeActorId !== actor.id) throw new TRPCError({ code: "FORBIDDEN", message: "Restore the original native step author. The retained request was not rebound." });
  const parsedScope = reviewedStepScopeSchema.safeParse({ projectId: scoped.projectId, organizationId: scoped.organizationId, actorId: scoped.actorId, actorClerkUserId: scoped.clerkActorId });
  if (!parsedScope.success) throw refused();
  const scope = parsedScope.data;
  // Identity-only run lock precedes receipts; no later JSON/status cap blocks a
  // successful reviewed receipt. Native actor is already rechecked under locks.
  const [run] = await tx.$queryRaw<Array<{ projectId: string; status: string; provider: string }>>(Prisma.sql`SELECT "projectId",status::text AS status,left("ciProvider",200) AS provider FROM "TestRun" WHERE id=${ref.testRunId} ${write ? Prisma.sql`FOR UPDATE` : Prisma.sql`FOR SHARE`}`);
  if (!run || run.projectId !== ref.projectId) throw new TRPCError({ code: "NOT_FOUND", message: "Manual execution is unavailable in this original project." });
  const member = await tx.membership.findUniqueOrThrow({ where: { organizationId_userId: { organizationId: scope.organizationId, userId: actor.id } }, select: { role: true, seatType: true } });
  return { scope, run, canRecover: member.seatType === "FULL" && ["OWNER", "ADMIN", "EDITOR"].includes(member.role) };
}
const frozenStep = z.object({ order: z.number().int().min(0).max(499), action: z.string().min(1).max(10000), expectedActionOrData: z.string().max(10000).nullable(), expectedResult: z.string().max(10000).nullable(), expectedResponse: z.string().max(10000).nullable(), mediaAttachmentIds: z.array(z.string().min(1).max(200)).max(100) }).strict();
const frozenCase = runCaseDefinitionSchema.extend({ steps: z.array(frozenStep).min(1).max(500) }).passthrough();
/** All cardinality, coordinate and byte admission happens in SQL before bodies. */
async function state(tx: Prisma.TransactionClient, ref: Ref) {
  const [size] = await tx.$queryRaw<Array<{ runBytes: bigint; executionBytes: bigint; scopeBytes: bigint; graphBytes: bigint; graphKeys: bigint; graphEdges: bigint; invalidGraph: boolean; cases: number; uniqueCases: bigint; definitions: number; steps: bigint; maxSteps: number; invalid: boolean; foreign: boolean }>>`
    SELECT octet_length(to_jsonb(r)::text)::bigint AS "runBytes",octet_length(r."executionContext"::text)::bigint AS "executionBytes",octet_length(r."manualTestCaseIds"::text)::bigint AS "scopeBytes",octet_length(r."manualPrerequisites"::text)::bigint AS "graphBytes",cardinality(r."manualTestCaseIds")::int AS cases,
      (SELECT count(*) FROM jsonb_object_keys(CASE WHEN jsonb_typeof(r."manualPrerequisites")='object' THEN r."manualPrerequisites" ELSE '{}'::jsonb END)) AS "graphKeys",
      (SELECT coalesce(sum(CASE WHEN jsonb_typeof(g.value)='array' THEN jsonb_array_length(g.value) ELSE 1001 END),0)::bigint FROM jsonb_each(CASE WHEN jsonb_typeof(r."manualPrerequisites")='object' THEN r."manualPrerequisites" ELSE '{}'::jsonb END) g) AS "graphEdges",
      EXISTS(SELECT 1 FROM jsonb_each(CASE WHEN jsonb_typeof(r."manualPrerequisites")='object' THEN r."manualPrerequisites" ELSE '{}'::jsonb END) g WHERE g.key<>ALL(r."manualTestCaseIds") OR jsonb_typeof(g.value)<>'array' OR EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(g.value)='array' THEN g.value ELSE '[]'::jsonb END) d WHERE jsonb_typeof(d)<>'string' OR (d#>>'{}')=g.key OR (d#>>'{}')<>ALL(r."manualTestCaseIds"))) AS "invalidGraph",
      (SELECT count(DISTINCT id) FROM unnest(r."manualTestCaseIds") id) AS "uniqueCases",
      CASE WHEN jsonb_typeof(r."executionContext"->'caseDefinitions')='array' THEN jsonb_array_length(r."executionContext"->'caseDefinitions') ELSE 1001 END AS definitions,
      coalesce((SELECT sum(CASE WHEN jsonb_typeof(d->'steps')='array' THEN jsonb_array_length(d->'steps') ELSE 501 END)::bigint FROM jsonb_array_elements(CASE WHEN jsonb_typeof(r."executionContext"->'caseDefinitions')='array' THEN r."executionContext"->'caseDefinitions' ELSE '[]'::jsonb END) d),0)::bigint AS steps,
      coalesce((SELECT max(CASE WHEN jsonb_typeof(d->'steps')='array' THEN jsonb_array_length(d->'steps') ELSE 501 END) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(r."executionContext"->'caseDefinitions')='array' THEN r."executionContext"->'caseDefinitions' ELSE '[]'::jsonb END) d),0)::int AS "maxSteps",
      EXISTS(SELECT 1 FROM unnest(r."manualTestCaseIds") id WHERE id IS NULL OR length(id)<1 OR length(id)>200) AS invalid,
      EXISTS(SELECT 1 FROM "TestCase" c WHERE c.id=ANY(r."manualTestCaseIds") AND c."projectId"<>${ref.projectId}) AS foreign
    FROM "TestRun" r WHERE r.id=${ref.testRunId} AND r."projectId"=${ref.projectId}`;
  if (!size || size.runBytes < 0n || size.runBytes > 4194304n || size.executionBytes < 0n || size.executionBytes > 2097152n || size.scopeBytes < 0n || size.scopeBytes > 524288n || size.graphBytes < 0n || size.graphBytes > 524288n || !Number.isInteger(size.cases) || size.cases < 1 || size.cases > 1000 || size.uniqueCases !== BigInt(size.cases) || size.definitions !== size.cases || size.graphKeys !== BigInt(size.cases) || size.graphEdges < 0n || size.graphEdges > 10000n || size.invalidGraph || size.steps < 0n || size.steps > 25000n || size.maxSteps < 0 || size.maxSteps > 500 || size.invalid || size.foreign) throw refused();
  const [nativeCase] = await tx.$queryRaw<Array<{ present: boolean }>>`SELECT EXISTS(SELECT 1 FROM "TestCase" WHERE id=${ref.testCaseId} AND "projectId"=${ref.projectId}) AS present`;
  if (nativeCase?.present !== true) throw refused();
  const [headsSize] = await tx.$queryRaw<Array<{ count: bigint; caseHeads: bigint; bytes: bigint; maxBytes: bigint; selectedBytes: bigint; invalid: boolean }>>`
    SELECT count(*) AS count,count(*) FILTER(WHERE h."testCaseId"=${ref.testCaseId}) AS "caseHeads",coalesce(sum(octet_length(to_jsonb(v)::text)),0)::bigint AS bytes,coalesce(max(octet_length(to_jsonb(v)::text)),0)::bigint AS "maxBytes",coalesce(sum(CASE WHEN h."testCaseId"=${ref.testCaseId} AND h."stepIndex"=${ref.stepIndex} THEN octet_length(to_jsonb(v)::text) ELSE 0 END),0)::bigint AS "selectedBytes",
      coalesce(bool_or(v.id IS NULL OR h."testCaseId"<>ALL(r."manualTestCaseIds") OR v."testRunId"<>h."testRunId" OR v."testCaseId"<>h."testCaseId" OR v."stepIndex"<>h."stepIndex" OR h."revisionCount"<>v."revisionNumber" OR h."revisionCount"<1 OR h."revisionCount">100 OR h."currentPayloadBytes"<1 OR h."currentPayloadBytes">4194304 OR v.status::text NOT IN ('PASS','FAIL','BLOCKED','SKIP') OR h."stepIndex"<0 OR h."stepIndex">499 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r."executionContext"->'caseDefinitions') d WHERE d->>'testCaseId'=h."testCaseId" AND jsonb_typeof(d->'steps')='array' AND h."stepIndex"<jsonb_array_length(d->'steps'))),false) AS invalid
    FROM "ManualStepResultHead" h JOIN "TestRun" r ON r.id=h."testRunId" LEFT JOIN "ManualStepResultRevision" v ON v.id=h."currentRevisionId" WHERE r.id=${ref.testRunId}`;
  if (!headsSize || headsSize.count < 0n || headsSize.count > 25000n || headsSize.caseHeads < 0n || headsSize.caseHeads > 500n || headsSize.bytes < 0n || headsSize.bytes > 4194304n || headsSize.maxBytes < 0n || headsSize.maxBytes > 262144n || headsSize.invalid) throw refused();
  const run = await tx.testRun.findUniqueOrThrow({ where: { id: ref.testRunId }, select: { id: true, projectId: true, manualTestCaseIds: true, manualPrerequisites: true, executionContext: true } });
  if (run.id !== ref.testRunId || run.projectId !== ref.projectId || run.manualTestCaseIds.length !== size.cases || !run.manualTestCaseIds.includes(ref.testCaseId)) throw refused();
  if (caseFieldPresentationJsonBytes(run.executionContext) > 2097152 || caseFieldPresentationJsonBytes(run.manualPrerequisites) > 524288) throw refused();
  const [exactRun] = await tx.$queryRaw<Array<{ exact: boolean }>>`SELECT ("executionContext" IS NOT DISTINCT FROM ${JSON.stringify(run.executionContext)}::jsonb AND "manualPrerequisites" IS NOT DISTINCT FROM ${JSON.stringify(run.manualPrerequisites)}::jsonb) AS exact FROM "TestRun" WHERE id=${ref.testRunId}`;
  if (exactRun?.exact !== true) throw refused();
  const raw = run.executionContext as { version?: unknown; caseDefinitions?: unknown[] };
  if (raw?.version !== 1 || !Array.isArray(raw.caseDefinitions) || raw.caseDefinitions.length !== size.definitions) throw refused();
  const definitions = raw.caseDefinitions.map(value => { const parsed = runCaseDefinitionSchema.passthrough().safeParse(value); if (!parsed.success) throw refused(); return parsed.data; });
  if (new Set(definitions.map(d => d.testCaseId)).size !== run.manualTestCaseIds.length || definitions.some(d => !run.manualTestCaseIds.includes(d.testCaseId))) throw refused();
  const definitionRaw = raw.caseDefinitions.find(value => !!value && typeof value === "object" && (value as { testCaseId?: unknown }).testCaseId === ref.testCaseId);
  const parsed = frozenCase.safeParse(definitionRaw);
  if (!parsed.success || ref.stepIndex >= parsed.data.steps.length || !parsed.data.steps.every((step, index) => step.order === index)) throw refused();
  const graphParsed = z.record(z.array(z.string().min(1).max(200)).max(1000)).safeParse(run.manualPrerequisites);
  if (!graphParsed.success || Object.keys(graphParsed.data).length !== run.manualTestCaseIds.length) throw refused();
  const graph = graphParsed.data;
  let edges = 0; for (const [id, dependencies] of Object.entries(graph)) { edges += dependencies.length; if (!run.manualTestCaseIds.includes(id) || new Set(dependencies).size !== dependencies.length || dependencies.some(dependency => dependency === id || !run.manualTestCaseIds.includes(dependency)) || edges > 10000) throw refused(); }
  const visited = new Set<string>(), visiting = new Set<string>();
  for (const root of run.manualTestCaseIds) {
    if (visited.has(root)) continue;
    const stack = [{ id: root, index: 0 }];
    while (stack.length) { const frame = stack[stack.length - 1]!; visiting.add(frame.id); const dependencies = graph[frame.id]; if (!dependencies) throw refused(); const next = dependencies[frame.index++]; if (next !== undefined) { if (visiting.has(next)) throw refused(); if (!visited.has(next)) stack.push({ id: next, index: 0 }); } else { stack.pop(); visiting.delete(frame.id); visited.add(frame.id); } }
  }
  const heads = await tx.manualStepResultHead.findMany({ where: { testRunId: ref.testRunId, testCaseId: ref.testCaseId }, include: { currentRevision: true } });
  if (BigInt(heads.length) !== headsSize.caseHeads || new Set(heads.map(h => h.stepIndex)).size !== heads.length || heads.some(h => h.testRunId !== ref.testRunId || h.testCaseId !== ref.testCaseId || h.stepIndex >= parsed.data.steps.length || h.stepIndex < 0 || !reviewedStepStatusSchema.safeParse(h.currentRevision.status).success || h.currentRevision.testRunId !== ref.testRunId || h.currentRevision.testCaseId !== ref.testCaseId || h.currentRevision.stepIndex !== h.stepIndex || h.currentRevision.revisionNumber !== h.revisionCount || h.revisionCount < 1 || h.revisionCount > 100 || !Number.isInteger(h.currentPayloadBytes) || h.currentPayloadBytes < 1 || h.currentPayloadBytes > 4194304)) throw refused();
  const revisionJson = (revision: typeof heads[number]["currentRevision"]) => {
    if (!(revision.recordedAt instanceof Date) || !Number.isFinite(revision.recordedAt.getTime())) throw refused();
    const timestamp = revision.recordedAt.toISOString();
    if (timestamp.length !== 24) throw refused();
    // An explicit complete JSON projection, not a relaxed Date-capable JSON
    // helper. Native equality below refuses precision/representation loss.
    return { ...revision, recordedAt: timestamp };
  };
  for (const h of heads) {
    const projection = revisionJson(h.currentRevision);
    if (caseFieldPresentationJsonBytes(projection) > 262144) throw refused();
    const [exact] = await tx.$queryRaw<Array<{ exact: boolean }>>`SELECT (observations IS NOT DISTINCT FROM ${JSON.stringify(h.currentRevision.observations)}::jsonb AND "evidenceAttachments" IS NOT DISTINCT FROM ${JSON.stringify(h.currentRevision.evidenceAttachments)}::jsonb AND "recordedAt" IS NOT DISTINCT FROM ${projection.recordedAt}::timestamp) AS exact FROM "ManualStepResultRevision" WHERE id=${h.currentRevisionId}`;
    if (exact?.exact !== true) throw refused();
  }
  const head = heads.find(h => h.stepIndex === ref.stepIndex), currentRaw = head?.currentRevision ?? null;
  let current = null;
  if (currentRaw) {
    const evidence = z.array(savedStepEvidenceSchema).max(20).safeParse(currentRaw.evidenceAttachments), observations = reviewedStepObservationsSchema.safeParse(currentRaw.observations);
    if (!evidence.success || !observations.success) throw refused();
    const result = reviewedStepCurrentSchema.safeParse({ id: currentRaw.id, status: currentRaw.status, note: currentRaw.note, observations: observations.data, evidenceAttachments: evidence.data.map(e => ({ id: e.id, fileName: e.fileName })), actorName: currentRaw.actorName, recordedAt: currentRaw.recordedAt, correctionReason: currentRaw.correctionReason, previousRevisionId: currentRaw.previousRevisionId, revisionNumber: currentRaw.revisionNumber });
    if (!result.success) throw refused(); current = result.data;
  }
  const [mode] = await tx.$queryRaw<Array<{ whole: bigint; results: bigint; bytes: bigint; unsupported: boolean }>>`SELECT (SELECT count(*) FROM "ManualCaseResultHead" WHERE "testRunId"=${ref.testRunId} AND "testCaseId"=${ref.testCaseId}) AS whole,(SELECT count(*) FROM "TestResult" WHERE "testRunId"=${ref.testRunId} AND "testCaseId"=${ref.testCaseId}) AS results,(SELECT coalesce(sum(octet_length(concat(id,note,observations::text))),0)::bigint FROM "TestResult" WHERE "testRunId"=${ref.testRunId} AND "testCaseId"=${ref.testCaseId}) AS bytes,EXISTS(SELECT 1 FROM "TestResult" WHERE "testRunId"=${ref.testRunId} AND "testCaseId"=${ref.testCaseId} AND status::text NOT IN ('PASS','FAIL','BLOCKED','SKIP')) AS unsupported`;
  if (!mode || mode.whole > 0n || mode.results > 1n || mode.bytes > 262144n || mode.unsupported || !heads.length && mode.results > 0n) throw refused();
  const previousComplete = parsed.data.steps.every((_, index) => heads.some(h => h.stepIndex === index));
  if ((mode.results === 1n) !== previousComplete) throw refused();
  if (mode.results === 1n) {
    const projection = await tx.testResult.findFirst({ where: { testRunId: ref.testRunId, testCaseId: ref.testCaseId }, select: { id: true, status: true, note: true, observations: true } });
    const status = aggregateStepStatus(parsed.data.steps.map((_, index) => heads.find(h => h.stepIndex === index)!.currentRevision.status));
    const note = `Derived from ${parsed.data.steps.length} recorded step outcomes. Per-step measurements and evidence remain on their immutable revisions.`;
    if (!projection || projection.status !== status || projection.note !== note || projection.observations === null || typeof projection.observations !== "object" || Array.isArray(projection.observations) || Object.keys(projection.observations).length) throw refused();
    const [exact] = await tx.$queryRaw<Array<{ exact: boolean }>>`SELECT observations IS NOT DISTINCT FROM '{}'::jsonb AS exact FROM "TestResult" WHERE id=${projection.id}`;
    if (exact?.exact !== true) throw refused();
  }
  return { run, graph, definition: definitionRaw, steps: parsed.data.steps, heads, head, current, rawCurrent: currentRaw,
    procedureHash: qualityProfileHash({ definition: definitionRaw, graph: run.manualPrerequisites, orderedCaseIds: run.manualTestCaseIds }), currentFingerprint: qualityProfileHash({ head: head ? { revisionId: head.currentRevisionId, revisionCount: head.revisionCount, payloadBytes: head.currentPayloadBytes } : null, revision: currentRaw ? revisionJson(currentRaw) : null }), totalBytes: headsSize.bytes, selectedBytes: headsSize.selectedBytes };
}
export async function previewReviewedStep(db: PrismaClient, actor: Actor, raw: ReviewedStepPreviewInput) {
  const input = reviewedStepPreviewInputSchema.parse(raw);
  return db.$transaction(async tx => {
    const admitted = await access(tx, actor, input, false);
    const base = { projectId: input.projectId, testRunId: input.testRunId, testCaseId: input.testCaseId, stepIndex: input.stepIndex, readRequestId: input.readRequestId, scope: admitted.scope, canRecover: admitted.canRecover, provenance: "CURRENT_AUTHORITY_LEGACY_ORIGINAL_TENANCY_UNRECORDED" as const };
    try { if (admitted.run.provider !== "manual") throw refused(); const value = await state(tx, input); return reviewedStepPreviewOutputSchema.parse({ ...base, supported: true, canRecord: admitted.canRecover && admitted.run.status === "RUNNING", blockedReason: admitted.run.status === "RUNNING" ? null : "Only exact prior receipts can be recovered after completion.", frozenDefinition: value.definition, current: value.current, rawCurrent: value.rawCurrent, procedureHash: value.procedureHash, currentFingerprint: value.currentFingerprint }); }
    catch (cause) { if (cause instanceof TRPCError && cause.code === "PRECONDITION_FAILED") return reviewedStepPreviewOutputSchema.parse({ ...base, supported: false, canRecord: false, blockedReason: cause.message, frozenDefinition: null, current: null, rawCurrent: null, procedureHash: null, currentFingerprint: null }); throw cause; }
  }, options);
}
export async function recordReviewedStep(db: PrismaClient, actor: Actor, raw: ReviewedStepWriteInput) {
  const input = reviewedStepWriteInputSchema.parse(raw), requestHash = reviewedStepRequestHash(input);
  if (caseFieldPresentationJsonBytes(input) > 262144) throw refused();
  return db.$transaction(async tx => {
    const admitted = await access(tx, actor, input, true);
    // AuditLog has no UUID uniqueness constraint. Serialize this actor's exact
    // reviewed UUID across different runs/projects before checking its receipt.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('ManualStepExecutionReview/v1'),hashtext(${qualityProfileHash({ actorId: actor.id, idempotencyKey: input.idempotencyKey })}))::text`;
    const [receiptSize] = await tx.$queryRaw<Array<{ count: bigint; bytes: bigint }>>`SELECT count(*) AS count,coalesce(sum(octet_length(metadata::text)),0)::bigint AS bytes FROM "AuditLog" WHERE "entityType"='ManualStepExecutionReview/v1' AND "actorId"=${actor.id} AND metadata->>'idempotencyKey'=${input.idempotencyKey}`;
    if (!receiptSize || receiptSize.count > 1n || receiptSize.bytes > 8192n) throw refused();
    const receipt = receiptSize.count ? await tx.auditLog.findFirst({ where: { actorId: actor.id, entityType: "ManualStepExecutionReview/v1", metadata: { path: ["idempotencyKey"], equals: input.idempotencyKey } }, select: { organizationId: true, projectId: true, entityId: true, metadata: true } }) : null;
    const ack = (revisionId: string, caseStatus: "PASS" | "FAIL" | "BLOCKED" | "SKIP" | null, recovered: boolean) => reviewedStepAckSchema.parse({ projectId: input.projectId, testRunId: input.testRunId, testCaseId: input.testCaseId, stepIndex: input.stepIndex, scope: admitted.scope, idempotencyKey: input.idempotencyKey, requestHash, revisionId, caseStatus, recovered, provenance: "REVIEWED_REQUEST_BOUND_AT_WRITE" });
    if (receipt) {
      const metadata = reviewedStepAckSchema.safeParse(receipt.metadata);
      if (!metadata.success || receipt.organizationId !== admitted.scope.organizationId || receipt.projectId !== input.projectId || receipt.entityId !== input.testRunId || metadata.data.requestHash !== requestHash || metadata.data.scope.projectId !== input.projectId || metadata.data.scope.organizationId !== admitted.scope.organizationId || metadata.data.scope.actorId !== actor.id || metadata.data.scope.actorClerkUserId !== actor.clerkUserId || metadata.data.projectId !== input.projectId || metadata.data.testRunId !== input.testRunId || metadata.data.idempotencyKey !== input.idempotencyKey || metadata.data.testCaseId !== input.testCaseId || metadata.data.stepIndex !== input.stepIndex) throw conflict();
      const retained = await tx.manualStepResultRevision.findFirst({ where: { id: metadata.data.revisionId, testRunId: input.testRunId, testCaseId: input.testCaseId, stepIndex: input.stepIndex, actorId: actor.id, idempotencyKey: input.idempotencyKey }, select: { id: true } });
      if (!retained) throw conflict(); return ack(retained.id, metadata.data.caseStatus, true);
    }
    // Legacy row UUIDs cannot be retroactively labelled reviewed/native-pinned.
    if (await tx.manualStepResultRevision.count({ where: { testRunId: input.testRunId, actorId: actor.id, idempotencyKey: input.idempotencyKey } })) throw new TRPCError({ code: "CONFLICT", message: "This UUID belongs to a legacy step receipt without reviewed original-actor provenance. Keep its legacy request; no new review or result was created." });
    if (admitted.run.provider !== "manual" || admitted.run.status !== "RUNNING") throw refused();
    const value = await state(tx, input);
    if (value.procedureHash !== input.expectedProcedureHash || value.currentFingerprint !== input.expectedCurrentFingerprint || (value.head?.currentRevisionId ?? null) !== input.expectedRevisionId) throw conflict();
    if (value.head && !input.correctionReason?.trim() || (value.head?.revisionCount ?? 0) >= 100) throw refused();
    if (input.status === "PASS" && input.observations.measurements.some(m => m.lowerLimit !== undefined && m.value < m.lowerLimit || m.upperLimit !== undefined && m.value > m.upperLimit)) throw refused();
    if (["PASS", "FAIL"].includes(input.status)) {
      const ids = value.graph[input.testCaseId] ?? [];
      const results = await tx.testResult.findMany({ where: { testRunId: input.testRunId, testCaseId: { in: ids } }, select: { testCaseId: true, status: true } });
      if (results.length !== ids.length || new Set(results.map(r => r.testCaseId)).size !== ids.length || ids.some(id => results.find(r => r.testCaseId === id)?.status !== "PASS")) throw refused();
    }
    const result = await tx.testResult.findFirst({ where: { testRunId: input.testRunId, testCaseId: input.testCaseId }, select: { id: true, status: true } });
    if (result?.status === "PASS" && input.status !== "PASS") {
      const dependents = Object.entries(value.graph).filter(([, ids]) => ids.includes(input.testCaseId)).map(([id]) => id);
      if (await tx.testResult.count({ where: { testRunId: input.testRunId, testCaseId: { in: dependents }, status: { in: ["PASS", "FAIL"] } } }) || await tx.manualStepResultRevision.count({ where: { testRunId: input.testRunId, testCaseId: { in: dependents }, status: { in: ["PASS", "FAIL"] } } })) throw conflict();
    }
    if (input.evidenceAttachmentIds.length) {
      const [filesSize] = await tx.$queryRaw<Array<{ count: bigint; bytes: bigint; maxBytes: bigint; invalid: boolean }>>`SELECT count(*) AS count,coalesce(sum(octet_length(concat(a.id,a."fileName",a."contentType",a."uploadVerification"::text))),0)::bigint AS bytes,coalesce(max(octet_length(concat(a.id,a."fileName",a."contentType",a."uploadVerification"::text))),0)::bigint AS "maxBytes",coalesce(bool_or(a."sizeBytes"<1 OR a."sizeBytes">26214400 OR octet_length(a."fileName")>4096 OR octet_length(a."contentType")>800),false) AS invalid FROM "TestCaseAttachment" a JOIN "TestCase" c ON c.id=a."testCaseId" WHERE a.id IN (${Prisma.join(input.evidenceAttachmentIds)}) AND c."projectId"=${input.projectId} AND a."uploadCompletedAt" IS NOT NULL`;
      if (!filesSize || filesSize.count !== BigInt(input.evidenceAttachmentIds.length) || filesSize.bytes < 0n || filesSize.bytes > 163840n || filesSize.maxBytes > 8192n || filesSize.invalid) throw refused();
    }
    const files = input.evidenceAttachmentIds.length ? await tx.testCaseAttachment.findMany({ where: { id: { in: input.evidenceAttachmentIds }, testCase: { projectId: input.projectId }, uploadCompletedAt: { not: null } }, select: { id: true, fileName: true, contentType: true, sizeBytes: true, uploadVerification: true } }) : [];
    if (files.length !== input.evidenceAttachmentIds.length) throw refused();
    for (const file of files) {
      if (caseFieldPresentationJsonBytes(file.uploadVerification) > 8192) throw refused();
      const [exact] = await tx.$queryRaw<Array<{ exact: boolean }>>`SELECT "uploadVerification" IS NOT DISTINCT FROM ${JSON.stringify(file.uploadVerification)}::jsonb AS exact FROM "TestCaseAttachment" WHERE id=${file.id}`;
      if (exact?.exact !== true) throw refused();
    }
    const evidence = input.evidenceAttachmentIds.map(id => { const file = files.find(file => file.id === id)!; const parsed = savedStepEvidenceSchema.safeParse({ id, fileName: safeEvidenceFileName(file.fileName), contentType: file.contentType, sizeBytes: file.sizeBytes, verification: file.uploadVerification }); if (!parsed.success || qualityProfileHash(parsed.data.verification) !== qualityProfileHash(file.uploadVerification)) throw refused(); return parsed.data; });
    const [nativeActor] = await tx.$queryRaw<Array<{ name: string | null }>>`SELECT CASE WHEN octet_length(name)<=800 THEN name ELSE NULL END AS name FROM "User" WHERE id=${actor.id}`;
    const actorName = nativeActor?.name && nativeActor.name.length <= 200 ? nativeActor.name : "Workspace member";
    const [incoming] = await tx.$queryRaw<Array<{ bytes: bigint }>>`SELECT (octet_length(concat(${input.note}::text,${JSON.stringify(input.observations)}::jsonb::text,${JSON.stringify(evidence)}::jsonb::text,${actorName}::text,${input.correctionReason}::text))+2048)::bigint AS bytes`;
    if (!incoming || incoming.bytes < 2048n || incoming.bytes > 262144n || value.selectedBytes < 0n || value.selectedBytes > value.totalBytes || value.totalBytes - value.selectedBytes + incoming.bytes > 4194304n) throw refused();
    const statuses = new Map(value.heads.map(h => [h.stepIndex, h.currentRevision.status])); statuses.set(input.stepIndex, input.status);
    const complete = value.steps.every((_, index) => statuses.has(index));
    const caseStatus = complete ? aggregateStepStatus(value.steps.map((_, index) => statuses.get(index)!)) : null;
    const revision = await tx.manualStepResultRevision.create({ data: { testRunId: input.testRunId, testCaseId: input.testCaseId, stepIndex: input.stepIndex, revisionNumber: (value.head?.revisionCount ?? 0) + 1,
      status: input.status, caseStatusAtRecord: caseStatus, note: input.note, observations: input.observations, evidenceAttachmentIds: [...input.evidenceAttachmentIds].sort(), evidenceAttachments: evidence,
      actorId: actor.id, actorName, correctionReason: input.correctionReason, previousRevisionId: value.head?.currentRevisionId ?? null, idempotencyKey: input.idempotencyKey, requestHash: reviewedStepLegacyHash(input) } });
    const headData = { currentRevisionId: revision.id, revisionCount: revision.revisionNumber, currentPayloadBytes: Number(incoming.bytes) };
    if (value.head) await tx.manualStepResultHead.update({ where: { testRunId_testCaseId_stepIndex: { testRunId: input.testRunId, testCaseId: input.testCaseId, stepIndex: input.stepIndex } }, data: headData });
    else await tx.manualStepResultHead.create({ data: { testRunId: input.testRunId, testCaseId: input.testCaseId, stepIndex: input.stepIndex, ...headData } });
    if (caseStatus) {
      await tx.$queryRaw`SELECT set_config('vaettir.manual_step_projection', ${JSON.stringify([input.testRunId, input.testCaseId])}, true)`;
      const data = { status: caseStatus, note: `Derived from ${value.steps.length} recorded step outcomes. Per-step measurements and evidence remain on their immutable revisions.`, observations: {} };
      if (result) await tx.testResult.update({ where: { id: result.id }, data }); else await tx.testResult.create({ data: { testRunId: input.testRunId, testCaseId: input.testCaseId, ...data } });
      await tx.$queryRaw`SELECT set_config('vaettir.manual_step_projection', '', true)`;
    }
    const acknowledgement = ack(revision.id, caseStatus, false);
    await tx.auditLog.create({ data: { organizationId: admitted.scope.organizationId, projectId: input.projectId, actorId: actor.id, entityType: "ManualStepExecutionReview/v1", entityId: input.testRunId, action: "CREATE", summary: "Recorded reviewed human step observation; no recovery or release certification.", metadata: acknowledgement } });
    // No post-commit healing/provider action may turn a committed receipt into
    // an uncertain browser outcome, or interpret human Pass as independent fix proof.
    return acknowledgement;
  }, options);
}
