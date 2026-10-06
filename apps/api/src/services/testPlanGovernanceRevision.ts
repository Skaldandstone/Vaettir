import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { qualityProfileHash } from "./qualityExperienceProfile.js";
import {
  MAX_GOVERNANCE_SNAPSHOT_BYTES,
  MAX_GOVERNANCE_RECEIPT_BYTES,
  planGovernanceSnapshot,
  planGovernanceReceipt,
  type PlanGovernanceSnapshot,
} from "./testPlanGovernanceSchema.js";
export function boundedGovernanceSnapshot(
  value: unknown,
): PlanGovernanceSnapshot {
  const parsed = planGovernanceSnapshot.safeParse(value);
  if (
    !parsed.success ||
    (parsed.success &&
      (new Set(parsed.data.criteria.map((c) => c.id)).size !==
        parsed.data.criteria.length ||
        parsed.data.criteria.some((c) => c.testPlanId !== parsed.data.id))) ||
    Buffer.byteLength(JSON.stringify(parsed.data), "utf8") >
      MAX_GOVERNANCE_SNAPSHOT_BYTES
  )
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "The complete plan governance snapshot exceeds its supported bounds. No criteria, assignment or metadata were truncated or replaced.",
    });
  return parsed.data;
}
export function governancePlanRevision(snapshot: PlanGovernanceSnapshot) {
  return qualityProfileHash(snapshot);
}
export function governanceCriterionRevision(
  snapshot: PlanGovernanceSnapshot["criteria"][number],
) {
  return qualityProfileHash(snapshot);
}
export function governanceRequestHash(input: unknown) {
  return qualityProfileHash(input);
}
export function governanceAuditId(
  projectId: string,
  actorId: string,
  requestId: string,
) {
  return `plan_governance_${createHash("sha256")
    .update(JSON.stringify([projectId, actorId, requestId]))
    .digest("hex")}`;
}
export function assertGovernanceReceiptBytes(value: unknown) {
  if (
    Buffer.byteLength(JSON.stringify(value), "utf8") >
    MAX_GOVERNANCE_RECEIPT_BYTES
  )
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "The complete governance receipt exceeds its bounded size. No partial history was saved.",
    });
}
export function validatedGovernanceReceipt(value: unknown) {
  const parsed = planGovernanceReceipt.safeParse(value);
  if (!parsed.success)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "This complete governance receipt has an unsupported format. No partial acknowledgement was used.",
    });
  const receipt = parsed.data,
    { before, after, ack } = receipt;
  boundedGovernanceSnapshot(before);
  boundedGovernanceSnapshot(after);
  let expectedCriteria = before.criteria;
  const isHeader = ack.operation === "EDIT_PLAN_HEADER";
  if (
    ack.operation === "EDIT_CRITERION_DESCRIPTION" ||
    ack.operation === "SET_CRITERION_VERDICT" ||
    ack.operation === "SET_CRITERION_REQUIREMENT"
  ) {
    if (
      !ack.criterionId ||
      !before.criteria.some((c) => c.id === ack.criterionId) ||
      before.releaseId !== after.releaseId
    )
      return invalid();
    const changed = after.criteria.find((c) => c.id === ack.criterionId);
    if (!changed) return invalid();
    expectedCriteria = before.criteria.map((c) =>
      c.id === ack.criterionId
        ? ack.operation === "SET_CRITERION_VERDICT"
          ? { ...c, status: changed.status }
          : ack.operation === "SET_CRITERION_REQUIREMENT"
            ? { ...c, requirementId: changed.requirementId }
            : { ...c, description: changed.description }
        : c,
    );
  } else if (ack.operation === "ADD_CRITERION") {
    const added = after.criteria.find((c) => c.id === ack.criterionId);
    if (
      !ack.criterionId ||
      !added ||
      before.criteria.some((c) => c.id === added.id) ||
      after.criteria.length !== before.criteria.length + 1 ||
      added.status !== "PENDING" ||
      added.testPlanId !== ack.testPlanId ||
      before.releaseId !== after.releaseId ||
      governanceRequestHash(after.criteria.filter((c) => c.id !== added.id)) !==
        governanceRequestHash(before.criteria)
    )
      return invalid();
    expectedCriteria = after.criteria;
  } else if (ack.operation === "DELETE_CRITERION") {
    if (
      !ack.criterionId ||
      !before.criteria.some((c) => c.id === ack.criterionId) ||
      after.criteria.some((c) => c.id === ack.criterionId) ||
      before.releaseId !== after.releaseId
    )
      return invalid();
    expectedCriteria = before.criteria.filter((c) => c.id !== ack.criterionId);
  } else if (isHeader) {
    if (
      ack.criterionId !== null ||
      before.releaseId !== after.releaseId ||
      (before.name === after.name &&
        before.description === after.description) ||
      (before.name !== after.name && !after.name.trim())
    )
      return invalid();
  } else if (
    ack.criterionId !== null ||
    before.releaseId !== null ||
    !after.releaseId
  )
    return invalid();
  const expectedAfter = {
    ...before,
    ...(isHeader ? { name: after.name, description: after.description } : {}),
    releaseId: after.releaseId,
    updatedAt: after.updatedAt,
    updatedById: after.updatedById,
    latestVersion: after.latestVersion,
    criteria: expectedCriteria,
  };
  if (
    before.id !== ack.testPlanId ||
    after.id !== ack.testPlanId ||
    before.projectId !== ack.scope.projectId ||
    after.projectId !== ack.scope.projectId ||
    ack.releaseId !== after.releaseId ||
    ack.versionId !== after.latestVersion?.id ||
    ack.versionNumber !== after.latestVersion?.versionNumber ||
    ack.versionNumber !== (before.latestVersion?.versionNumber ?? 0) + 1 ||
    after.updatedById !== ack.scope.actorId ||
    ack.beforeRevision !== governancePlanRevision(before) ||
    ack.afterRevision !== governancePlanRevision(after) ||
    governancePlanRevision(expectedAfter) !== governancePlanRevision(after)
  )
    return invalid();
  assertGovernanceReceiptBytes(receipt);
  return receipt;
  function invalid(): never {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "The governance receipt does not preserve its complete scoped snapshot and version. No partial acknowledgement was used.",
    });
  }
}
