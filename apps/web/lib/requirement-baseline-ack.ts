import { requirementBaselineAcknowledgement, requirementBaselineAcknowledgementKey, type RequirementBaselineCapture } from "@vaettir/api/src/services/requirementBaselineSchema";
import { retainSavedQueryRequest } from "./saved-case-query-recovery";
export type RequirementBaselineOrigin = { organizationId: string; clerkActorId: string };
export function requirementBaselineAckMatches(value: unknown, request: RequirementBaselineCapture, origin: RequirementBaselineOrigin) {
  const parsed = requirementBaselineAcknowledgement.safeParse(value);
  if (!parsed.success) return false;
  const receipt = parsed.data, expected = request.expectedScope ?? origin;
  return receipt.projectId === request.projectId && receipt.organizationId === expected.organizationId && receipt.clerkActorId === expected.clerkActorId &&
    expected.organizationId === origin.organizationId && expected.clerkActorId === origin.clerkActorId &&
    receipt.requestId === request.requestId && receipt.requirementId === request.requirementId && receipt.capturedFingerprint === request.currentFingerprint &&
    receipt.version === request.expectedLatestVersion + 1 && receipt.acknowledgementKey === requirementBaselineAcknowledgementKey(request);
}
export function retainRequirementBaselineCapture(receipt: { input: RequirementBaselineCapture; uncertain: boolean }, error: unknown) {
  return retainSavedQueryRequest(receipt.uncertain, error) ? { ...receipt, uncertain: true } : null;
}
