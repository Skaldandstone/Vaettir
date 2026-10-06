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
  editPlanHeaderInput,
  setCriterionVerdictInput,
  addGovernedCriterionInput,
  deleteGovernedCriterionInput,
  setGovernedCriterionRequirementInput,
  requirementChoiceInput,
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
async function hasPlanCases(tx: Prisma.TransactionClient, input: ScopeInput) {
  const rows = await tx.$queryRaw<
    Array<{ id: string }>
  >`SELECT id FROM "TestCase" WHERE "testPlanId"=${input.testPlanId} AND "projectId"=${input.projectId} LIMIT 1 FOR SHARE`;
  return rows.length > 0;
}
async function assertManualVerdict(
  tx: Prisma.TransactionClient,
  input: ScopeInput,
) {
  if (await hasPlanCases(tx, input))
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "This plan's effective criterion verdicts are computed from its case evidence. Record case results instead; no manual verdict was substituted.",
    });
}
async function assertSameProjectRequirement(
  tx: Prisma.TransactionClient,
  projectId: string,
  requirementId: string | null,
) {
  if (requirementId === null) return;
  const rows = await tx.$queryRaw<
    Array<{ id: string }>
  >`SELECT id FROM "Requirement" WHERE id=${requirementId} AND "projectId"=${projectId} FOR SHARE`;
  if (!rows.length)
    throw new TRPCError({
      code: "NOT_FOUND",
      message:
        "The selected requirement is unavailable in this exact project. No foreign association was substituted.",
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
        manualVerdicts: !(await hasPlanCases(tx, input)),
      };
    },
    { isolationLevel: "RepeatableRead", timeout: 10000, maxWait: 5000 },
  );
}
type Edit = z.infer<typeof editCriterionDescriptionInput>;
type Header = z.infer<typeof editPlanHeaderInput>;
type Verdict = z.infer<typeof setCriterionVerdictInput>;
type Add = z.infer<typeof addGovernedCriterionInput>;
type Delete = z.infer<typeof deleteGovernedCriterionInput>;
type Associate = z.infer<typeof setGovernedCriterionRequirementInput>;
type Operation = z.infer<typeof planGovernanceAck>["operation"];
type Attach = z.infer<typeof attachUnassignedPlanInput>;
async function write(
  db: PrismaClient,
  actorId: string,
  input: Edit | Attach | Verdict | Add | Delete | Associate | Header,
  operation: Operation,
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
      let headerChanges: { name?: string; description?: string | null } = {};
      if (operation === "EDIT_PLAN_HEADER") {
        const header = input as Header;
        if (before.releaseId)
          await assertPlanningRelease(tx, input.projectId, before.releaseId);
        if (
          (header.name === undefined || header.name === before.name) &&
          (header.description === undefined ||
            header.description === before.description)
        )
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "The reviewed header contains no native change. Nothing was written or versioned.",
          });
        headerChanges = {
          ...(header.name !== undefined ? { name: header.name } : {}),
          ...(header.description !== undefined
            ? { description: header.description }
            : {}),
        };
      } else if (operation === "ADD_CRITERION") {
        const add = input as Add;
        if (before.criteria.length >= MAX_GOVERNANCE_CRITERIA)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "This plan already contains the bounded maximum criteria. Existing criteria were not removed or truncated.",
          });
        if (before.releaseId)
          await assertPlanningRelease(tx, input.projectId, before.releaseId);
        await assertSameProjectRequirement(
          tx,
          input.projectId,
          add.requirementId,
        );
        const occupied = await tx.acceptanceCriterion.findUnique({
          where: { id: add.criterionId },
          select: { id: true },
        });
        if (occupied)
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "The new criterion identity is already occupied. No existing criterion was overwritten.",
          });
        await tx.acceptanceCriterion.create({
          data: {
            id: add.criterionId,
            testPlanId: input.testPlanId,
            description: add.description,
            requirementId: add.requirementId,
            status: "PENDING",
          },
        });
        criterionId = add.criterionId;
      } else if (
        operation === "EDIT_CRITERION_DESCRIPTION" ||
        operation === "SET_CRITERION_VERDICT" ||
        operation === "DELETE_CRITERION" ||
        operation === "SET_CRITERION_REQUIREMENT"
      ) {
        const edit = input as Edit | Verdict | Delete | Associate;
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
        if (
          (operation === "DELETE_CRITERION" ||
            operation === "SET_CRITERION_REQUIREMENT") &&
          current.requirementId !== (edit as Delete).expectedRequirementId
        )
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "The raw requirement association changed after review. Refresh before changing or removing it.",
          });
        if (operation === "DELETE_CRITERION") {
          await tx.acceptanceCriterion.delete({ where: { id: current.id } });
        } else if (operation === "SET_CRITERION_REQUIREMENT") {
          const associate = edit as Associate;
          await assertSameProjectRequirement(
            tx,
            input.projectId,
            associate.requirementId,
          );
          await tx.acceptanceCriterion.update({
            where: { id: current.id },
            data: { requirementId: associate.requirementId },
          });
        } else {
          if (operation === "SET_CRITERION_VERDICT")
            await assertManualVerdict(tx, input);
          await tx.acceptanceCriterion.update({
            where: { id: current.id },
            data:
              operation === "SET_CRITERION_VERDICT"
                ? { status: (edit as Verdict).status }
                : { description: (edit as Edit).description },
          });
        }
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
        data: { ...headerChanges, updatedById: actorId },
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
      const ack = planGovernanceAck.omit({ replayed: true }).parse({
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
          summary: {
            EDIT_CRITERION_DESCRIPTION: "Edited reviewed criterion wording",
            SET_CRITERION_VERDICT: "Changed reviewed criterion verdict",
            ADD_CRITERION: "Added a reviewed pending criterion",
            DELETE_CRITERION:
              "Removed a reviewed criterion with retained history",
            SET_CRITERION_REQUIREMENT:
              "Changed a reviewed criterion requirement association",
            EDIT_PLAN_HEADER: "Edited reviewed plan name or description",
            ATTACH_UNASSIGNED_PLAN: "Attached an unassigned quality plan",
          }[operation],
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
export function setGovernedCriterionVerdict(
  db: PrismaClient,
  actorId: string,
  input: Verdict,
  authorized: CaseFieldReadAuthorization,
) {
  return write(
    db,
    actorId,
    setCriterionVerdictInput.parse(input),
    "SET_CRITERION_VERDICT",
    authorized,
  );
}

export function editGovernedPlanHeader(
  db: PrismaClient,
  actorId: string,
  input: Header,
  authorized: CaseFieldReadAuthorization,
) {
  return write(
    db,
    actorId,
    editPlanHeaderInput.parse(input),
    "EDIT_PLAN_HEADER",
    authorized,
  );
}
export function addGovernedCriterion(
  db: PrismaClient,
  actorId: string,
  input: Add,
  authorized: CaseFieldReadAuthorization,
) {
  return write(
    db,
    actorId,
    addGovernedCriterionInput.parse(input),
    "ADD_CRITERION",
    authorized,
  );
}
export function deleteGovernedCriterion(
  db: PrismaClient,
  actorId: string,
  input: Delete,
  authorized: CaseFieldReadAuthorization,
) {
  return write(
    db,
    actorId,
    deleteGovernedCriterionInput.parse(input),
    "DELETE_CRITERION",
    authorized,
  );
}
export function setGovernedCriterionRequirement(
  db: PrismaClient,
  actorId: string,
  input: Associate,
  authorized: CaseFieldReadAuthorization,
) {
  return write(
    db,
    actorId,
    setGovernedCriterionRequirementInput.parse(input),
    "SET_CRITERION_REQUIREMENT",
    authorized,
  );
}

export async function listGovernanceRequirementChoices(
  db: PrismaClient,
  actorId: string,
  raw: z.input<typeof requirementChoiceInput>,
  authorized: CaseFieldReadAuthorization,
) {
  const input = requirementChoiceInput.parse(raw);
  return db.$transaction(
    async (tx) => {
      const scope = await lockCaseFieldReadScope(
        tx,
        actorId,
        input,
        authorized,
      );
      await lockPlan(tx, input, false);
      const where: Prisma.RequirementWhereInput = {
        projectId: input.projectId,
        ...(input.cursor ? { id: { gt: input.cursor } } : {}),
        ...(input.search
          ? {
              OR: [
                { id: { contains: input.search, mode: "insensitive" } },
                { title: { contains: input.search, mode: "insensitive" } },
              ],
            }
          : {}),
      };
      const identities = await tx.requirement.findMany({
        where,
        orderBy: { id: "asc" },
        take: input.take + 1,
        select: { id: true },
      });
      const page = identities.slice(0, input.take);
      if (page.length) {
        const [size] = await tx.$queryRaw<
          Array<{ bytes: bigint; largest: number }>
        >`SELECT coalesce(sum(octet_length(title)),0)::bigint AS bytes,coalesce(max(length(title)),0)::int AS largest FROM "Requirement" WHERE id IN (${Prisma.join(page.map((row) => row.id))}) AND "projectId"=${input.projectId}`;
        if (
          !size ||
          size.bytes > BigInt(MAX_GOVERNANCE_SNAPSHOT_BYTES) ||
          size.largest > 10000
        )
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "The complete requirement choice page exceeds its supported read bounds. No titles were truncated; narrow the search.",
          });
      }
      const choices = page.length
        ? await tx.requirement.findMany({
            where: {
              id: { in: page.map((row) => row.id) },
              projectId: input.projectId,
            },
            select: { id: true, title: true },
            orderBy: { id: "asc" },
          })
        : [];
      return {
        scope,
        testPlanId: input.testPlanId,
        choices,
        nextCursor:
          identities.length > input.take ? (page.at(-1)?.id ?? null) : null,
      };
    },
    { isolationLevel: "RepeatableRead", timeout: 10000, maxWait: 5000 },
  );
}
/** Compatibility only: old callers have no retained UUID or original verdict
 * revision. Their wording/optional requirement is an expectation, never an
 * edit. Locked current FULL-editor/actor checks and status-only UPDATE prevent
 * stale forms from overwriting governed text. This is not durable receipt or
 * complete version-history coverage; use the dedicated route for new writes. */
