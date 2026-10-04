import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { Prisma, type PrismaClient } from "@vaettir/db";
import { z } from "zod";
import { lockManualRetestAccess } from "./manualRetestScope.js";
import { measurementVerdict } from "./physicalValidation.js";
import { qualityProfileHash } from "./qualityExperienceProfile.js";
import { retestClosure } from "./manualRetest.js";
import { protectExecutedDependents, requirePassedPrerequisites } from "./manualStepExecution.js";
import { manualCaseObservationSchema, manualCaseResultReadKey, manualCaseResultWriteKey, manualCaseResultWriteSchema, manualCaseResultRevisionOutputSchema,
  manualCaseResultReadSchema, manualCaseResultHistorySchema, manualCaseResultPreviewOutputSchema, manualCaseResultHistoryOutputSchema, manualCaseResultAckSchema, type ManualCaseResultRead, type ManualCaseResultWrite } from "./manualCaseResultSchema.js";
const fail = (message: string, code: "BAD_REQUEST" | "CONFLICT" | "FORBIDDEN" | "NOT_FOUND" = "BAD_REQUEST"): never => { throw new TRPCError({ code, message }); };
const limitations = ["Whole-case human observation revisions are not step revisions or new executions.", "Legacy prior evidence is captured at first correction; its original recorder and time remain unknown.", "A corrected Pass does not verify a defect fix, mitigation, release readiness or qualified regulatory approval."];
const byteSize = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");
function boundedActorLabel(name: string | null) {
  let label = "";
  for (const character of name?.trim() ?? "") { if (label.length + character.length > 200) break; label += character; }
  return label || "Workspace member";
}
export const manualCaseResultRequestHash = (input: ManualCaseResultWrite) => createHash("sha256").update(manualCaseResultWriteKey(input)).digest("hex");

