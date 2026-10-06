import { Prisma, type PrismaClient } from "@vaettir/db";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { lockManualRetestAccess } from "./manualRetestScope.js";
import { qualityProfileHash } from "./qualityExperienceProfile.js";
import { caseFieldPresentationJsonBytes } from "./caseFieldPresentationSchema.js";
import { supportedManualExecutionIdentity } from "./manualExecutionReadScopeSchema.js";
import { reviewedStepScopeSchema } from "./manualStepExecutionReviewSchema.js";
import { stepResourceCursorSchema, stepResourceHistoryInput, stepResourceEvidenceInput, stepResourceHistoryOutput, stepResourceEvidenceOutput,
  stepResourceRevision, stepResourceFile, type StepResourceHistoryInput, type StepResourceEvidenceInput } from "./manualStepExecutionResourcesSchema.js";

type Actor = { id: string; clerkUserId: string };
type Input = StepResourceHistoryInput | StepResourceEvidenceInput;
const options = { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 20000, maxWait: 5000 };
const refuse = () => new TRPCError({ code: "PRECONDITION_FAILED", message: "This complete scoped resource view is unsupported or exceeds native bounds. Stored notes, procedures and evidence were not truncated or replaced. Narrow the resource search or page size when appropriate." });
const stale = () => new TRPCError({ code: "CONFLICT", message: "The exact scoped resource population or cursor changed. Explicitly refresh this view; retained entries and requests are unchanged." });
const provenance = "CURRENT_READER_AUTHORITY_HISTORICAL_ORIGINAL_TENANCY_UNRECORDED" as const;
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
/** Conservative JSON admission plus native equality below; no date/toJSON hooks. */
function jsonBytes(value: unknown, ceiling: number) {
  try {
    const bytes = caseFieldPresentationJsonBytes(value); if (bytes > ceiling) throw refuse();
    const stack: unknown[] = [value]; while (stack.length) { const entry = stack.pop(); if (typeof entry === "number" && Number.isInteger(entry) && !Number.isSafeInteger(entry)) throw refuse(); if (entry && typeof entry === "object") stack.push(...Object.values(entry)); }
    return bytes;
  } catch { throw refuse(); }
}
export function stepResourceRequestKey(kind: "HISTORY" | "EVIDENCE", input: Input) { return qualityProfileHash({ kind, input }); }
function cursorScopeKey(kind: "HISTORY" | "EVIDENCE", input: Input, procedureHash: string) {
  const { readRequestId: _nonce, cursor: _cursor, ...stable } = input;
  return qualityProfileHash({ kind, input: stable, procedureHash });
}
function decodeCursor(input: Input, kind: "HISTORY" | "EVIDENCE", scopeKey: string, populationHash: string) {
  if (input.cursor === null) return null;
  try {
    const decoded = Buffer.from(input.cursor, "base64url"); if (decoded.length > 1800 || decoded.toString("base64url") !== input.cursor) throw stale();
    const cursor = stepResourceCursorSchema.parse(JSON.parse(decoded.toString("utf8")));
    if (cursor.kind !== kind || cursor.scopeKey !== scopeKey || cursor.populationHash !== populationHash || (kind === "HISTORY") !== (cursor.revisionNumber !== null)) throw stale();
    return cursor;
  } catch { throw stale(); }
}
function encodeCursor(kind: "HISTORY" | "EVIDENCE", scopeKey: string, populationHash: string, position: string, revisionNumber: number | null) {
  const encoded = Buffer.from(JSON.stringify(stepResourceCursorSchema.parse({ version: 1, kind, scopeKey, populationHash, position, revisionNumber }))).toString("base64url");
  if (encoded.length > 2400) throw refuse(); return encoded;
}
function output<T>(schema: z.ZodType<T>, value: unknown): T { const parsed = schema.safeParse(value); if (!parsed.success) throw refuse(); return parsed.data; }

/** Original current authorization precedes every private run/resource read.
 * Historical original tenancy/Clerk/session was not recorded and is not invented. */
