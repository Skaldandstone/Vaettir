import { TRPCError } from "@trpc/server";
import { Prisma, type PrismaClient } from "@vaettir/db";
import { z } from "zod";
import { lockCaseFieldProject } from "./caseFields.js";
import {
  lockCaseFieldReadScope,
  lockCurrentCaseFieldActor,
  type CaseFieldReadAuthorization,
} from "./caseFieldReadScope.js";
import { snapshotTestPlanVersion } from "./testPlanVersion.js";
import {
  MAX_GOVERNANCE_CRITERIA,
  MAX_GOVERNANCE_SNAPSHOT_BYTES,
  MAX_GOVERNANCE_RECEIPT_BYTES,
  MAX_GOVERNANCE_HISTORY_BYTES,
  MAX_GOVERNANCE_HISTORY_REVISIONS,
  editCriterionDescriptionInput,
  attachUnassignedPlanInput,
  planGovernanceScopeInput,
  planGovernanceHistoryInput,
  planGovernanceReceipt,
  planGovernanceAck,
  type PlanGovernanceSnapshot,
} from "./testPlanGovernanceSchema.js";
import {
  boundedGovernanceSnapshot,
  governancePlanRevision,
  governanceCriterionRevision,
  governanceRequestHash,
  governanceAuditId,
  assertGovernanceReceiptBytes,
  validatedGovernanceReceipt,
} from "./testPlanGovernanceRevision.js";
const ENTITY = "TestPlanGovernanceWrite";
type Scope = Awaited<ReturnType<typeof lockCaseFieldReadScope>>;
type ScopeInput = z.infer<typeof planGovernanceScopeInput>;

