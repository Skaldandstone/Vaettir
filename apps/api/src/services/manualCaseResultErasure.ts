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
      ) q JOIN "Project" p ON p.id=q."projectId" JOIN "TestRun" run ON run.id=q."testRunId" JOIN "TestCase" c ON c.id=q."testCaseId" JOIN "TestResult" res ON res.id=q."testResultId"
       WHERE (q."organizationId"=${organizationId} OR p."organizationId"=${organizationId}) AND
        (q."organizationId"<>p."organizationId" OR run."projectId"<>q."projectId" OR c."projectId"<>q."projectId" OR res."testRunId"<>q."testRunId" OR res."testCaseId" IS DISTINCT FROM q."testCaseId")) AS unsupported`;
  if (!counts) throw new TRPCError({ code: "BAD_REQUEST", message: "Original whole-case history erasure inventory is unavailable." });
  const overBound = counts.heads > 100000 || counts.revisions > 100000;
  return { ManualCaseResultHead: counts.heads, ManualCaseResultRevision: counts.revisions,
    unsupportedOriginalScopeTuples: counts.unsupported, overBound,
    limits: { heads: 100000, revisions: 100000 }, blocked: counts.unsupported > 0 || overBound };
}
export async function eraseManualCaseResultHistory(tx: Prisma.TransactionClient, organizationId: string) {
  const preview = await previewManualCaseResultErasure(tx, organizationId);
  if (preview.blocked) throw new TRPCError({ code: "BAD_REQUEST", message: "Whole-case history exceeds the complete erasure bound or has reparented or foreign-original tuples. Exact tenant erasure requires reconciliation; no evidence was deleted." });
  const heads = await tx.manualCaseResultHead.deleteMany({ where: { organizationId } });
  let revisions = 0;
  for (let number = 100; number >= 1; number--) revisions += (await tx.manualCaseResultRevision.deleteMany({ where: { organizationId, revisionNumber: number } })).count;
  if (heads.count !== preview.ManualCaseResultHead || revisions !== preview.ManualCaseResultRevision) throw new TRPCError({ code: "CONFLICT", message: "The exact whole-case history erasure inventory changed; transaction must roll back." });
  return { ManualCaseResultHead: heads.count, ManualCaseResultRevision: revisions };
}
