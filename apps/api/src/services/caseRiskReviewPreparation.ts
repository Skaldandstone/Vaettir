import { TRPCError } from "@trpc/server";
import { Prisma, type PrismaClient } from "@vaettir/db";
import { buildCaseRiskInput } from "./caseRiskInput.js";
import { testCaseContentRevision } from "./testCaseContentRevision.js";
import { analysisAccess, analysisHash, analysisScoped, costFor } from "./caseAnalysisQueue.js";
import { caseAnalysisSelectionSchema, type CaseAnalysisClientScope } from "./caseAnalysisQueueSchema.js";

export const RISK_REVIEW_MICROBATCH = 32;
export const RISK_REVIEW_SOURCE_BYTES = 64_000n;
type RiskSelection = CaseAnalysisClientScope & { projectId: string; action: "RISK"; ids: string[]; requestId: string };
type Database = Prisma.TransactionClient;
type Item = Prisma.CaseAnalysisQueueItemCreateWithoutQueueInput;

/** Fixed native flags deliberately retain legacy status truthiness, including
 * empty TEXT status. Paid content is neither loaded nor normalized by REVIEW. */
export function riskReviewQueueStatus(ready: boolean, nonemptyStatus: boolean, assessed: boolean) {
  return ready ? "SAVED" : nonemptyStatus ? "UNKNOWN" : assessed ? "SKIPPED" : "QUEUED";
}

async function preflight(tx: Database, projectId: string, ids: string[]) {
  // Identity-only relationships precede even native private-body measurement.
  // Source has no independent project column; verify its actual owning Case.
  const relations = await tx.$queryRaw<Array<{ unavailableShared: boolean; foreignSource: boolean }>>(Prisma.sql`
    SELECT EXISTS(SELECT 1 FROM "TestCase" c LEFT JOIN "SharedStepGroup" g ON g.id=c."sharedStepGroupId"
      WHERE c."projectId"=${projectId} AND c.id IN (${Prisma.join(ids)})
      AND c."sharedStepGroupId" IS NOT NULL AND (g.id IS NULL OR g."projectId"<>${projectId} OR g."archivedAt" IS NOT NULL)) AS "unavailableShared",
      EXISTS(SELECT 1 FROM "TestCaseSource" s LEFT JOIN "TestCase" source_case ON source_case.id=s."testCaseId"
        WHERE s."testCaseId" IN (${Prisma.join(ids)})
        AND (source_case.id IS NULL OR source_case."projectId"<>${projectId})) AS "foreignSource"`);
  if (!relations[0] || relations[0].foreignSource)
    throw new TRPCError({ code: "FORBIDDEN", message: "A selected case has an unavailable original source scope." });
  if (relations[0].unavailableShared)
    throw new TRPCError({ code: "CONFLICT", message: "A selected case has an unavailable shared procedure." });
  // Existing case/procedure admission is unchanged. Source projection is a
  // separately reviewed additive cap, not a replacement or combined allowance.
  const bounds = await tx.$queryRaw<Array<{ id: string; bytes: bigint; steps: bigint; sourceBytes: bigint }>>(Prisma.sql`
    SELECT c.id,
      (octet_length(row_to_json(c)::text) + COALESCE((SELECT SUM(octet_length(row_to_json(step)::text)) FROM "TestCaseStep" step WHERE step."testCaseId"=c.id),0)
        + COALESCE((SELECT octet_length(g.steps::text) FROM "SharedStepGroup" g WHERE g.id=c."sharedStepGroupId"),0))::bigint AS bytes,
      (SELECT COUNT(*) FROM "TestCaseStep" step WHERE step."testCaseId"=c.id)::bigint AS steps,
      COALESCE((SELECT octet_length(json_build_object('filePath',s."filePath",'framework',s.framework,'lastSyncedCommitSha',s."lastSyncedCommitSha")::text)
        FROM "TestCaseSource" s WHERE s."testCaseId"=c.id),0)::bigint AS "sourceBytes"
    FROM "TestCase" c WHERE c."projectId"=${projectId} AND c.archived=false AND c.id IN (${Prisma.join(ids)}) ORDER BY c.id`);
  if (bounds.length !== ids.length || new Set(bounds.map(row => row.id)).size !== ids.length || bounds.some(row => !ids.includes(row.id)))
    throw new TRPCError({ code: "CONFLICT", message: "A selected case is missing, archived or outside this project." });
  for (const row of bounds) {
    if (row.bytes > 64_000n || row.steps > 1000n)
      throw new TRPCError({ code: "BAD_REQUEST", message: "A selected case exceeds the bounded analysis size. Split it into focused cases." });
    if (row.sourceBytes > RISK_REVIEW_SOURCE_BYTES)
      throw new TRPCError({ code: "BAD_REQUEST", message: "A selected case exceeds the separate risk source-reference size limit. Review its source metadata before continuing." });
  }
}

