import { Prisma } from "@vaettir/db";
import { TRPCError } from "@trpc/server";
/** Proposed hook ONLY for existing authorized organization erasure transaction.
 * No route/automatic invocation; caller must lock and authorize exact organization.
 * Deferred DELETE guards REQUIRE native results and original org removed in this
 * SAME transaction; this helper cannot be committed as standalone history pruning. */
export async function previewManualCaseResultErasure(tx: Prisma.TransactionClient, organizationId: string) {
  const [counts] = await tx.$queryRaw<Array<{ heads: number; revisions: number; unsupported: number }>>`
    SELECT (SELECT count(*)::int FROM "ManualCaseResultHead" WHERE "organizationId"=${organizationId}) AS heads,
      (SELECT count(*)::int FROM "ManualCaseResultRevision" WHERE "organizationId"=${organizationId}) AS revisions,
      (SELECT count(*)::int FROM (
        SELECT h."organizationId",h."projectId",h."testRunId",h."testCaseId",h."testResultId" FROM "ManualCaseResultHead" h
        UNION ALL SELECT r."organizationId",r."projectId",r."testRunId",r."testCaseId",r."testResultId" FROM "ManualCaseResultRevision" r
      ) q LEFT JOIN "Project" p ON p.id=q."projectId" LEFT JOIN "TestRun" run ON run.id=q."testRunId" LEFT JOIN "TestCase" c ON c.id=q."testCaseId" LEFT JOIN "TestResult" res ON res.id=q."testResultId"
       WHERE (q."organizationId"=${organizationId} OR p."organizationId"=${organizationId}) AND
        (p.id IS NULL OR run.id IS NULL OR c.id IS NULL OR res.id IS NULL OR q."organizationId"<>p."organizationId" OR run."projectId"<>q."projectId" OR c."projectId"<>q."projectId" OR res."testRunId"<>q."testRunId" OR res."testCaseId" IS DISTINCT FROM q."testCaseId")) AS unsupported`;
  if (!counts || [counts.heads, counts.revisions, counts.unsupported].some(value => !Number.isSafeInteger(value) || value < 0)) throw new TRPCError({ code: "BAD_REQUEST", message: "Original whole-case history erasure inventory is unavailable." });
  const overBound = counts.heads > 100000 || counts.revisions > 100000;
  return { ManualCaseResultHead: counts.heads, ManualCaseResultRevision: counts.revisions,
    unsupportedOriginalScopeTuples: counts.unsupported, overBound,
    limits: { heads: 100000, revisions: 100000 }, blocked: counts.unsupported > 0 || overBound };
}
export async function eraseManualCaseResultHistory(tx: Prisma.TransactionClient, organizationId: string) {
  const preview = await previewManualCaseResultErasure(tx, organizationId);
  if (preview.blocked) throw new TRPCError({ code: "BAD_REQUEST", message: "Whole-case history exceeds the complete erasure bound or has reparented or foreign-original tuples. Exact tenant erasure requires reconciliation; no evidence was deleted." });
  // Only project the populated revision numbers and exact counts, not payloads
  // or IDs. Org/Project locks are held by the caller throughout this erasure.
  // Descending populated levels preserve the restrictive previous-revision FK
  // without 100 empty DELETE round trips (particularly expensive for no history).
  const levels = preview.ManualCaseResultRevision === 0 ? [] : await tx.manualCaseResultRevision.groupBy({
    by: ["revisionNumber"], where: { organizationId },
    _count: { _all: true }, orderBy: { revisionNumber: "desc" }, take: 101,
  });
  if (levels.length > 100 || levels.some(level => !Number.isInteger(level.revisionNumber) || level.revisionNumber < 1 || level.revisionNumber > 100 || !Number.isSafeInteger(level._count._all) || level._count._all < 1) ||
    levels.reduce((sum, level) => sum + level._count._all, 0) !== preview.ManualCaseResultRevision) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Whole-case revision levels do not match the complete bounded original inventory. No history was deleted." });
  }
  const heads = preview.ManualCaseResultHead === 0 ? { count: 0 } : await tx.manualCaseResultHead.deleteMany({ where: { organizationId } });
  let revisions = 0;
  for (const level of levels) {
    const deleted = await tx.manualCaseResultRevision.deleteMany({ where: { organizationId, revisionNumber: level.revisionNumber } });
    if (deleted.count !== level._count._all) throw new TRPCError({ code: "CONFLICT", message: "The exact whole-case revision level changed; transaction must roll back." });
    revisions += deleted.count;
  }
  if (heads.count !== preview.ManualCaseResultHead || revisions !== preview.ManualCaseResultRevision) throw new TRPCError({ code: "CONFLICT", message: "The exact whole-case history erasure inventory changed; transaction must roll back." });
  return { ManualCaseResultHead: heads.count, ManualCaseResultRevision: revisions };
}
