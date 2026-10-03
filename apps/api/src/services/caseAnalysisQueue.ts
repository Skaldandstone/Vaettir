import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import {
  Prisma,
  type PrismaClient,
  type CaseAnalysisQueue,
  type CaseAnalysisQueueItem,
} from "@vaettir/db";
import { testCaseContentRevision } from "./testCaseContentRevision.js";
import { getAiCreditBalance, AI_OPERATION_COSTS } from "./aiCredits.js";
import {
  ApprovedAnalysisSpendRefusal,
  type ApprovedAnalysisSpend,
} from "./approvedAnalysisSpend.js";
import type { CaseAnalysisAction } from "./caseAnalysisQueueSchema.js";

export const analysisHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const operationFor = (action: string) =>
  action === "RISK"
    ? ("assessTestCaseRisk" as const)
    : ("reviewTestDesign" as const);
export const costFor = (action: string) =>
  AI_OPERATION_COSTS[operationFor(action)];
type Database = Prisma.TransactionClient;

// Organization -> membership -> project -> queue, consistently across approval,
// cancellation and spending. No lock survives a provider request.
export async function analysisAccess(
  tx: Database,
  projectId: string,
  actorId: string,
  spend = false,
  expectedOrg?: string,
) {
  const initial = await tx.project.findUnique({
    where: { id: projectId },
    select: { organizationId: true },
  });
  if (!initial || (expectedOrg && initial.organizationId !== expectedOrg))
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "This project is unavailable.",
    });
  const org = await tx.$queryRaw<
    Array<{ suspendedAt: Date | null }>
  >`SELECT "suspendedAt" FROM "Organization" WHERE id=${initial.organizationId} FOR UPDATE`;
  const memberships = await tx.$queryRaw<
    Array<{ role: string; seatType: string }>
  >`SELECT role,"seatType" FROM "Membership" WHERE "organizationId"=${initial.organizationId} AND "userId"=${actorId} FOR UPDATE`;
  const project = await tx.$queryRaw<
    Array<{ organizationId: string }>
  >`SELECT "organizationId" FROM "Project" WHERE id=${projectId} FOR UPDATE`;
  const member = memberships[0];
  if (
    !org[0] ||
    org[0].suspendedAt ||
    !member ||
    !project[0] ||
    project[0].organizationId !== initial.organizationId
  )
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Current project access is required.",
    });
  const canSpend =
    member.seatType === "FULL" &&
    ["OWNER", "ADMIN", "EDITOR"].includes(member.role);
  if (spend && !canSpend)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "A current full editor seat is required to spend credits.",
    });
  return { organizationId: initial.organizationId, canSpend };
}

export async function analysisBaseline(
  db: Database,
  projectId: string,
  caseId: string,
) {
  // Count/byte bounds are checked in PostgreSQL before materializing procedures.
  const bounds = await db.$queryRaw<Array<{ bytes: bigint; steps: bigint }>>`
    SELECT (octet_length(row_to_json(c)::text) + COALESCE((SELECT SUM(octet_length(row_to_json(s)::text)) FROM "TestCaseStep" s WHERE s."testCaseId"=c.id),0) + COALESCE((SELECT octet_length(g.steps::text) FROM "SharedStepGroup" g WHERE g.id=c."sharedStepGroupId"),0))::bigint AS bytes,
    (SELECT COUNT(*) FROM "TestCaseStep" s WHERE s."testCaseId"=c.id)::bigint AS steps
    FROM "TestCase" c WHERE c.id=${caseId} AND c."projectId"=${projectId} AND c.archived=false`;
  if (!bounds[0])
    throw new TRPCError({
      code: "CONFLICT",
      message: "A selected case is missing, archived or outside this project.",
    });
  if (bounds[0].bytes > 64000n || bounds[0].steps > 1000n)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "A selected case exceeds the bounded analysis size. Split it into focused cases.",
    });
  const tc = await db.testCase.findFirstOrThrow({
    where: { id: caseId, projectId, archived: false },
    include: {
      steps: { orderBy: { order: "asc" } },
      sharedStepGroup: {
        select: { projectId: true, steps: true, archivedAt: true },
      },
      source: {
        select: { filePath: true, framework: true, lastSyncedCommitSha: true },
      },
    },
  });
  if (
    tc.sharedStepGroup &&
    (tc.sharedStepGroup.projectId !== projectId ||
      tc.sharedStepGroup.archivedAt)
  )
    throw new TRPCError({
      code: "CONFLICT",
      message: "A selected case has an unavailable shared procedure.",
    });
  return {
    caseId,
    displayId: tc.displayId,
    contentRevision: testCaseContentRevision(tc),
    sourceRevision: analysisHash(tc.source),
    caseUpdatedAt: tc.updatedAt,
  };
}