async function lockPlan(
  tx: Prisma.TransactionClient,
  input: ScopeInput,
  write: boolean,
) {
  const rows = write
    ? await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT id FROM "TestPlan" WHERE id=${input.testPlanId} AND "projectId"=${input.projectId} FOR UPDATE`
    : await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT id FROM "TestPlan" WHERE id=${input.testPlanId} AND "projectId"=${input.projectId} FOR SHARE`;
  if (!rows.length)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Test plan not found in this project.",
    });
}
async function snapshot(
  tx: Prisma.TransactionClient,
  input: ScopeInput,
  lockCriteria: boolean,
): Promise<PlanGovernanceSnapshot> {
  // Native byte/count admission precedes materializing legacy JSON or prose.
  const [size] = await tx.$queryRaw<Array<{ bytes: bigint; criteria: number }>>`
    SELECT (octet_length(concat(p.id,p."projectId",p."testPlanTypeId",p."releaseId",p."strategyId",p.name,p.description,p.status::text,p."customFields"::text,p."executionTemplate"::text,p."createdById",p."updatedById"))
      +coalesce((SELECT sum(octet_length(concat(c.id,c."testPlanId",c."requirementId",c.description,c.status::text))) FROM "AcceptanceCriterion" c WHERE c."testPlanId"=p.id),0))::bigint AS bytes,
      (SELECT count(*)::int FROM "AcceptanceCriterion" c WHERE c."testPlanId"=p.id) AS criteria
    FROM "TestPlan" p WHERE p.id=${input.testPlanId} AND p."projectId"=${input.projectId}`;
  if (
    !size ||
    size.criteria > MAX_GOVERNANCE_CRITERIA ||
    size.bytes > BigInt(MAX_GOVERNANCE_SNAPSHOT_BYTES)
  )
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "The complete plan exceeds its bounded governance read. No legacy fields or criteria were discarded.",
    });
  if (lockCriteria)
    await tx.$queryRaw`SELECT id FROM "AcceptanceCriterion" WHERE "testPlanId"=${input.testPlanId} ORDER BY id FOR UPDATE`;
  const plan = await tx.testPlan.findFirstOrThrow({
    where: { id: input.testPlanId, projectId: input.projectId },
    include: {
      acceptanceCriteria: { orderBy: { id: "asc" } },
      versions: {
        orderBy: { versionNumber: "desc" },
        take: 1,
        select: { id: true, versionNumber: true },
      },
    },
  });
  const { acceptanceCriteria, versions, createdAt, updatedAt, ...fields } =
    plan;
  return boundedGovernanceSnapshot({
    snapshotVersion: 1,
    ...fields,
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
    latestVersion: versions[0] ?? null,
    criteria: acceptanceCriteria.map((c) => ({
      ...c,
      createdAt: c.createdAt.toISOString(),
    })),
  });
}
async function writeScope(
  tx: Prisma.TransactionClient,
  actorId: string,
  input: ScopeInput,
  authorized: CaseFieldReadAuthorization,
): Promise<Scope> {
  await tx.$executeRaw(Prisma.sql`SET LOCAL statement_timeout='8000ms'`);
  await lockCaseFieldProject(tx, actorId, input.projectId);
  const actorClerkUserId = await lockCurrentCaseFieldActor(
    tx,
    actorId,
    authorized,
  );
  const project = await tx.project.findUniqueOrThrow({
    where: { id: input.projectId },
    select: { organizationId: true },
  });
  if (
    project.organizationId !== input.originalOrganizationId ||
    actorClerkUserId !== input.expectedClerkActorId
  )
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "Restore the original organization and signed-in actor before retrying this governance request.",
    });
  return {
    projectId: input.projectId,
    organizationId: project.organizationId,
    actorId,
    actorClerkUserId,
  };
}
async function receipt(
  tx: Prisma.TransactionClient,
  auditId: string,
  scope: Scope,
  requestHash: string,
) {
  const [meta] = await tx.$queryRaw<Array<{ id: string; bytes: number }>>`
    SELECT id,octet_length(metadata::text)::int AS bytes FROM "AuditLog"
    WHERE id=${auditId} AND "organizationId"=${scope.organizationId} AND "projectId"=${scope.projectId} AND "actorId"=${scope.actorId} AND "entityType"=${ENTITY}`;
  if (!meta) return null;
  if (meta.bytes > MAX_GOVERNANCE_RECEIPT_BYTES)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "This governance receipt exceeds its bounded read. No partial acknowledgement was substituted.",
    });
  const row = await tx.auditLog.findUniqueOrThrow({
    where: { id: meta.id },
    select: { metadata: true },
  });
  const saved = validatedGovernanceReceipt(row.metadata);
  if (
    saved.ack.requestHash !== requestHash ||
    saved.ack.scope.organizationId !== scope.organizationId ||
    saved.ack.scope.projectId !== scope.projectId ||
    saved.ack.scope.actorId !== scope.actorId ||
    saved.ack.scope.actorClerkUserId !== scope.actorClerkUserId
  )
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "This governance UUID already has different content or original scope. Retry the exact reviewed request.",
    });
  return planGovernanceAck.parse({ ...saved.ack, replayed: true });
}
async function historyBudget(
  tx: Prisma.TransactionClient,
  scope: Scope,
  planId: string,
) {
  const [budget] = await tx.$queryRaw<Array<{ count: number; bytes: bigint }>>`
    SELECT count(*)::int AS count,coalesce(sum(octet_length(metadata::text)),0)::bigint AS bytes FROM "AuditLog"
    WHERE "organizationId"=${scope.organizationId} AND "projectId"=${scope.projectId} AND "entityType"=${ENTITY} AND "entityId"=${planId}`;
  if (
    !budget ||
    budget.count >= MAX_GOVERNANCE_HISTORY_REVISIONS ||
    budget.bytes >
      BigInt(MAX_GOVERNANCE_HISTORY_BYTES - MAX_GOVERNANCE_RECEIPT_BYTES)
  )
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "This plan's retained governance history reached its bounded write budget. Existing history was not pruned; no change was made.",
    });
}
async function assertPlanningRelease(
  tx: Prisma.TransactionClient,
  projectId: string,
  releaseId: string,
) {
  const [release] = await tx.$queryRaw<
    Array<{ id: string; status: string }>
  >`SELECT id,status::text AS status FROM "Release" WHERE id=${releaseId} AND "projectId"=${projectId} FOR SHARE`;
  if (!release)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Release not found in this project.",
    });
  if (["READY", "SHIPPED"].includes(release.status))
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "Reopen the release's planning status before changing its quality scope. Its reviewed or shipped state was not silently invalidated.",
    });
}
export async function previewPlanGovernance(
  db: PrismaClient,
  actorId: string,
  raw: ScopeInput,
  authorized: CaseFieldReadAuthorization,
) {
  const input = planGovernanceScopeInput.parse(raw);
  return db.$transaction(
    async (tx) => {
      const scope = await lockCaseFieldReadScope(
        tx,
        actorId,
        input,
        authorized,
      );
      await lockPlan(tx, input, false);
      const current = await snapshot(tx, input, false);
      const member = await tx.membership.findUniqueOrThrow({
        where: {
          organizationId_userId: {
            organizationId: scope.organizationId,
            userId: actorId,
          },
        },
        select: { role: true, seatType: true },
      });
      let editBlockedReason: string | null = ["APPROVED", "ARCHIVED"].includes(
        current.status,
      )
        ? "Reopen this approved or archived plan before editing its governed wording or assignment."
        : null;
      if (current.releaseId && !editBlockedReason) {
        const [release] = await tx.$queryRaw<
          Array<{ status: string }>
        >`SELECT status::text AS status FROM "Release" WHERE id=${current.releaseId} AND "projectId"=${input.projectId} FOR SHARE`;
        if (!release || ["READY", "SHIPPED"].includes(release.status))
          editBlockedReason =
            "Reopen the attached release's planning status before editing its quality scope.";
      }
      return {
        scope,
        snapshot: current,
        planRevision: governancePlanRevision(current),
        criterionRevisions: Object.fromEntries(
          current.criteria.map((c) => [c.id, governanceCriterionRevision(c)]),
        ),
        canEdit:
          !editBlockedReason &&
          member.seatType === "FULL" &&
          ["OWNER", "ADMIN", "EDITOR"].includes(member.role),
        editBlockedReason,
      };
    },
    { isolationLevel: "RepeatableRead", timeout: 10000, maxWait: 5000 },
  );
}
type Edit = z.infer<typeof editCriterionDescriptionInput>;
type Attach = z.infer<typeof attachUnassignedPlanInput>;
async function write(
  db: PrismaClient,
  actorId: string,
  input: Edit | Attach,
  operation: "EDIT_CRITERION_DESCRIPTION" | "ATTACH_UNASSIGNED_PLAN",
  authorized: CaseFieldReadAuthorization,
) {
  const requestHash = governanceRequestHash({ operation, input });
  return db.$transaction(
    async (tx) => {
      const scope = await writeScope(tx, actorId, input, authorized);
      await lockPlan(tx, input, true);
      // Exact lost-ACK replay is authorized before evaluating newer plan state or
      // newer cumulative payload limits; it never reapplies an old assignment.
      const auditId = governanceAuditId(
        input.projectId,
        actorId,
        input.requestId,
      );
      const previous = await receipt(tx, auditId, scope, requestHash);
      if (previous) return previous;
      await historyBudget(tx, scope, input.testPlanId);
      const before = await snapshot(tx, input, true);
      if (["APPROVED", "ARCHIVED"].includes(before.status))
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "Reopen this approved or archived plan before changing governed content. Existing approvals were not reinterpreted.",
        });
      if (governancePlanRevision(before) !== input.expectedPlanRevision)
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "Plan governance changed after review. Refresh and review before saving; no change was made.",
        });
      let criterionId: string | null = null;
      if (operation === "EDIT_CRITERION_DESCRIPTION") {
        const edit = input as Edit;
        const current = before.criteria.find((c) => c.id === edit.criterionId);
        if (!current)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Criterion not found in this exact plan.",
          });
        if (
          governanceCriterionRevision(current) !==
          edit.expectedCriterionRevision
        )
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "Criterion wording or native association changed after review. The original text was not overwritten.",
          });
        if (before.releaseId)
          await assertPlanningRelease(tx, input.projectId, before.releaseId);
        await tx.acceptanceCriterion.update({
          where: { id: current.id },
          data: { description: edit.description },
        });
        criterionId = current.id;
      } else {
        const attach = input as Attach;
        if (before.releaseId !== attach.expectedReleaseId)
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "This plan is already assigned. No other release lost its quality scope.",
          });
        await assertPlanningRelease(tx, input.projectId, attach.releaseId);
        const updated = await tx.testPlan.updateMany({
          where: {
            id: input.testPlanId,
            projectId: input.projectId,
            releaseId: null,
          },
          data: { releaseId: attach.releaseId, updatedById: actorId },
        });
        if (updated.count !== 1)
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "The unassigned plan changed before attachment. Nothing was moved.",
          });
      }
      const changed = await tx.testPlan.update({
        where: { id: input.testPlanId },
        data: { updatedById: actorId },
      });
      const version = await snapshotTestPlanVersion(tx, {
        testPlanId: changed.id,
        name: changed.name,
        description: changed.description,
        status: changed.status,
        customFields: changed.customFields,
        executionTemplate: changed.executionTemplate,
        actorId,
      });
      const after = await snapshot(tx, input, false);
      const ack = planGovernanceAck
        .omit({ replayed: true })
        .parse({
          scope,
          requestId: input.requestId,
          requestHash,
          operation,
          testPlanId: input.testPlanId,
          criterionId,
          releaseId: after.releaseId,
          versionId: version.id,
          versionNumber: version.versionNumber,
          beforeRevision: governancePlanRevision(before),
          afterRevision: governancePlanRevision(after),
        });
      const metadata = planGovernanceReceipt.parse({
        format: "PlanGovernance/v1",
        ack,
        reason: input.reason,
        before,
        after,
      });
      validatedGovernanceReceipt(metadata);
      assertGovernanceReceiptBytes(metadata);
      await tx.auditLog.create({
        data: {
          id: auditId,
          organizationId: scope.organizationId,
          projectId: scope.projectId,
          actorId,
          entityType: ENTITY,
          entityId: input.testPlanId,
          action: "UPDATE",
          summary:
            operation === "EDIT_CRITERION_DESCRIPTION"
              ? "Edited reviewed criterion wording"
              : "Attached an unassigned quality plan",
          metadata: metadata as Prisma.InputJsonValue,
        },
      });
      // Check actual native JSONB bytes and aggregate while all scope locks are
      // still held. Expansion never commits a partial/oversized audit snapshot.
      const [actual] = await tx.$queryRaw<
        Array<{ bytes: number }>
      >`SELECT octet_length(metadata::text)::int AS bytes FROM "AuditLog" WHERE id=${auditId}`;
      if (!actual || actual.bytes > MAX_GOVERNANCE_RECEIPT_BYTES)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Native governance history exceeded its byte limit. The complete change was rolled back.",
        });
      return planGovernanceAck.parse({ ...ack, replayed: false });
    },
    { timeout: 10000, maxWait: 5000 },
  );
}
export function editGovernedCriterionDescription(
  db: PrismaClient,
  actorId: string,
  input: Edit,
  authorized: CaseFieldReadAuthorization,
) {
  return write(
    db,
    actorId,
    editCriterionDescriptionInput.parse(input),
    "EDIT_CRITERION_DESCRIPTION",
    authorized,
  );
}
export function attachGovernedUnassignedPlan(
  db: PrismaClient,
  actorId: string,
  input: Attach,
  authorized: CaseFieldReadAuthorization,
) {
  return write(
    db,
    actorId,
    attachUnassignedPlanInput.parse(input),
    "ATTACH_UNASSIGNED_PLAN",
    authorized,
  );
}
export async function listPlanGovernanceHistory(
  db: PrismaClient,
  actorId: string,
  raw: z.input<typeof planGovernanceHistoryInput>,
  authorized: CaseFieldReadAuthorization,
) {
  const input = planGovernanceHistoryInput.parse(raw);
  return db.$transaction(
    async (tx) => {
      const scope = await lockCaseFieldReadScope(
        tx,
        actorId,
        input,
        authorized,
      );
      await lockPlan(tx, input, false);
      const rows = await tx.auditLog.findMany({
        where: {
          organizationId: scope.organizationId,
          projectId: scope.projectId,
          entityType: ENTITY,
          entityId: input.testPlanId,
          ...(input.before
            ? {
                OR: [
                  { createdAt: { lt: new Date(input.before.createdAt) } },
                  {
                    createdAt: new Date(input.before.createdAt),
                    id: { lt: input.before.id },
                  },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: input.take + 1,
        select: { id: true, createdAt: true },
      });
      const page = rows.slice(0, input.take);
      if (page.length) {
        const [size] = await tx.$queryRaw<
          Array<{ bytes: bigint; largest: number }>
        >`SELECT coalesce(sum(octet_length(metadata::text)),0)::bigint AS bytes,coalesce(max(octet_length(metadata::text)),0)::int AS largest FROM "AuditLog" WHERE id IN (${Prisma.join(page.map((row) => row.id))}) AND "organizationId"=${scope.organizationId} AND "projectId"=${scope.projectId} AND "entityType"=${ENTITY} AND "entityId"=${input.testPlanId}`;
        if (
          !size ||
          size.bytes > 2n * 1024n * 1024n ||
          size.largest > MAX_GOVERNANCE_RECEIPT_BYTES
        )
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "This complete history page exceeds its bounded size. Request a smaller page; no snapshot was truncated.",
          });
      }
      const metadata = page.length
        ? await tx.auditLog.findMany({
            where: {
              id: { in: page.map((row) => row.id) },
              organizationId: scope.organizationId,
              projectId: scope.projectId,
              entityType: ENTITY,
              entityId: input.testPlanId,
            },
            select: { id: true, metadata: true },
          })
        : [];
      const byId = new Map(metadata.map((row) => [row.id, row.metadata]));
      const entries = page.map((row) => {
        const receipt = validatedGovernanceReceipt(byId.get(row.id));
        if (
          receipt.ack.testPlanId !== input.testPlanId ||
          receipt.ack.scope.projectId !== scope.projectId ||
          receipt.ack.scope.organizationId !== scope.organizationId
        )
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "This history entry does not match the requested original plan. No unrelated snapshot was used.",
          });
        return { id: row.id, createdAt: row.createdAt.toISOString(), receipt };
      });
      return {
        scope,
        entries,
        nextCursor:
          rows.length > input.take && page.length
            ? {
                id: page[page.length - 1]!.id,
                createdAt: page[page.length - 1]!.createdAt.toISOString(),
              }
            : null,
      };
    },
    { isolationLevel: "RepeatableRead", timeout: 10000, maxWait: 5000 },
  );
}
