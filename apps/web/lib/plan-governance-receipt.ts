import { retainedTraceabilityReceipt } from "./traceability-receipt.ts";
import type { CaseFieldOrigin } from "./case-field-origin.ts";
export type GovernanceScope = {
  projectId: string;
  organizationId: string;
  actorId: string;
  actorClerkUserId: string;
};
export function sameGovernanceReader(
  scope: GovernanceScope | undefined,
  original: CaseFieldOrigin | null,
) {
  return (
    !!scope?.actorId &&
    !!original &&
    scope.projectId === original.projectId &&
    scope.organizationId === original.organizationId &&
    scope.actorClerkUserId === original.clerkActorId
  );
}
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
export async function planGovernanceRequestHash(
  operation: string,
  input: unknown,
) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalJson({ operation, input })),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
export type GovernancePending<T> = {
  input: T;
  origin: CaseFieldOrigin;
  operation: "EDIT_CRITERION_DESCRIPTION" | "ATTACH_UNASSIGNED_PLAN";
  requestHash: string;
  uncertain: boolean;
};
export function retainedGovernancePending<T>(
  pending: GovernancePending<T>,
  cause: unknown,
): GovernancePending<T> | null {
  const retained = retainedTraceabilityReceipt(pending, cause);
  return retained ? { ...pending, uncertain: retained.uncertain } : null;
}
export function assertGovernanceAcknowledgement(
  saved: {
    scope: GovernanceScope;
    requestId: string;
    requestHash: string;
    operation: string;
    testPlanId: string;
    criterionId: string | null;
    releaseId: string | null;
    versionId: string;
    versionNumber: number;
    beforeRevision: string;
    afterRevision: string;
    replayed: boolean;
  },
  pending: GovernancePending<{
    requestId: string;
    testPlanId: string;
    expectedPlanRevision: string;
    criterionId?: string;
    releaseId?: string;
  }>,
) {
  const input = pending.input;
  if (
    !sameGovernanceReader(saved.scope, pending.origin) ||
    saved.requestId !== input.requestId ||
    saved.requestHash !== pending.requestHash ||
    saved.operation !== pending.operation ||
    saved.testPlanId !== input.testPlanId ||
    saved.criterionId !== (input.criterionId ?? null) ||
    (input.releaseId !== undefined && saved.releaseId !== input.releaseId) ||
    saved.beforeRevision !== input.expectedPlanRevision ||
    !saved.versionId ||
    !Number.isInteger(saved.versionNumber) ||
    saved.versionNumber < 1 ||
    !/^[a-f0-9]{64}$/.test(saved.afterRevision) ||
    typeof saved.replayed !== "boolean"
  )
    throw new Error(
      "The response did not acknowledge this exact original governance request. Retain and retry the same request.",
    );
}