export async function unchangedAnalysisCase(
  tx: Database,
  job: CaseAnalysisQueue,
  item: CaseAnalysisQueueItem,
) {
  await tx.$queryRaw`SELECT id FROM "TestCase" WHERE id=${item.caseId} AND "projectId"=${job.projectId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "TestCaseStep" WHERE "testCaseId"=${item.caseId} ORDER BY id FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "TestCaseSource" WHERE "testCaseId"=${item.caseId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "SharedStepGroup" WHERE id=(SELECT "sharedStepGroupId" FROM "TestCase" WHERE id=${item.caseId}) FOR UPDATE`;
  const now = await analysisBaseline(tx, job.projectId, item.caseId);
  return (
    now.contentRevision === item.contentRevision &&
    now.sourceRevision === item.sourceRevision &&
    now.caseUpdatedAt.getTime() === item.caseUpdatedAt.getTime()
  );
}

export async function ownedAnalysis(
  tx: Database,
  projectId: string,
  actorId: string,
  id: string,
  spend = false,
) {
  const original = await tx.caseAnalysisQueue.findFirst({
    where: { id, projectId, requestedById: actorId },
  });
  if (!original)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Analysis scope not found.",
    });
  const access = await analysisAccess(
    tx,
    projectId,
    actorId,
    spend,
    original.organizationId,
  );
  await tx.$queryRaw`SELECT id FROM "CaseAnalysisQueue" WHERE id=${id} FOR UPDATE`;
  const job = await tx.caseAnalysisQueue.findUniqueOrThrow({ where: { id } });
  return { job, ...access };
}

export async function readAnalysis(
  db: PrismaClient,
  projectId: string,
  actorId: string,
  id: string,
  offset = 0,
) {
  return db.$transaction(async (tx) => {
    const { job, canSpend } = await ownedAnalysis(tx, projectId, actorId, id);
    const [items, groups, balance] = await Promise.all([
      tx.caseAnalysisQueueItem.findMany({
        where: { queueId: id },
        orderBy: { position: "asc" },
        skip: offset,
        take: 50,
      }),
      tx.caseAnalysisQueueItem.groupBy({
        by: ["status"],
        where: { queueId: id },
        _count: true,
      }),
      getAiCreditBalance(tx as unknown as PrismaClient, job.organizationId),
    ]);
    const currentIds = new Set(
      (
        await tx.testCase.findMany({
          where: { id: { in: items.map((i) => i.caseId) }, projectId },
          select: { id: true },
        })
      ).map((c) => c.id),
    );
    return {
      id: job.id,
      projectId,
      action: job.action as CaseAnalysisAction,
      status: job.status,
      scopeHash: job.scopeHash,
      maximumCredits: job.maximumCredits,
      caseCount: job.caseCount,
      reason: job.reason,
      createdAt: job.createdAt,
      approvedAt: job.approvedAt,
      cancelledAt: job.cancelledAt,
      balance,
      canSpend,
      counts: Object.fromEntries(groups.map((g) => [g.status, g._count])),
      offset,
      hasMore: offset + items.length < job.caseCount,
      items: items.map((i) => ({
        position: i.position,
        displayId: i.displayId,
        caseId: currentIds.has(i.caseId) ? i.caseId : null,
        status: i.status,
        reason: i.reason,
        maximumCredits: i.maximumCredits,
        charged: Boolean(i.chargeId),
        actualCredits: i.actualCredits,
        refund: i.refund,
        excessNotCharged: i.excessNotCharged,
        meteredAt: i.meteredAt,
      })),
    };
  });
}

