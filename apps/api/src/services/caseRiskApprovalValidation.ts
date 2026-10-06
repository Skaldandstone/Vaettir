import { TRPCError } from "@trpc/server";
import {
  Prisma,
  type CaseAnalysisQueue,
  type CaseAnalysisQueueItem,
} from "@vaettir/db";
import { analysisHash } from "./caseAnalysisQueue.js";
import { MAX_ANALYSIS_SELECTION } from "./caseAnalysisQueueSchema.js";
import { testCaseContentRevision } from "./testCaseContentRevision.js";
import { caseFieldPresentationJsonBytes } from "./caseFieldPresentationSchema.js";

export const RISK_APPROVAL_MICROBATCH = 32;
export const MAX_RISK_APPROVAL_METADATA_BYTES = 2_048_000n;
export type RiskApprovalItem = Pick<
  CaseAnalysisQueueItem,
  | "queueId"
  | "caseId"
  | "status"
  | "position"
  | "contentRevision"
  | "sourceRevision"
  | "caseUpdatedAt"
>;
const changed = () =>
  new TRPCError({
    code: "CONFLICT",
    message:
      "A selected case changed or is unavailable. Create and review a new complete scope.",
  });

/** Native admission precedes even the narrowly selected queue metadata read.
 * Caller holds the original current scope and queue lock, after exact replay. */
export async function readBoundedRiskApprovalItems(
  tx: Prisma.TransactionClient,
  job: CaseAnalysisQueue,
): Promise<RiskApprovalItem[]> {
  const refused = () =>
    new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "The complete payable queue metadata exceeds supported bounded approval. No partial cohort was loaded or approved.",
    });
  if (
    job.action !== "RISK" ||
    !Number.isInteger(job.caseCount) ||
    job.caseCount < 1 ||
    job.caseCount > MAX_ANALYSIS_SELECTION
  )
    throw refused();
  const [gate] = await tx.$queryRaw<
    Array<{
      nativeQueuedCount: bigint;
      metadataBytes: bigint;
      identities: bigint;
      positions: bigint;
      supported: boolean;
    }>
  >`
    SELECT count(*)::bigint AS "nativeQueuedCount",
      coalesce(sum(octet_length(json_build_object('queueId',"queueId",'caseId',"caseId",'status',status,'position',position,'contentRevision',"contentRevision",'sourceRevision',"sourceRevision",'caseUpdatedAt',"caseUpdatedAt")::text)),0)::bigint AS "metadataBytes",
      count(DISTINCT "caseId")::bigint AS identities,count(DISTINCT position)::bigint AS positions,
      coalesce(bool_and(char_length("queueId") BETWEEN 1 AND 120 AND char_length("caseId") BETWEEN 1 AND 120
        AND "contentRevision" ~ '^[a-f0-9]{64}$' AND "sourceRevision" ~ '^[a-f0-9]{64}$' AND position>=0 AND position<${job.caseCount}),true) AS supported
    FROM "CaseAnalysisQueueItem" WHERE "queueId"=${job.id} AND status='QUEUED'`;
  if (
    !gate ||
    typeof gate.nativeQueuedCount !== "bigint" ||
    typeof gate.metadataBytes !== "bigint" ||
    gate.nativeQueuedCount < 0n ||
    gate.nativeQueuedCount > BigInt(job.caseCount) ||
    gate.nativeQueuedCount > BigInt(MAX_ANALYSIS_SELECTION) ||
    gate.metadataBytes < 0n ||
    gate.metadataBytes > MAX_RISK_APPROVAL_METADATA_BYTES ||
    gate.identities !== gate.nativeQueuedCount ||
    gate.positions !== gate.nativeQueuedCount ||
    gate.supported !== true
  )
    throw refused();
  const items = await tx.caseAnalysisQueueItem.findMany({
    where: { queueId: job.id, status: "QUEUED" },
    orderBy: { position: "asc" },
    take: MAX_ANALYSIS_SELECTION,
    select: {
      queueId: true,
      caseId: true,
      status: true,
      position: true,
      contentRevision: true,
      sourceRevision: true,
      caseUpdatedAt: true,
    },
  });
  // Native char_length counts codepoints; JS limits count UTF-16 units. Keep
  // both admissions and refuse unsupported Unicode width, never clip or expose
  // a private raw schema error. Hashes are already native ASCII-validated.
  if (
    BigInt(items.length) !== gate.nativeQueuedCount ||
    new Set(items.map((item) => item.caseId)).size !== items.length ||
    new Set(items.map((item) => item.position)).size !== items.length ||
    items.some(
      (item, index) =>
        item.queueId !== job.id ||
        item.status !== "QUEUED" ||
        !item.caseId ||
        item.caseId.length > 120 ||
        item.queueId.length > 120 ||
        !/^[a-f0-9]{64}$/.test(item.contentRevision) ||
        !/^[a-f0-9]{64}$/.test(item.sourceRevision) ||
        !Number.isInteger(item.position) ||
        item.position < 0 ||
        item.position >= job.caseCount ||
        (index > 0 && item.position <= items[index - 1]!.position) ||
        !(item.caseUpdatedAt instanceof Date) ||
        !Number.isFinite(item.caseUpdatedAt.getTime()),
    )
  )
    throw refused();
  return items;
}