async function admit(tx: Prisma.TransactionClient, actor: Actor, input: Input) {
  if (!supportedManualExecutionIdentity(actor.id) || !supportedManualExecutionIdentity(actor.clerkUserId)) throw refuse();
  const locked = await lockManualRetestAccess(tx, actor.id, { projectId: input.projectId, sourceRunId: input.testRunId, testCaseId: input.testCaseId,
    expectedScope: { projectId: input.projectId, organizationId: input.originalOrganizationId, clerkActorId: input.expectedClerkActorId } }, false, actor.clerkUserId, false);
  if (actor.id !== input.expectedNativeActorId || locked.actorId !== actor.id || locked.clerkActorId !== actor.clerkUserId || locked.projectId !== input.projectId || locked.organizationId !== input.originalOrganizationId || actor.clerkUserId !== input.expectedClerkActorId)
    throw new TRPCError({ code: "FORBIDDEN", message: "Current read access in the original native actor and workspace is required." });
  const scope = output(reviewedStepScopeSchema, { projectId: locked.projectId, organizationId: locked.organizationId, actorId: locked.actorId, actorClerkUserId: locked.clerkActorId });
  const [identity] = await tx.$queryRaw<Array<{ projectId: string; manual: boolean }>>`SELECT "projectId",("ciProvider"='manual') AS manual FROM "TestRun" WHERE id=${input.testRunId} FOR SHARE`;
  if (!identity || identity.projectId !== input.projectId || !identity.manual) throw new TRPCError({ code: "NOT_FOUND", message: "Recorded step resources are unavailable in this original project." });
  const [size] = await tx.$queryRaw<Array<{ runBytes: bigint; contextBytes: bigint; scopeBytes: bigint; graphBytes: bigint; cases: number; uniqueCases: bigint; definitions: number; steps: bigint; maxSteps: number; graphKeys: bigint; graphEdges: bigint; invalid: boolean }>>`
    SELECT octet_length(to_jsonb(r)::text)::bigint AS "runBytes",octet_length(r."executionContext"::text)::bigint AS "contextBytes",octet_length(r."manualTestCaseIds"::text)::bigint AS "scopeBytes",octet_length(r."manualPrerequisites"::text)::bigint AS "graphBytes",cardinality(r."manualTestCaseIds")::int AS cases,
      (SELECT count(DISTINCT id) FROM unnest(r."manualTestCaseIds") id) AS "uniqueCases",
      CASE WHEN jsonb_typeof(r."executionContext"->'caseDefinitions')='array' THEN jsonb_array_length(r."executionContext"->'caseDefinitions') ELSE 1001 END AS definitions,
      coalesce((SELECT sum(CASE WHEN jsonb_typeof(d->'steps')='array' THEN jsonb_array_length(d->'steps') ELSE 501 END) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(r."executionContext"->'caseDefinitions')='array' THEN r."executionContext"->'caseDefinitions' ELSE '[]'::jsonb END) d),0)::bigint AS steps,
      coalesce((SELECT max(CASE WHEN jsonb_typeof(d->'steps')='array' THEN jsonb_array_length(d->'steps') ELSE 501 END) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(r."executionContext"->'caseDefinitions')='array' THEN r."executionContext"->'caseDefinitions' ELSE '[]'::jsonb END) d),0)::int AS "maxSteps",
      (SELECT count(*) FROM jsonb_object_keys(CASE WHEN jsonb_typeof(r."manualPrerequisites")='object' THEN r."manualPrerequisites" ELSE '{}'::jsonb END)) AS "graphKeys",
      coalesce((SELECT sum(CASE WHEN jsonb_typeof(g.value)='array' THEN jsonb_array_length(g.value) ELSE 10001 END) FROM jsonb_each(CASE WHEN jsonb_typeof(r."manualPrerequisites")='object' THEN r."manualPrerequisites" ELSE '{}'::jsonb END) g),0)::bigint AS "graphEdges",
      EXISTS(SELECT 1 FROM unnest(r."manualTestCaseIds") id WHERE id IS NULL OR length(id)<1 OR length(id)>200) OR EXISTS(SELECT 1 FROM "TestCase" c WHERE c.id=ANY(r."manualTestCaseIds") AND c."projectId"<>${input.projectId}) AS invalid
    FROM "TestRun" r WHERE r.id=${input.testRunId} AND r."projectId"=${input.projectId}`;
  if (!size || size.runBytes < 0n || size.runBytes > 4194304n || size.contextBytes < 0n || size.contextBytes > 2097152n || size.scopeBytes < 0n || size.scopeBytes > 524288n || size.graphBytes < 0n || size.graphBytes > 524288n || !Number.isInteger(size.cases) || size.cases < 1 || size.cases > 1000 || size.uniqueCases !== BigInt(size.cases) || size.definitions !== size.cases || size.steps < 1n || size.steps > 25000n || size.maxSteps < 1 || size.maxSteps > 500 || size.graphKeys !== BigInt(size.cases) || size.graphEdges < 0n || size.graphEdges > 10000n || size.invalid) throw refuse();
  const run = await tx.testRun.findUniqueOrThrow({ where: { id: input.testRunId }, select: { id: true, projectId: true, manualTestCaseIds: true, manualPrerequisites: true, executionContext: true } });
  if (run.id !== input.testRunId || run.projectId !== input.projectId || run.manualTestCaseIds.length !== size.cases || !run.manualTestCaseIds.includes(input.testCaseId) || run.manualTestCaseIds.some(id => !supportedManualExecutionIdentity(id))) throw refuse();
  jsonBytes(run.executionContext, 2097152); jsonBytes(run.manualPrerequisites, 524288);
  const [exact] = await tx.$queryRaw<Array<{ exact: boolean }>>`SELECT ("executionContext" IS NOT DISTINCT FROM ${JSON.stringify(run.executionContext)}::jsonb AND "manualPrerequisites" IS NOT DISTINCT FROM ${JSON.stringify(run.manualPrerequisites)}::jsonb) AS exact FROM "TestRun" WHERE id=${input.testRunId}`;
  if (exact?.exact !== true) throw refuse();
  const context = run.executionContext as { version?: unknown; caseDefinitions?: unknown };
  if (context?.version !== 1 || !Array.isArray(context.caseDefinitions) || context.caseDefinitions.length !== size.cases) throw refuse();
  const ids = new Set(run.manualTestCaseIds), seen = new Set<string>();
  let selected: { testCaseId: string; steps: unknown[] } | null = null, stepCount = 0;
  const definitionSchema = z.object({ testCaseId: z.string().refine(supportedManualExecutionIdentity), steps: z.array(z.object({ order: z.number().int().min(0).max(499), action: z.string().min(1).max(10000) }).passthrough()).max(500) }).passthrough();
  for (const raw of context.caseDefinitions) { const parsed = definitionSchema.safeParse(raw); if (!parsed.success || !ids.has(parsed.data.testCaseId) || seen.has(parsed.data.testCaseId) || parsed.data.steps.some((step, index) => step.order !== index)) throw refuse(); seen.add(parsed.data.testCaseId); stepCount += parsed.data.steps.length; if (parsed.data.testCaseId === input.testCaseId) selected = raw as { testCaseId: string; steps: unknown[] }; }
  if (!selected || input.stepIndex >= selected.steps.length || stepCount !== Number(size.steps)) throw refuse();
  const graph = z.record(z.array(z.string().refine(supportedManualExecutionIdentity)).max(1000)).safeParse(run.manualPrerequisites);
  if (!graph.success || Object.keys(graph.data).length !== ids.size) throw refuse();
  let edges = 0; for (const [id, dependencies] of Object.entries(graph.data)) { edges += dependencies.length; if (!ids.has(id) || new Set(dependencies).size !== dependencies.length || dependencies.some(dependency => dependency === id || !ids.has(dependency))) throw refuse(); }
  if (edges !== Number(size.graphEdges)) throw refuse();
  const visited = new Set<string>(), visiting = new Set<string>();
  for (const root of ids) { if (visited.has(root)) continue; const stack = [{ id: root, index: 0 }]; while (stack.length) { const frame = stack[stack.length - 1]!, dependencies = graph.data[frame.id]; if (!dependencies) throw refuse(); visiting.add(frame.id); const next = dependencies[frame.index++]; if (next === undefined) { stack.pop(); visiting.delete(frame.id); visited.add(frame.id); } else { if (visiting.has(next)) throw refuse(); if (!visited.has(next)) stack.push({ id: next, index: 0 }); } } }
  return { scope, frozenStep: selected.steps[input.stepIndex], procedureHash: qualityProfileHash({ definition: selected, graph: run.manualPrerequisites, orderedCaseIds: run.manualTestCaseIds }) };
}