export function approvedAnalysisContext(
  job: CaseAnalysisQueue,
  item: CaseAnalysisQueueItem,
  leaseOwner: string,
): ApprovedAnalysisSpend {
  const scope: ApprovedAnalysisSpend = {
    organizationId: job.organizationId,
    caseId: item.caseId,
    inputHash: item.inputHash,
    operation: operationFor(job.action),
    maximumCredits: item.maximumCredits,
    validate: async (tx) => {
      try {
        await analysisAccess(
          tx,
          job.projectId,
          job.requestedById,
          true,
          job.organizationId,
        );
      } catch {
        throw new ApprovedAnalysisSpendRefusal(
          "ACCESS",
          "Current full editor access was lost before spending.",
        );
      }
      await tx.$queryRaw`SELECT id FROM "CaseAnalysisQueue" WHERE id=${job.id} FOR UPDATE`;
      const current = await tx.caseAnalysisQueue.findUniqueOrThrow({
        where: { id: job.id },
      });
      const currentItem = await tx.caseAnalysisQueueItem.findUniqueOrThrow({
        where: { id: item.id },
      });
      if (current.cancelledAt || current.status === "CANCELLED")
        throw new ApprovedAnalysisSpendRefusal(
          "CANCELLED",
          "Cancelled before this case was charged.",
        );
      if (
        !current.approvedAt ||
        current.status !== "RUNNING" ||
        current.activeItemId !== item.id ||
        current.leaseOwner !== leaseOwner ||
        !current.leaseExpiresAt ||
        current.leaseExpiresAt <= new Date() ||
        currentItem.status !== "RUNNING" ||
        currentItem.chargeId ||
        currentItem.maximumCredits !== item.maximumCredits ||
        current.scopeHash !== job.scopeHash
      )
        throw new ApprovedAnalysisSpendRefusal(
          "STALE",
          "The persisted approval or work lease is no longer current.",
        );
      try {
        if (!(await unchangedAnalysisCase(tx, current, currentItem)))
          throw new Error("Changed");
      } catch {
        throw new ApprovedAnalysisSpendRefusal(
          "STALE",
          "The case, source reference or shared procedure changed after review. No new charge was made.",
        );
      }
    },
    recordCharge: async (tx, chargeId) => {
      const changed = await tx.caseAnalysisQueueItem.updateMany({
        where: { id: item.id, status: "RUNNING", chargeId: null },
        data: { chargeId },
      });
      if (changed.count !== 1)
        throw new Error("The durable charge receipt could not be claimed.");
    },
    recordMeter: async (tx, chargeId, facts) => {
      // Refund-only reconciliation remains possible after cancellation or role
      // loss. Original organization/project/charge identity is still required;
      // it can never grant authority for an additional debit.
      const original = await tx.caseAnalysisQueue.findFirst({
        where: {
          id: job.id,
          organizationId: job.organizationId,
          projectId: job.projectId,
        },
        select: { id: true },
      });
      if (!original) throw new Error("Approved metering scope is unavailable.");
      const changed = await tx.caseAnalysisQueueItem.updateMany({
        where: { id: item.id, queueId: job.id, chargeId, meteredAt: null },
        data: { ...facts, meteredAt: new Date() },
      });
      return changed.count === 1;
    },
  };
  return scope;
}