/** Caller owns the complete RR snapshot and authorization locks. Never fetch
 * all selected procedures, paid bodies, balances or provider context at once. */
export async function prepareRiskReviewItems(tx: Database, projectId: string, sortedIds: string[]): Promise<Item[]> {
  await preflight(tx, projectId, sortedIds);
  const items: Item[] = [];
  for (let offset = 0; offset < sortedIds.length; offset += RISK_REVIEW_MICROBATCH) {
    const ids = sortedIds.slice(offset, offset + RISK_REVIEW_MICROBATCH);
    const cases = await tx.testCase.findMany({
      where: { id: { in: ids }, projectId, archived: false },
      orderBy: { id: "asc" }, take: RISK_REVIEW_MICROBATCH,
      include: { steps: { orderBy: { order: "asc" } }, sharedStepGroup: { select: { projectId: true, steps: true, archivedAt: true } }, source: { select: { filePath: true, framework: true, lastSyncedCommitSha: true } } },
    });
    const byId = new Map(cases.map(tc => [tc.id, tc]));
    if (cases.length !== ids.length || byId.size !== ids.length || ids.some(id => !byId.has(id)) || cases.some(tc => tc.projectId !== projectId || tc.archived))
      throw new TRPCError({ code: "CONFLICT", message: "The complete selected case batch is unavailable. No partial scope was saved." });
    // PostgreSQL collation is not JavaScript UTF-16 sort order. Positions and
    // historical hashes follow the exact caller-sorted IDs, never DB collation.
    const drafts = ids.map((id, index) => {
      const tc = byId.get(id)!;
      if (tc.sharedStepGroup && (tc.sharedStepGroup.projectId !== projectId || tc.sharedStepGroup.archivedAt))
        throw new TRPCError({ code: "CONFLICT", message: "A selected case has an unavailable shared procedure." });
      const baseline = { caseId: tc.id, displayId: tc.displayId, contentRevision: testCaseContentRevision(tc), sourceRevision: analysisHash(tc.source), caseUpdatedAt: tc.updatedAt };
      return { baseline, position: offset + index, inputHash: buildCaseRiskInput(tc).hash, assessed: tc.riskAssessedAt !== null };
    });
    const values = drafts.map(draft => Prisma.sql`(${draft.baseline.caseId},${draft.inputHash})`);
    const flags = await tx.$queryRaw<Array<{ caseId: string; ready: boolean; nonemptyStatus: boolean }>>(Prisma.sql`
      SELECT wanted."caseId", COALESCE(r.status='READY',false) AS ready, COALESCE(r.status<>'',false) AS "nonemptyStatus"
      FROM (VALUES ${Prisma.join(values)}) wanted("caseId","inputHash")
      JOIN "TestCase" c ON c.id=wanted."caseId" AND c."projectId"=${projectId}
      LEFT JOIN "TestCaseRiskReview" r ON r."testCaseId"=wanted."caseId" AND r."inputHash"=wanted."inputHash"
      ORDER BY wanted."caseId"`);
    const flagsById = new Map(flags.map(flag => [flag.caseId, flag]));
    if (flags.length !== drafts.length || flagsById.size !== drafts.length || drafts.some(draft => !flagsById.has(draft.baseline.caseId)))
      throw new TRPCError({ code: "CONFLICT", message: "The complete paid-review state is unavailable. No partial scope was saved." });
    for (const draft of drafts) {
      const flag = flagsById.get(draft.baseline.caseId)!, status = riskReviewQueueStatus(flag.ready, flag.nonemptyStatus, draft.assessed);
      // Literal property order is part of the historical persisted scope hash.
      items.push({ ...draft.baseline, position: draft.position, inputHash: draft.inputHash, status,
        maximumCredits: status === "QUEUED" ? costFor("RISK") : 0,
        reason: status === "UNKNOWN" ? "An earlier paid request needs reconciliation; it will not be retried."
          : status === "SKIPPED" ? "Existing human or imported risk assessment preserved." : null });
    }
  }
  return items;
}