async function accessRun(tx: Prisma.TransactionClient, actor: { id: string; clerkUserId: string }, input: ManualCaseResultRead, write: boolean) {
  const scope = await lockManualRetestAccess(tx, actor.id, { projectId: input.projectId, sourceRunId: input.testRunId, testCaseId: input.testCaseId, expectedScope: input.expectedScope }, write, actor.clerkUserId, write);
  const rows = await tx.$queryRaw<Array<{ projectId: string; ciProvider: string; status: string; planned: boolean; count: number; bytes: bigint }>>(Prisma.sql`
    SELECT "projectId",left("ciProvider",256) AS "ciProvider",status::text AS status,${input.testCaseId}=ANY("manualTestCaseIds") AS planned,
      cardinality("manualTestCaseIds")::int AS count,(coalesce(octet_length("manualPrerequisites"::text),0)+octet_length("manualTestCaseIds"::text))::bigint AS bytes
    FROM "TestRun" WHERE id=${input.testRunId} ${write ? Prisma.sql`FOR UPDATE` : Prisma.sql`FOR SHARE`}`);
  const run = rows[0];
  if (!run || run.projectId !== input.projectId) return fail("This manual execution is unavailable in the current project.", "NOT_FOUND");
  if (run.ciProvider !== "manual" || !run.planned) return fail("Only an explicitly planned native manual case can use whole-case observation history. Imported CI evidence is unchanged.");
  if (run.count > 500 || run.bytes > 512n * 1024n) return fail("The run's planned prerequisite scope exceeds this bounded review.");
  const cases = await tx.$queryRaw<Array<{ projectId: string; displayId: string }>>`SELECT "projectId","displayId" FROM "TestCase" WHERE id=${input.testCaseId} FOR SHARE`;
  if (cases[0]?.projectId !== input.projectId) return fail("The native case is unavailable in this project. No foreign case was projected.", "NOT_FOUND");
  if (!cases[0].displayId || cases[0].displayId.length > 200) return fail("This case needs a supported stable public identity before review.");
  if (await tx.manualStepResultHead.count({ where: { testRunId: input.testRunId, testCaseId: input.testCaseId } }))
    return fail("This verdict is derived from step revisions. Review or correct those steps instead; whole-case history cannot replace them.", "CONFLICT");
  const member = await tx.membership.findUniqueOrThrow({ where: { organizationId_userId: { organizationId: scope.organizationId, userId: actor.id } }, select: { role: true, seatType: true } });
  return { scope, run, displayId: cases[0].displayId, canWrite: member.seatType === "FULL" && ["OWNER", "ADMIN", "EDITOR"].includes(member.role) && run.status === "RUNNING" };
}
async function currentState(tx: Prisma.TransactionClient, input: ManualCaseResultRead) {
  const head = await tx.manualCaseResultHead.findUnique({ where: { testRunId_testCaseId: { testRunId: input.testRunId, testCaseId: input.testCaseId } }, select: { organizationId: true, projectId: true, testResultId: true, currentRevisionId: true, revisionCount: true, currentPayloadBytes: true } });
  if (head && (head.organizationId !== input.expectedScope.organizationId || head.projectId !== input.projectId))
    return fail("The retained result history belongs to another original scope. No native evidence body was loaded or rebound.", "FORBIDDEN");
  const [size] = await tx.$queryRaw<Array<{ count: number; bytes: bigint }>>`SELECT count(*)::int AS count,coalesce(sum(octet_length(concat(note,observations::text))),0)::bigint AS bytes FROM "TestResult" WHERE "testRunId"=${input.testRunId} AND "testCaseId"=${input.testCaseId}`;
  if (!size || size.count > 1 || size.bytes > 256n * 1024n) return fail("Duplicate or oversized native case observations cannot be silently combined or truncated.");
  const result = await tx.testResult.findFirst({ where: { testRunId: input.testRunId, testCaseId: input.testCaseId }, select: { id: true, status: true, note: true, observations: true } });
  if (head && (!result || head.testResultId !== result.id))
    return fail("The retained result history belongs to another original scope or native identity. It was not rebound.", "FORBIDDEN");
  const current = result ? manualCaseObservationSchema.parse({ resultId: result.id, status: result.status, note: result.note, observations: result.observations }) : null;
  if (head) {
    if (head.revisionCount < 1 || head.revisionCount > 100 || head.currentPayloadBytes > 256 * 1024) return fail("This native result head is unsupported.");
    const [revisionSize] = await tx.$queryRaw<Array<{ bytes: bigint }>>`SELECT octet_length(concat(note,observations::text,"legacyPrior"::text,"actorLabel","correctionReason"))::bigint AS bytes FROM "ManualCaseResultRevision" WHERE id=${head.currentRevisionId} AND "organizationId"=${input.expectedScope.organizationId} AND "projectId"=${input.projectId}`;
    if (!revisionSize || revisionSize.bytes > 256n * 1024n) return fail("The retained current revision exceeds the bounded evidence view.");
    const revision = await tx.manualCaseResultRevision.findFirst({ where: { id: head.currentRevisionId, organizationId: input.expectedScope.organizationId, projectId: input.projectId, testRunId: input.testRunId, testCaseId: input.testCaseId }, select: { testResultId: true, revisionNumber: true, status: true, note: true, observations: true } });
    if (!revision || revision.testResultId !== result!.id || revision.revisionNumber !== head.revisionCount || qualityProfileHash({ status: revision.status, note: revision.note, observations: revision.observations }) !== qualityProfileHash({ status: result!.status, note: result!.note, observations: result!.observations }))
      return fail("The native result no longer matches its immutable head. Review the inconsistency; no current or historical fact was substituted.", "CONFLICT");
  }
  return { result, head, current, fingerprint: qualityProfileHash({ projectId: input.projectId, testRunId: input.testRunId, testCaseId: input.testCaseId, result, head }) };
}
export async function previewManualCaseResult(db: PrismaClient, actor: { id: string; clerkUserId: string }, raw: ManualCaseResultRead) {
  const input = manualCaseResultReadSchema.parse(raw);
  return db.$transaction(async tx => {
    const access = await accessRun(tx, actor, input, false), state = await currentState(tx, input);
    return manualCaseResultPreviewOutputSchema.parse({ scope: access.scope, requested: manualCaseResultReadKey(input), displayId: access.displayId, current: state.current,
      currentRevisionId: state.head?.currentRevisionId ?? null, revisionNumber: state.head?.revisionCount ?? 0, currentFingerprint: state.fingerprint,
      canWrite: access.canWrite, tracked: !!state.head, runStatus: access.run.status, limitations });
  }, { isolationLevel: "RepeatableRead", timeout: 20000 });
}
export async function historyManualCaseResult(db: PrismaClient, actor: { id: string; clerkUserId: string }, raw: ManualCaseResultRead & { before?: string; limit: number }) {
  const input = manualCaseResultHistorySchema.parse(raw);
  return db.$transaction(async tx => {
    const access = await accessRun(tx, actor, input, false);
    await currentState(tx, input); // No apparently valid history beside a silently divergent native projection.
    const where = { organizationId: access.scope.organizationId, projectId: input.projectId, testRunId: input.testRunId, testCaseId: input.testCaseId };
    const cursor = input.before ? await tx.manualCaseResultRevision.findFirst({ where: { ...where, id: input.before }, select: { revisionNumber: true } }) : null;
    if (input.before && !cursor) return fail("This history cursor does not belong to the selected original case.");
    const metadata = await tx.manualCaseResultRevision.findMany({ where: { ...where, ...(cursor ? { revisionNumber: { lt: cursor.revisionNumber } } : {}) }, orderBy: { revisionNumber: "desc" }, take: input.limit + 1, select: { id: true, payloadBytes: true } });
    if (metadata.some(r => r.payloadBytes > 256 * 1024 || r.payloadBytes < 0) || metadata.reduce((sum, r) => sum + r.payloadBytes, 0) > 1024 * 1024)
      return fail("This complete history page exceeds the 1 MiB review bound. Choose a smaller page; no revisions were truncated.");
    const actual = metadata.length ? await tx.$queryRaw<Array<{ bytes: bigint; count: number }>>`SELECT coalesce(sum(octet_length(concat(note,observations::text,"legacyPrior"::text,"actorLabel","correctionReason"))),0)::bigint AS bytes,count(*)::int AS count FROM "ManualCaseResultRevision" WHERE id IN (${Prisma.join(metadata.map(r => r.id))}) AND "organizationId"=${access.scope.organizationId} AND "projectId"=${input.projectId}` : [{ bytes: 0n, count: 0 }];
    if (actual[0]?.count !== metadata.length || actual[0].bytes > 1024n * 1024n) return fail("The actual complete history payload exceeds the bounded view. Saved size metadata was not trusted as proof.");
    const rows = metadata.length ? await tx.manualCaseResultRevision.findMany({ where: { ...where, id: { in: metadata.slice(0, input.limit).map(r => r.id) } }, orderBy: { revisionNumber: "desc" } }) : [];
    const revisions = rows.map(r => manualCaseResultRevisionOutputSchema.parse({ id: r.id, revisionNumber: r.revisionNumber,
      result: { resultId: r.testResultId, status: r.status, note: r.note, observations: r.observations }, actorLabel: r.actorLabel, recordedAt: r.recordedAt,
      correctionReason: r.correctionReason, previousRevisionId: r.previousRevisionId, legacyPrior: r.legacyPrior }));
    const response = manualCaseResultHistoryOutputSchema.parse({ scope: access.scope, requested: manualCaseResultReadKey(input), canWrite: access.canWrite, runStatus: access.run.status, revisions,
      nextCursor: metadata.length > input.limit ? revisions[revisions.length - 1]!.id : null, limitations });
    if (byteSize(response) > 1024 * 1024) return fail("The complete history response exceeds the 1 MiB bound. No partial history was returned.");
    return response;
  }, { isolationLevel: "RepeatableRead", timeout: 20000 });
}
export async function recordManualCaseResult(db: PrismaClient, actor: { id: string; clerkUserId: string }, raw: ManualCaseResultWrite) {
  const input = manualCaseResultWriteSchema.parse(raw), requestHash = manualCaseResultRequestHash(input);
  if (byteSize(input) > 256 * 1024) return fail("Entered case observations exceed the bounded review.");
  const execute = () => db.$transaction(async tx => {
    const access = await accessRun(tx, actor, input, true);
    const receipt = await tx.manualCaseResultRevision.findUnique({ where: { organizationId_actorId_idempotencyKey: { organizationId: access.scope.organizationId, actorId: actor.id, idempotencyKey: input.idempotencyKey } }, select: { id: true, projectId: true, testRunId: true, testCaseId: true, testResultId: true, revisionNumber: true, requestHash: true, actorClerkUserId: true } });
    const acknowledgement = (r: { id: string; testResultId: string; revisionNumber: number }, recovered: boolean) => manualCaseResultAckSchema.parse({ scope: access.scope, testRunId: input.testRunId, testCaseId: input.testCaseId, resultId: r.testResultId, revisionId: r.id, revisionNumber: r.revisionNumber, idempotencyKey: input.idempotencyKey, requestHash, recovered });
    if (receipt) {
      if (receipt.projectId !== input.projectId || receipt.testRunId !== input.testRunId || receipt.testCaseId !== input.testCaseId || receipt.actorClerkUserId !== actor.clerkUserId || receipt.requestHash !== requestHash)
        return fail("This original actor UUID belongs to a different reviewed observation. It was not replaced.", "CONFLICT");
      return acknowledgement(receipt, true); // Successful receipt independent of later completion/current head.
    }
    if (access.run.status !== "RUNNING") return fail("Only an active manual execution can accept a new observation revision. Prior receipts and history remain available.");
    const state = await currentState(tx, input);
    if ((state.head?.currentRevisionId ?? null) !== input.expectedRevisionId || state.fingerprint !== input.expectedCurrentFingerprint)
      return fail("The current case observation changed. Retain your draft, refresh, and explicitly review a new correction; nothing was overwritten.", "CONFLICT");
    if (state.result && !input.correctionReason) return fail("Explain the reason for correcting the existing observation. Earlier evidence is retained.");
    if ((state.head?.revisionCount ?? 0) >= 100) return fail("This case reached its 100-revision bound. Start a new run rather than replacing history.");
    // Run UPDATE lock covers a cumulative persisted-history cap, not merely
    // current-head sizes. Successful receipts above remain recoverable at cap.
    const [historySize] = await tx.$queryRaw<Array<{ count: number; bytes: bigint }>>`SELECT count(*)::int AS count,coalesce(sum(octet_length(concat(note,observations::text,"legacyPrior"::text,"actorLabel","correctionReason"))+2048),0)::bigint AS bytes FROM "ManualCaseResultRevision" WHERE "testRunId"=${input.testRunId}`;
    if (!historySize || historySize.count >= 10000 || historySize.bytes > 16n * 1024n * 1024n) return fail("This run reached its cumulative 10,000-revision or 16 MiB history bound. Exact prior receipts remain recoverable; start a new run instead of expanding retained history.");
    const run = await tx.testRun.findUniqueOrThrow({ where: { id: input.testRunId }, select: { id: true, manualPrerequisites: true, manualTestCaseIds: true } });
    const graph = z.record(z.array(z.string().min(1).max(200)).max(500)).parse(run.manualPrerequisites);
    if (Object.keys(graph).length > 500 || Object.values(graph).reduce((n, ids) => n + ids.length, 0) > 10000) return fail("Prerequisite references exceed the bounded case review.");
    const closure = retestClosure(run.manualTestCaseIds, run.manualPrerequisites, input.testCaseId);
    if ((await tx.testCase.count({ where: { projectId: input.projectId, id: { in: closure.ordered } } })) !== closure.ordered.length) return fail("The frozen prerequisite scope contains unavailable or foreign current case identities. No foreign evidence was used.");
    await requirePassedPrerequisites(tx, run, input.testCaseId, input.status);
    if (state.result?.status === "PASS" && input.status !== "PASS") await protectExecutedDependents(tx, run, input.testCaseId);
    if (input.status === "PASS" && input.observations.measurements.some(m => measurementVerdict(m) === "OUT_OF_RANGE")) return fail("A measured value is outside its recorded limits; it cannot be marked Pass.");
    const native = state.result ?? await tx.testResult.create({ data: { testRunId: input.testRunId, testCaseId: input.testCaseId, status: input.status, note: input.note, observations: input.observations } });
    const legacyPrior = state.result && !state.head ? { basis: "UNVERSIONED_OBSERVATION_CAPTURED_NOW", originalRecorder: null, originalRecordedAt: null,
      captured: { resultId: state.result.id, status: state.result.status, note: state.result.note, observations: state.result.observations } } : null;
    const actorRow = await tx.user.findUniqueOrThrow({ where: { id: actor.id }, select: { name: true } });
    const actorLabel = boundedActorLabel(actorRow.name);
    // Match stored PostgreSQL jsonb text bytes, not compact JavaScript JSON:
    // jsonb formatting can expand a valid many-reading observation materially.
    const [incomingSize] = await tx.$queryRaw<Array<{ bytes: bigint }>>`SELECT (octet_length(concat(${input.note}::text,${JSON.stringify(input.observations)}::jsonb::text,${legacyPrior === null ? null : JSON.stringify(legacyPrior)}::jsonb::text,${actorLabel}::text,${input.correctionReason}::text))+2048)::bigint AS bytes`;
    if (!incomingSize || incomingSize.bytes < 2048n || incomingSize.bytes > 256n * 1024n) return fail("The complete incoming observation exceeds the bounded persisted evidence view. Nothing was replaced.");
    const payloadBytes = Number(incomingSize.bytes);
    if (historySize.bytes + BigInt(payloadBytes) > 16n * 1024n * 1024n) return fail("This correction would exceed the run's cumulative 16 MiB retained-history bound. Previous evidence and receipts remain unchanged.");
    const total = await tx.manualCaseResultHead.aggregate({ where: { testRunId: input.testRunId }, _sum: { currentPayloadBytes: true } });
    if (payloadBytes > 256 * 1024 || (total._sum.currentPayloadBytes ?? 0) - (state.head?.currentPayloadBytes ?? 0) + payloadBytes > 4 * 1024 * 1024)
      return fail("This revision or run's current observations exceed the bounded evidence view. Nothing was replaced.");
    const revision = await tx.manualCaseResultRevision.create({ data: { organizationId: access.scope.organizationId, projectId: input.projectId, testRunId: input.testRunId, testCaseId: input.testCaseId, testResultId: native.id,
      revisionNumber: (state.head?.revisionCount ?? 0) + 1, status: input.status, note: input.note, observations: input.observations,
      legacyPrior: legacyPrior ?? Prisma.DbNull, correctionReason: input.correctionReason, actorId: actor.id, actorClerkUserId: actor.clerkUserId, actorLabel,
      previousRevisionId: state.head?.currentRevisionId ?? null, idempotencyKey: input.idempotencyKey, requestHash, payloadBytes } });
    // Explicit branch avoids native INSERT ... ON CONFLICT firing first-head
    // BEFORE INSERT validation on a later correction. Run lock serializes both.
    if (state.head) await tx.manualCaseResultHead.update({ where: { testRunId_testCaseId: { testRunId: input.testRunId, testCaseId: input.testCaseId } },
      data: { currentRevisionId: revision.id, revisionCount: revision.revisionNumber, currentPayloadBytes: payloadBytes } });
    else await tx.manualCaseResultHead.create({ data: { organizationId: access.scope.organizationId, projectId: input.projectId, testRunId: input.testRunId, testCaseId: input.testCaseId, testResultId: native.id, currentRevisionId: revision.id, revisionCount: revision.revisionNumber, currentPayloadBytes: payloadBytes } });
    if (state.result) await tx.testResult.update({ where: { id: native.id }, data: { status: input.status, note: input.note, observations: input.observations } });
    return acknowledgement(revision, false);
  }, { isolationLevel: "RepeatableRead", timeout: 20000 });
  try { return await execute(); } catch (e) { if (e instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(e.code)) return execute(); throw e; }
}