export async function setLegacyCriterionVerdict(
  db: PrismaClient,
  actorId: string,
  input: {
    projectId: string;
    testPlanId: string;
    id: string;
    description: string;
    status: Verdict["status"];
    requirementId?: string | null;
  },
  authorized: CaseFieldReadAuthorization,
) {
  return db.$transaction(
    async (tx) => {
      const project = await tx.project.findUniqueOrThrow({
        where: { id: input.projectId },
        select: { organizationId: true },
      });
      const pins = {
        projectId: input.projectId,
        testPlanId: input.testPlanId,
        originalOrganizationId: project.organizationId,
        expectedClerkActorId: authorized.clerkActorId,
      };
      await writeScope(tx, actorId, pins, authorized);
      await lockPlan(tx, pins, true);
      const current = await snapshot(tx, pins, true),
        criterion = current.criteria.find((c) => c.id === input.id);
      if (!criterion)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Criterion not found in the original plan.",
        });
      if (
        criterion.description !== input.description ||
        (input.requirementId !== undefined &&
          criterion.requirementId !== input.requirementId)
      )
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "Criterion wording or requirement association changed. Refresh before changing its verdict; use the governed wording editor for intentional text changes.",
        });
      if (["APPROVED", "ARCHIVED"].includes(current.status))
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "Reopen this approved or archived plan before changing its verdict.",
        });
      if (current.releaseId)
        await assertPlanningRelease(tx, input.projectId, current.releaseId);
      await assertManualVerdict(tx, pins);
      return tx.acceptanceCriterion.update({
        where: { id: criterion.id },
        data: { status: input.status },
      });
    },
    { timeout: 10000, maxWait: 5000 },
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