/** REVIEW only: exact prior UUID recovery precedes later native-size admission.
 * No approval, reservation, provider, charge, balance read or worker is called.
 * Native SQL and full 851-case transaction timing require separate proof. */
export async function prepareRiskReviewQueue(db: PrismaClient, actorId: string, clerkActorId: string, supplied: RiskSelection) {
  const parsed = caseAnalysisSelectionSchema.safeParse(supplied);
  if (!parsed.success || parsed.data.action !== "RISK")
    throw new TRPCError({ code: "BAD_REQUEST", message: "An exact bounded risk selection and request UUID are required." });
  const input = parsed.data, ids = [...input.ids].sort(), selection = [input.projectId, input.action, ids];
  const selectionHash = analysisHash(analysisScoped(input) ? { selection, originalOrganizationId: input.originalOrganizationId, expectedClerkActorId: input.expectedClerkActorId } : selection);
  const where = { projectId_requestedById_requestId: { projectId: input.projectId, requestedById: actorId, requestId: input.requestId } };
  let originalOrganizationId: string | undefined;
  const options = { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15000 };
  const verify = (prior: { id: string; selectionHash: string; organizationId: string }, org: string) => {
    if (prior.organizationId !== org)
      throw new TRPCError({ code: "NOT_FOUND", message: "Original analysis scope is unavailable." });
    if (prior.selectionHash !== selectionHash)
      throw new TRPCError({ code: "CONFLICT", message: "This request ID already belongs to a different reviewed scope." });
    return { id: prior.id };
  };
  try {
    return await db.$transaction(async tx => {
      const access = await analysisAccess(tx, input.projectId, actorId, false, undefined, input, clerkActorId);
      originalOrganizationId = access.organizationId;
      const prior = await tx.caseAnalysisQueue.findUnique({ where, select: { id: true, selectionHash: true, organizationId: true } });
      if (prior) return verify(prior, access.organizationId);
      const items = await prepareRiskReviewItems(tx, input.projectId, ids);
      const maximumCredits = items.reduce((sum, item) => sum + item.maximumCredits, 0);
      const scopeHash = analysisHash({ ...(analysisScoped(input) ? { originalOrganizationId: input.originalOrganizationId, expectedClerkActorId: input.expectedClerkActorId } : {}), projectId: input.projectId, actorId, action: input.action, maximumCredits, items });
      return tx.caseAnalysisQueue.create({ data: { projectId: input.projectId, organizationId: access.organizationId, requestedById: actorId, requestId: input.requestId, selectionHash, scopeHash, action: "RISK", maximumCredits, caseCount: ids.length, items: { create: items } }, select: { id: true } });
    }, options);
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    // A concurrent unique receipt is recovered in a NEW snapshot, after fresh
    // original authorization. Never inspect its private row outside the lock.
    return db.$transaction(async tx => {
      const access = await analysisAccess(tx, input.projectId, actorId, false, originalOrganizationId, input, clerkActorId);
      const prior = await tx.caseAnalysisQueue.findUniqueOrThrow({ where, select: { id: true, selectionHash: true, organizationId: true } });
      return verify(prior, access.organizationId);
    }, options);
  }
}