export async function readStepResourceHistory(db: PrismaClient, actor: Actor, raw: StepResourceHistoryInput) {
  const input = stepResourceHistoryInput.parse(raw);
  return db.$transaction(async tx => {
    const admitted = await admit(tx, actor, input);
    const [size] = await tx.$queryRaw<Array<{ count: bigint; bytes: bigint; maxBytes: bigint; invalid: boolean }>>`SELECT count(*) AS count,coalesce(sum(octet_length(to_jsonb(v)::text)),0)::bigint AS bytes,coalesce(max(octet_length(to_jsonb(v)::text)),0)::bigint AS "maxBytes",coalesce(bool_or(length(v.id)<1 OR length(v.id)>200 OR v."revisionNumber"<1 OR v."revisionNumber">100),false) AS invalid FROM "ManualStepResultRevision" v WHERE v."testRunId"=${input.testRunId} AND v."testCaseId"=${input.testCaseId} AND v."stepIndex"=${input.stepIndex}`;
    if (!size || size.count < 0n || size.count > 100n || size.bytes < 0n || size.bytes > 26214400n || size.maxBytes < 0n || size.maxBytes > 262144n || size.invalid) throw refuse();
    // PostgreSQL's built-in SHA-256 over exact native JSON text, not an ID-only
    // surrogate. SQL is source-authored here; these functions are not executed.
    const metadata = await tx.$queryRaw<Array<{ id: string; revisionNumber: number; bytes: bigint; fingerprint: string }>>`SELECT v.id,v."revisionNumber",octet_length(to_jsonb(v)::text)::bigint AS bytes,encode(sha256(convert_to(to_jsonb(v)::text,'UTF8')),'hex') AS fingerprint FROM "ManualStepResultRevision" v WHERE v."testRunId"=${input.testRunId} AND v."testCaseId"=${input.testCaseId} AND v."stepIndex"=${input.stepIndex} ORDER BY v."revisionNumber" DESC`;
    if (BigInt(metadata.length) !== size.count || new Set(metadata.map(row => row.id)).size !== metadata.length || new Set(metadata.map(row => row.revisionNumber)).size !== metadata.length || metadata.some((row, index) => !supportedManualExecutionIdentity(row.id) || !Number.isInteger(row.revisionNumber) || row.revisionNumber < 1 || row.revisionNumber > 100 || row.bytes < 1n || row.bytes > 262144n || !hashSchema.safeParse(row.fingerprint).success || index > 0 && row.revisionNumber >= metadata[index - 1]!.revisionNumber) || metadata.reduce((sum, row) => sum + row.bytes, 0n) !== size.bytes || metadata.reduce((max, row) => row.bytes > max ? row.bytes : max, 0n) !== size.maxBytes) throw refuse();
    const populationHash = qualityProfileHash(metadata.map(row => ({ id: row.id, revisionNumber: row.revisionNumber, bytes: String(row.bytes), fingerprint: row.fingerprint }))), scopeKey = cursorScopeKey("HISTORY", input, admitted.procedureHash), cursor = decodeCursor(input, "HISTORY", scopeKey, populationHash);
    const position = cursor ? metadata.findIndex(row => row.id === cursor.position && row.revisionNumber === cursor.revisionNumber) : -1;
    if (cursor && position < 0) throw stale();
    const selected = metadata.slice(position + 1, position + 1 + input.limit);
    if (selected.reduce((sum, row) => sum + row.bytes, 0n) > 4194304n) throw refuse();
    const rows = selected.length ? await tx.manualStepResultRevision.findMany({ where: { id: { in: selected.map(row => row.id) }, testRunId: input.testRunId, testCaseId: input.testCaseId, stepIndex: input.stepIndex }, orderBy: { revisionNumber: "desc" } }) : [];
    if (rows.length !== selected.length) throw refuse();
    const revisions = [];
    for (const [index, row] of rows.entries()) {
      if (row.id !== selected[index]!.id || row.revisionNumber !== selected[index]!.revisionNumber || row.testRunId !== input.testRunId || row.testCaseId !== input.testCaseId || row.stepIndex !== input.stepIndex || !(row.recordedAt instanceof Date) || !Number.isFinite(row.recordedAt.getTime())) throw refuse();
      const projected = { ...row, recordedAt: row.recordedAt.toISOString() }; jsonBytes(projected, 262144);
      const [exact] = await tx.$queryRaw<Array<{ exact: boolean }>>`SELECT (observations IS NOT DISTINCT FROM ${JSON.stringify(row.observations)}::jsonb AND "evidenceAttachments" IS NOT DISTINCT FROM ${JSON.stringify(row.evidenceAttachments)}::jsonb AND "recordedAt" IS NOT DISTINCT FROM ${projected.recordedAt}::timestamp) AS exact FROM "ManualStepResultRevision" WHERE id=${row.id} AND "testRunId"=${input.testRunId} AND "testCaseId"=${input.testCaseId} AND "stepIndex"=${input.stepIndex}`;
      if (exact?.exact !== true) throw refuse();
      revisions.push(output(stepResourceRevision, { id: row.id, revisionNumber: row.revisionNumber, status: row.status, note: row.note, observations: row.observations, evidenceAttachmentIds: row.evidenceAttachmentIds, evidenceAttachments: row.evidenceAttachments, actorId: row.actorId, actorName: row.actorName, recordedAt: projected.recordedAt, correctionReason: row.correctionReason, previousRevisionId: row.previousRevisionId, versionProvenance: "STORED_REVISION_METADATA_NOT_FILE_IMMUTABILITY_PROOF" }));
    }
    const last = selected[selected.length - 1];
    return output(stepResourceHistoryOutput, { projectId: input.projectId, testRunId: input.testRunId, testCaseId: input.testCaseId, stepIndex: input.stepIndex, readRequestId: input.readRequestId, requestKey: stepResourceRequestKey("HISTORY", input), ...admitted, populationHash, totalRevisions: metadata.length, revisions, provenance, nextCursor: last && position + 1 + selected.length < metadata.length ? encodeCursor("HISTORY", scopeKey, populationHash, last.id, last.revisionNumber) : null });
  }, options);
}

