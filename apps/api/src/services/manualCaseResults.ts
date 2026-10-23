import { createHash } from "node:crypto";
import { recordReviewedManualCaseResult } from "./manualCaseResultsReviewed.js";
export { accessReviewedManualCaseResult, previewReviewedManualCaseResult, historyReviewedManualCaseResult, recordReviewedManualCaseResult } from "./manualCaseResultsReviewed.js";
import { TRPCError } from "@trpc/server";
import { Prisma, type PrismaClient } from "@vaettir/db";
import { lockManualRetestAccess } from "./manualRetestScope.js";
import { qualityProfileHash } from "./qualityExperienceProfile.js";
import { manualCaseObservationSchema, manualCaseResultReadKey, manualCaseResultWriteKey, manualCaseResultWriteSchema, manualCaseResultRevisionOutputSchema,
  manualCaseResultReadSchema, manualCaseResultHistorySchema, manualCaseResultPreviewOutputSchema, manualCaseResultHistoryOutputSchema, manualCaseResultAckSchema, type ManualCaseResultRead, type ManualCaseResultWrite } from "./manualCaseResultSchema.js";
const fail = (message: string, code: "BAD_REQUEST" | "CONFLICT" | "FORBIDDEN" | "NOT_FOUND" = "BAD_REQUEST"): never => { throw new TRPCError({ code, message }); };
const limitations = ["Whole-case human observation revisions are not step revisions or new executions.", "Legacy prior evidence is captured at first correction; its original recorder and time remain unknown.", "A corrected Pass does not verify a defect fix, mitigation, release readiness or qualified regulatory approval."];
const byteSize = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");
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
  // Keep the historical parser and canonical request key exactly. This adapter
  // authorizes recovery only; it must not recreate unreviewed legacy writes or
  // read later run/body limits before an already accepted actor UUID.
  const request = manualCaseResultWriteSchema.parse(raw);
  const acknowledgement = await recordReviewedManualCaseResult(db, actor, {
    mode: "LEGACY_PARSED",
    expectedNativeActorId: actor.id,
    request,
  });
  const { mode: _mode, ...legacyAcknowledgement } = acknowledgement;
  return manualCaseResultAckSchema.parse(legacyAcknowledgement);
}
