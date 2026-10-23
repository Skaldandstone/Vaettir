// Source-authored only. No tests executed during deferred validation.
import { describe, it, expect } from "vitest";
import { requirementBaselineAckMatches, retainRequirementBaselineCapture } from "./requirement-baseline-ack";
import { requirementBaselineAcknowledgementKey, type RequirementBaselineCapture } from "@vaettir/api/src/services/requirementBaselineSchema";
const origin = { organizationId: "org", clerkActorId: "clerk" };
const request: RequirementBaselineCapture = { projectId: "project", requirementId: "requirement", requestId: "f74dbd60-7425-41b5-aa5a-481d8bc6a0bf", expectedLatestVersion: 0, currentFingerprint: "a".repeat(64), rationale: "Retained human review", acknowledgeNotVerifiedCoverage: true, expectedScope: origin };
const ack = (input = request) => ({ projectId: input.projectId, organizationId: origin.organizationId, clerkActorId: origin.clerkActorId, requestId: input.requestId, baselineId: "baseline", displayId: "SYN-B00001", version: input.expectedLatestVersion + 1, requirementId: input.requirementId, capturedFingerprint: input.currentFingerprint, acknowledgementKey: requirementBaselineAcknowledgementKey(input) });
describe("baseline response-only acknowledgement and uncertain payload (authored)", () => {
  it("accepts only exact original actor/org/request/requirement/captured scope and supports legacy omission without mutating input", () => {
    expect(requirementBaselineAckMatches(ack(), request, origin)).toBe(true);
    for (const changed of [{ organizationId: "other" }, { clerkActorId: "other" }, { projectId: "other" }, { requirementId: "other" }, { requestId: "00000000-0000-4000-8000-000000000001" }, { capturedFingerprint: "b".repeat(64) }, { version: 2 }, { acknowledgementKey: "wrong" }])
      expect(requirementBaselineAckMatches({ ...ack(), ...changed }, request, origin)).toBe(false);
    const { expectedScope: _scope, ...legacy } = request;
    const before = structuredClone(legacy);
    expect(requirementBaselineAckMatches(ack(legacy), legacy, origin)).toBe(true);
    expect(legacy).toEqual(before);
    expect(Object.hasOwn(legacy, "expectedScope")).toBe(false);
  });
  it("an uncertain outcome retains the same UUID/rationale through subsequent typed refusal rather than creating a replacement", () => {
    const previous = { input: request, uncertain: false };
    expect(retainRequirementBaselineCapture(previous, { data: { code: "CONFLICT" } })).toBeNull();
    const unknown = retainRequirementBaselineCapture(previous, Error("Synthetic lost commit response"));
    expect(unknown?.input).toBe(request);
    expect(unknown?.uncertain).toBe(true);
    const later = retainRequirementBaselineCapture(unknown!, { data: { code: "PRECONDITION_FAILED" } });
    expect(later?.input).toBe(request);
    expect(later?.input.requestId).toBe(request.requestId);
    expect(later?.input.rationale).toBe(request.rationale);
  });
});