const verification = z.object({ etag: z.string().max(300).nullable(), versionId: z.string().max(300).nullable(), verifiedAt: z.string().datetime() }).strict();
export async function readStepResourceEvidence(db: PrismaClient, actor: Actor, raw: StepResourceEvidenceInput) {
  const input = stepResourceEvidenceInput.parse(raw);
  return db.$transaction(async tx => {
    const admitted = await admit(tx, actor, input), filter = Prisma.sql`c."projectId"=${input.projectId} AND a."uploadCompletedAt" IS NOT NULL AND (${input.search}='' OR strpos(lower(a."fileName"),lower(${input.search}))>0)`;
    const projection = Prisma.sql`jsonb_build_object('id',a.id,'testCaseId',a."testCaseId",'fileName',a."fileName",'contentType',a."contentType",'sizeBytes',a."sizeBytes",'uploadCompletedAt',a."uploadCompletedAt",'uploadVerification',a."uploadVerification")`;
    const [size] = await tx.$queryRaw<Array<{ count: bigint; identityBytes: bigint; bytes: bigint; maxBytes: bigint; invalid: boolean }>>(Prisma.sql`SELECT count(*) AS count,coalesce(sum(octet_length(a.id)+octet_length(a."testCaseId")+64),0)::bigint AS "identityBytes",coalesce(sum(octet_length(${projection}::text)),0)::bigint AS bytes,coalesce(max(octet_length(${projection}::text)),0)::bigint AS "maxBytes",coalesce(bool_or(length(a.id)<1 OR length(a.id)>200 OR length(a."testCaseId")<1 OR length(a."testCaseId")>200 OR a."sizeBytes"<1 OR a."sizeBytes">26214400),false) AS invalid FROM "TestCaseAttachment" a JOIN "TestCase" c ON c.id=a."testCaseId" WHERE ${filter}`);
    if (!size || size.count < 0n || size.count > 10000n || size.identityBytes < 0n || size.identityBytes > 2097152n || size.bytes < 0n || size.bytes > 8388608n || size.maxBytes < 0n || size.maxBytes > 8192n || size.invalid) throw refuse();
    // Ordered complete selection metadata is hashed natively only after its
    // counts/bytes admission. Private storage locators are neither read nor sent.
    const [population] = await tx.$queryRaw<Array<{ fingerprint: string }>>(Prisma.sql`SELECT encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(${projection}::text,'UTF8')),'hex'),',' ORDER BY a.id COLLATE "C"),''),'UTF8')),'hex') AS fingerprint FROM "TestCaseAttachment" a JOIN "TestCase" c ON c.id=a."testCaseId" WHERE ${filter}`);
    if (!population || !hashSchema.safeParse(population.fingerprint).success) throw refuse();
    const populationHash = population.fingerprint, scopeKey = cursorScopeKey("EVIDENCE", input, admitted.procedureHash), cursor = decodeCursor(input, "EVIDENCE", scopeKey, populationHash);
    if (cursor) { const [present] = await tx.$queryRaw<Array<{ present: boolean }>>(Prisma.sql`SELECT EXISTS(SELECT 1 FROM "TestCaseAttachment" a JOIN "TestCase" c ON c.id=a."testCaseId" WHERE ${filter} AND a.id=${cursor.position}) AS present`); if (present?.present !== true) throw stale(); }
    const page = await tx.$queryRaw<Array<{ id: string; testCaseId: string; bytes: bigint }>>(Prisma.sql`SELECT a.id,a."testCaseId",octet_length(${projection}::text)::bigint AS bytes FROM "TestCaseAttachment" a JOIN "TestCase" c ON c.id=a."testCaseId" WHERE ${filter} ${cursor ? Prisma.sql`AND a.id COLLATE "C">${cursor.position}` : Prisma.empty} ORDER BY a.id COLLATE "C" LIMIT ${input.limit + 1}`);
    if (page.length > input.limit + 1 || BigInt(page.length) > size.count || new Set(page.map(row => row.id)).size !== page.length || page.some(row => !supportedManualExecutionIdentity(row.id) || !supportedManualExecutionIdentity(row.testCaseId) || row.bytes < 1n || row.bytes > 8192n) || page.reduce((sum, row) => sum + row.bytes, 0n) > 163840n) throw refuse();
    const selected = page.slice(0, input.limit), files = selected.length ? await tx.testCaseAttachment.findMany({ where: { id: { in: selected.map(row => row.id) }, testCase: { projectId: input.projectId }, uploadCompletedAt: { not: null } }, select: { id: true, testCaseId: true, fileName: true, contentType: true, sizeBytes: true, uploadCompletedAt: true, uploadVerification: true } }) : [];
    if (files.length !== selected.length || new Set(files.map(file => file.id)).size !== files.length) throw refuse();
    const attachments = [];
    for (const entry of selected) {
      const file = files.find(value => value.id === entry.id); if (!file || file.testCaseId !== entry.testCaseId || !(file.uploadCompletedAt instanceof Date) || !Number.isFinite(file.uploadCompletedAt.getTime())) throw refuse();
      const projected = { ...file, uploadCompletedAt: file.uploadCompletedAt.toISOString() }; jsonBytes(projected, 8192);
      const [exact] = await tx.$queryRaw<Array<{ exact: boolean }>>`SELECT (jsonb_build_object('id',a.id,'testCaseId',a."testCaseId",'fileName',a."fileName",'contentType',a."contentType",'sizeBytes',a."sizeBytes",'uploadVerification',a."uploadVerification") IS NOT DISTINCT FROM ${JSON.stringify({ id: file.id, testCaseId: file.testCaseId, fileName: file.fileName, contentType: file.contentType, sizeBytes: file.sizeBytes, uploadVerification: file.uploadVerification })}::jsonb AND a."uploadCompletedAt" IS NOT DISTINCT FROM ${projected.uploadCompletedAt}::timestamp) AS exact FROM "TestCaseAttachment" a JOIN "TestCase" c ON c.id=a."testCaseId" WHERE a.id=${file.id} AND c."projectId"=${input.projectId}`;
      if (exact?.exact !== true) throw refuse();
      const parsed = verification.safeParse(file.uploadVerification), rawVersion = file.uploadVerification && typeof file.uploadVerification === "object" && !Array.isArray(file.uploadVerification) && Object.hasOwn(file.uploadVerification, "versionId") ? (file.uploadVerification as { versionId: unknown }).versionId : undefined;
      const version = rawVersion === null || typeof rawVersion === "string" && rawVersion.length <= 300 ? { versionId: rawVersion } : {};
      attachments.push(output(stepResourceFile, { ...projected, ...version, selectable: parsed.success, versionProvenance: !parsed.success ? "UNSUPPORTED_VERIFICATION_RETAINED_READ_ONLY" : parsed.data.versionId === null ? "UNVERSIONED_NOT_IMMUTABLE" : "VERSION_ID_RECORDED_NOT_FETCHED" }));
    }
    const last = selected[selected.length - 1];
    return output(stepResourceEvidenceOutput, { projectId: input.projectId, testRunId: input.testRunId, testCaseId: input.testCaseId, stepIndex: input.stepIndex, readRequestId: input.readRequestId, requestKey: stepResourceRequestKey("EVIDENCE", input), ...admitted, populationHash, totalCandidates: Number(size.count), attachments, search: input.search, provenance, nextCursor: page.length > input.limit && last ? encodeCursor("EVIDENCE", scopeKey, populationHash, last.id, null) : null });
  }, options);
}