/** Caller retains current original organization/actor/project/queue locks and
 * the complete atomic approval transaction. No credits, paid histories, new
 * review scope, provider calls or subset approval are created by this helper. */
export async function assertUnchangedRiskApprovalCases(
  tx: Prisma.TransactionClient,
  job: CaseAnalysisQueue,
  items: RiskApprovalItem[],
): Promise<void> {
  if (
    job.action !== "RISK" ||
    !Number.isInteger(job.caseCount) ||
    job.caseCount < 1 ||
    job.caseCount > MAX_ANALYSIS_SELECTION ||
    items.length > job.caseCount ||
    new Set(items.map((item) => item.caseId)).size !== items.length ||
    new Set(items.map((item) => item.position)).size !== items.length ||
    items.some(
      (item, index) =>
        item.queueId !== job.id ||
        item.status !== "QUEUED" ||
        !item.caseId ||
        item.caseId.length > 120 ||
        !Number.isInteger(item.position) ||
        item.position < 0 ||
        item.position >= job.caseCount ||
        (index > 0 && item.position <= items[index - 1]!.position),
    )
  )
    throw changed();

  const [cohort] = await tx.$queryRaw<Array<{ queuedCount: number }>>`
    SELECT count(*)::int AS "queuedCount" FROM "CaseAnalysisQueueItem" WHERE "queueId"=${job.id} AND status='QUEUED'`;
  if (!cohort || cohort.queuedCount !== items.length) throw changed();

  for (
    let offset = 0;
    offset < items.length;
    offset += RISK_APPROVAL_MICROBATCH
  ) {
    const wanted = items.slice(offset, offset + RISK_APPROVAL_MICROBATCH),
      ids = wanted.map((item) => item.caseId);
    // Only identities are returned until same-project relationships and native
    // byte/count admission succeed. All constituent row locks survive commit.
    const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT c.id FROM "TestCase" c WHERE c."projectId"=${job.projectId} AND c.id IN (${Prisma.join(ids)}) ORDER BY c.id FOR UPDATE`);
    if (
      locked.length !== ids.length ||
      new Set(locked.map((row) => row.id)).size !== ids.length ||
      locked.some((row) => !ids.includes(row.id))
    )
      throw changed();
    const nativeAdmission = async () => {
      const [relations] = await tx.$queryRaw<
        Array<{ unavailableShared: boolean; foreignSource: boolean }>
      >(Prisma.sql`
      SELECT EXISTS(SELECT 1 FROM "TestCase" c LEFT JOIN "SharedStepGroup" g ON g.id=c."sharedStepGroupId"
        WHERE c."projectId"=${job.projectId} AND c.id IN (${Prisma.join(ids)})
        AND c."sharedStepGroupId" IS NOT NULL AND (g.id IS NULL OR g."projectId"<>${job.projectId} OR g."archivedAt" IS NOT NULL)) AS "unavailableShared",
        EXISTS(SELECT 1 FROM "TestCaseSource" s LEFT JOIN "TestCase" owner ON owner.id=s."testCaseId"
          WHERE s."testCaseId" IN (${Prisma.join(ids)}) AND (owner.id IS NULL OR owner."projectId"<>${job.projectId})) AS "foreignSource"`);
      if (
        !relations ||
        relations.unavailableShared !== false ||
        relations.foreignSource !== false
      )
        throw changed();
      const bounds = await tx.$queryRaw<
        Array<{
          id: string;
          bytes: bigint;
          steps: bigint;
          sourceBytes: bigint;
          sourceIdentityBytes: bigint;
        }>
      >(Prisma.sql`
      SELECT c.id,
        (octet_length(row_to_json(c)::text) + COALESCE((SELECT SUM(octet_length(row_to_json(s)::text)) FROM "TestCaseStep" s WHERE s."testCaseId"=c.id),0)
          + COALESCE((SELECT octet_length(g.steps::text) FROM "SharedStepGroup" g WHERE g.id=c."sharedStepGroupId"),0))::bigint AS bytes,
        (SELECT COUNT(*) FROM "TestCaseStep" s WHERE s."testCaseId"=c.id)::bigint AS steps,
        COALESCE((SELECT octet_length(json_build_object('filePath',s."filePath",'framework',s.framework,'lastSyncedCommitSha',s."lastSyncedCommitSha")::text)
          FROM "TestCaseSource" s WHERE s."testCaseId"=c.id),0)::bigint AS "sourceBytes",
        COALESCE((SELECT octet_length(json_build_object('id',s.id,'testCaseId',s."testCaseId")::text)
          FROM "TestCaseSource" s WHERE s."testCaseId"=c.id),0)::bigint AS "sourceIdentityBytes"
      FROM "TestCase" c WHERE c."projectId"=${job.projectId} AND c.archived=false AND c.id IN (${Prisma.join(ids)}) ORDER BY c.id`);
      if (
        bounds.length !== ids.length ||
        new Set(bounds.map((row) => row.id)).size !== ids.length ||
        bounds.some((row) => !ids.includes(row.id))
      )
        throw changed();
      for (const row of bounds) {
        if (
          typeof row.bytes !== "bigint" ||
          typeof row.steps !== "bigint" ||
          typeof row.sourceBytes !== "bigint" ||
          typeof row.sourceIdentityBytes !== "bigint" ||
          row.bytes < 0n ||
          row.steps < 0n ||
          row.sourceBytes < 0n ||
          row.sourceIdentityBytes < 0n
        )
          throw changed();
        if (
          row.bytes > 64_000n ||
          row.steps > 1000n ||
          row.sourceBytes > 64_000n ||
          row.sourceIdentityBytes > 64_000n
        )
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "A selected case exceeds bounded analysis admission. No smaller cohort was approved; review its case/procedure or source metadata.",
          });
      }
    };
    // Initial count/bytes also bound every returned child-lock identity; native
    // step row bytes include IDs, group IDs are in the locked case row, and the
    // singular source identity gets its own additive byte gate.
    await nativeAdmission();
    await tx.$queryRaw(Prisma.sql`SELECT s.id FROM "TestCaseStep" s JOIN "TestCase" c ON c.id=s."testCaseId"
      WHERE c."projectId"=${job.projectId} AND c.id IN (${Prisma.join(ids)}) ORDER BY s.id FOR UPDATE OF s`);
    await tx.$queryRaw(Prisma.sql`SELECT s.id FROM "TestCaseSource" s JOIN "TestCase" c ON c.id=s."testCaseId"
      WHERE c."projectId"=${job.projectId} AND c.id IN (${Prisma.join(ids)}) ORDER BY s.id FOR UPDATE OF s`);
    // EXISTS avoids duplicate group lock targets when cases share one procedure.
    await tx.$queryRaw(Prisma.sql`SELECT g.id FROM "SharedStepGroup" g WHERE g."projectId"=${job.projectId} AND g."archivedAt" IS NULL
      AND EXISTS(SELECT 1 FROM "TestCase" c WHERE c."projectId"=${job.projectId} AND c.id IN (${Prisma.join(ids)}) AND c."sharedStepGroupId"=g.id)
      ORDER BY g.id FOR UPDATE`);
    // Repeat relationships and bounds after locks; a concurrent child mutation
    // must not turn earlier metadata admission into permission to load its body.
    await nativeAdmission();
    const cases = await tx.testCase.findMany({
      where: { id: { in: ids }, projectId: job.projectId, archived: false },
      take: RISK_APPROVAL_MICROBATCH,
      include: {
        steps: { orderBy: { order: "asc" } },
        sharedStepGroup: {
          select: { projectId: true, steps: true, archivedAt: true },
        },
        source: {
          select: {
            filePath: true,
            framework: true,
            lastSyncedCommitSha: true,
          },
        },
      },
    });
    const byId = new Map(cases.map((tc) => [tc.id, tc]));
    if (
      cases.length !== ids.length ||
      byId.size !== ids.length ||
      cases.some(
        (tc) =>
          !ids.includes(tc.id) || tc.projectId !== job.projectId || tc.archived,
      ) ||
      ids.some((id) => !byId.has(id))
    )
      throw changed();
    for (const item of wanted) {
      const tc = byId.get(item.caseId)!;
      if (
        (tc.sharedStepGroup &&
          (tc.sharedStepGroup.projectId !== job.projectId ||
            tc.sharedStepGroup.archivedAt)) ||
        (tc.sharedStepGroupId !== null && !tc.sharedStepGroup)
      )
        throw changed();
      try {
        // Bound native JSON traversal before the historical canonical hash.
        // This refuses unsupported/deep structures; it never converts them.
        caseFieldPresentationJsonBytes(tc.verificationProfile);
        if (tc.sharedStepGroup)
          caseFieldPresentationJsonBytes(tc.sharedStepGroup.steps);
      } catch {
        throw changed();
      }
      if (
        testCaseContentRevision(tc) !== item.contentRevision ||
        analysisHash(tc.source) !== item.sourceRevision ||
        tc.updatedAt.getTime() !== item.caseUpdatedAt.getTime()
      )
        throw changed();
    }
  }
}
