import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { Prisma } from "@vaettir/db";
import { resolveReportReleaseScope } from "./reportReleaseScope.js";
import type { FrozenReportPayload } from "../routers/reportSnapshots.js";
import {
  retainedReportDefinitionStateSchema,
  type ReportDefinitionManageInput,
} from "./reportDefinitionLifecycleSchema.js";
type Definition = FrozenReportPayload["definition"];
type ParseDefinition = (value: unknown) => Definition;
type Head = {
  id: string;
  userId: string;
  name: string;
  definition: Prisma.JsonValue;
  visibility: string;
  archivedAt: Date | null;
  version: number;
};
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const conflict = () =>
  new TRPCError({
    code: "CONFLICT",
    message:
      "The definition or review changed. Refresh without replacing your pending request.",
  });
export function retainedReportDefinitionState(
  row: Head,
  parse: ParseDefinition,
) {
  const state = retainedReportDefinitionStateSchema.parse({
    name: row.name,
    definition: parse(row.definition),
    visibility: row.visibility,
    archived: !!row.archivedAt,
    version: row.version,
  });
  if (Buffer.byteLength(JSON.stringify(state)) > 16384)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Definition exceeds the supported history size; no partial record substituted.",
    });
  return { ...state, definition: parse(state.definition) };
}
async function permissions(
  tx: Prisma.TransactionClient,
  orgId: string,
  actorId: string,
) {
  const member = await tx.membership.findUnique({
    where: {
      organizationId_userId: { organizationId: orgId, userId: actorId },
    },
  });
  if (!member) throw new TRPCError({ code: "FORBIDDEN" });
  const full = member.seatType === "FULL";
  return {
    admin: full && ["OWNER", "ADMIN"].includes(member.role),
    editor: full && ["OWNER", "ADMIN", "EDITOR"].includes(member.role),
  };
}
async function head(
  tx: Prisma.TransactionClient,
  projectId: string,
  orgId: string,
  actorId: string,
  id: string,
) {
  const row = await tx.projectReportDefinition.findFirst({
    where: {
      id,
      projectId,
      organizationId: orgId,
      OR: [{ userId: actorId }, { visibility: "project" }],
    },
  });
  if (!row) throw new TRPCError({ code: "NOT_FOUND" });
  return row;
}
export async function reportDefinitionList(
  tx: Prisma.TransactionClient,
  projectId: string,
  orgId: string,
  actorId: string,
  page: number,
  includeArchived: boolean,
) {
  const rights = await permissions(tx, orgId, actorId);
  const where = {
    projectId,
    organizationId: orgId,
    OR: [{ userId: actorId }, { visibility: "project" }],
    ...(includeArchived ? {} : { archivedAt: null }),
  };
  const rows = await tx.projectReportDefinition.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    take: 21,
    skip: page * 20,
    select: {
      id: true,
      userId: true,
      name: true,
      version: true,
      visibility: true,
      archivedAt: true,
      updatedAt: true,
    },
  });
  return {
    projectId,
    page,
    includeArchived,
    total: await tx.projectReportDefinition.count({ where }),
    hasMore: rows.length > 20,
    items: rows.slice(0, 20).map((row) => ({
      id: row.id,
      name: row.name,
      version: row.version,
      visibility: row.visibility,
      archivedAt: row.archivedAt,
      updatedAt: row.updatedAt,
      canManage:
        rights.editor &&
        (row.visibility === "project" ? rights.admin : row.userId === actorId),
      canShare: rights.admin && row.userId === actorId,
    })),
    limitations: [
      "Private definitions belong to their author; project-shared definitions are visible to current project members.",
      "Sharing settings also shares saved author commentary, not captured reports. A capture still needs separate approval.",
      "Archived definitions/history remain retained and count toward capacity. No customer records are deleted.",
    ],
  };
}
export async function reportDefinitionHistory(
  tx: Prisma.TransactionClient,
  projectId: string,
  orgId: string,
  actorId: string,
  id: string,
  page: number,
  parse: ParseDefinition,
) {
  const row = await head(tx, projectId, orgId, actorId, id),
    rights = await permissions(tx, orgId, actorId);
  const rows = await tx.projectReportDefinitionWrite.findMany({
    where: { definitionId: id, projectId, organizationId: orgId },
    orderBy: [{ createdAt: "desc" }, { key: "asc" }],
    skip: page * 10,
    take: 11,
    select: {
      key: true,
      appliedVersion: true,
      createdAt: true,
      beforeState: true,
      afterState: true,
    },
  });
  const decode = (value: Prisma.JsonValue | null) => {
    if (!value) return null;
    const result = retainedReportDefinitionStateSchema.safeParse(value);
    if (!result.success || Buffer.byteLength(JSON.stringify(value)) > 16384)
      return null;
    if (result.data.visibility === "private" && row.userId !== actorId)
      return null;
    try {
      return { ...result.data, definition: parse(result.data.definition) };
    } catch {
      return null;
    }
  };
  return {
    projectId,
    id,
    page,
    current: retainedReportDefinitionState(row, parse),
    canManage:
      rights.editor &&
      (row.visibility === "project" ? rights.admin : row.userId === actorId),
    canShare: rights.admin && row.userId === actorId,
    hasMore: rows.length > 10,
    items: rows.slice(0, 10).map((receipt) => ({
      key: receipt.key,
      appliedVersion: receipt.appliedVersion,
      createdAt: receipt.createdAt,
      before: decode(receipt.beforeState),
      after: decode(receipt.afterState),
    })),
    limitation:
      "Historical bodies exist only for newly recorded writes. Private historical states remain author-only even when the current definition is shared. Unavailable or legacy bodies cannot reconstruct settings. Restoration creates a new version, never rewrites a capture or receipt.",
  };
}
export async function manageReportDefinition(
  tx: Prisma.TransactionClient,
  orgId: string,
  actorId: string,
  input: ReportDefinitionManageInput,
  parse: ParseDefinition,
) {
  const row = await head(tx, input.projectId, orgId, actorId, input.id),
    rights = await permissions(tx, orgId, actorId);
  if (
    !rights.editor ||
    (row.visibility === "project" ? !rights.admin : row.userId !== actorId)
  )
    throw new TRPCError({ code: "FORBIDDEN" });
  if (input.action.kind === "visibility" && !rights.admin)
    throw new TRPCError({ code: "FORBIDDEN" });
  if (
    (input.action.kind === "visibility" || input.action.kind === "restore") &&
    !rights.admin &&
    input.approveProjectSharing
  )
    throw new TRPCError({ code: "FORBIDDEN" });
  const key = hash([input.projectId, actorId, input.requestId]),
    requestHash = hash(["definition-lifecycle", input]);
  const prior = await tx.projectReportDefinitionWrite.findUnique({
    where: { key },
  });
  if (prior) {
    if (
      prior.organizationId !== orgId ||
      prior.actorId !== actorId ||
      prior.projectId !== input.projectId ||
      prior.definitionId !== input.id ||
      prior.requestHash !== requestHash
    )
      throw conflict();
    if (
      !rights.admin &&
      [prior.beforeState, prior.afterState].some((state) => {
        const decoded = retainedReportDefinitionStateSchema.safeParse(state);
        return decoded.success && decoded.data.visibility === "project";
      })
    )
      throw new TRPCError({ code: "FORBIDDEN" });
    return {
      id: prior.definitionId,
      version: prior.appliedVersion,
      replay: true,
    };
  }
  if (row.version !== input.version) throw conflict();
  const before = retainedReportDefinitionState(row, parse);
  let after = { ...before, version: before.version + 1 };
  if (input.action.kind === "settings") {
    after.definition = parse(input.action.definition);
  }
  if (input.action.kind === "rename") after.name = input.action.name;
  if (input.action.kind === "visibility") {
    if (
      !rights.admin ||
      (input.action.visibility === "private" && row.userId !== actorId)
    )
      throw new TRPCError({
        code: "FORBIDDEN",
        message:
          "Only the current full-seat author administrator can change visibility.",
      });
    after.visibility = input.action.visibility;
  }
  if (input.action.kind === "archive") after.archived = input.action.archived;
  if (input.action.kind === "restore") {
    const receipt = await tx.projectReportDefinitionWrite.findFirst({
      where: {
        key: input.action.receiptKey,
        definitionId: input.id,
        projectId: input.projectId,
        organizationId: orgId,
      },
    });
    if (!receipt) throw new TRPCError({ code: "NOT_FOUND" });
    const raw =
      input.action.side === "before" ? receipt.beforeState : receipt.afterState;
    if (!raw || Buffer.byteLength(JSON.stringify(raw)) > 16384)
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "This receipt has no supported retained body; no inferred settings substituted.",
      });
    const retained = retainedReportDefinitionStateSchema.safeParse(raw);
    if (!retained.success) throw new TRPCError({ code: "PRECONDITION_FAILED" });
    if (retained.data.visibility === "private" && row.userId !== actorId)
      throw new TRPCError({ code: "NOT_FOUND" });
    try {
      after = {
        ...retained.data,
        definition: parse(retained.data.definition),
        version: before.version + 1,
      };
    } catch {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "Retained settings are unsupported. No inferred or partial restoration was applied.",
      });
    }
    if (
      after.visibility !== before.visibility &&
      (!rights.admin || row.userId !== actorId)
    )
      throw new TRPCError({ code: "FORBIDDEN" });
  }
  if (input.action.kind === "settings" || input.action.kind === "restore") {
    const scope = after.definition.executionScope;
    if (scope?.releaseId) {
      const release = await resolveReportReleaseScope(
        tx,
        input.projectId,
        scope.releaseId,
      );
      if (scope.planId && !release.planIds.includes(scope.planId))
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Selected plan does not belong to this release; no settings saved.",
        });
    }
    if (scope?.planId) {
      const plans = await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT id FROM "TestPlan" WHERE id=${scope.planId} AND "projectId"=${input.projectId} FOR KEY SHARE`;
      if (plans.length !== 1)
        throw new TRPCError({
          code: "NOT_FOUND",
          message:
            "Selected plan is unavailable in this project; no settings saved.",
        });
    }
    if (scope?.runId) {
      const runs = await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT id FROM "TestRun" WHERE id=${scope.runId} AND "projectId"=${input.projectId} FOR KEY SHARE`;
      if (runs.length !== 1)
        throw new TRPCError({
          code: "NOT_FOUND",
          message:
            "Selected run is unavailable in this project; no settings saved.",
        });
    }
  }
  if (
    after.visibility === "project" &&
    (!rights.admin || !input.approveProjectSharing)
  )
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "A full-seat Owner/Admin must explicitly review project-sharing settings and commentary.",
    });
  if (hash({ ...after, version: before.version }) === hash(before))
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Nothing changed; no history version was created.",
    });
  if (Buffer.byteLength(JSON.stringify(after)) > 16384)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Reviewed settings exceed the supported history size; nothing was partially saved.",
    });
  if (
    (await tx.projectReportDefinitionWrite.count({
      where: { projectId: input.projectId },
    })) >= 2000
  )
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Definition retry/history capacity reached. Existing records remain retained.",
    });
  if (
    after.visibility === "project" &&
    before.visibility !== "project" &&
    (await tx.projectReportDefinition.count({
      where: {
        projectId: input.projectId,
        organizationId: orgId,
        visibility: "project",
      },
    })) >= 50
  )
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Keep at most 50 retained project-shared definitions, including archives.",
    });
  const updated = await tx.projectReportDefinition.updateMany({
    where: {
      id: input.id,
      projectId: input.projectId,
      organizationId: orgId,
      version: input.version,
    },
    data: {
      name: after.name,
      definition: after.definition,
      visibility: after.visibility,
      archivedAt: after.archived ? (row.archivedAt ?? new Date()) : null,
      version: { increment: 1 },
    },
  });
  if (updated.count !== 1) throw conflict();
  await tx.projectReportDefinitionWrite.create({
    data: {
      key,
      projectId: input.projectId,
      organizationId: orgId,
      actorId,
      requestHash,
      definitionId: input.id,
      appliedVersion: after.version,
      beforeState: before,
      afterState: after,
    },
  });
  await tx.auditLog.create({
    data: {
      organizationId: orgId,
      userId: actorId,
      action: "REPORT_DEFINITION_REVIEWED_CHANGE",
      resourceType: "ProjectReportDefinition",
      resourceId: input.id,
      metadata: {
        projectId: input.projectId,
        kind: input.action.kind,
        reason: input.reason,
        beforeVersion: before.version,
        afterVersion: after.version,
        requestKey: key,
      },
    },
  });
  return { id: input.id, version: after.version, replay: false };
}
