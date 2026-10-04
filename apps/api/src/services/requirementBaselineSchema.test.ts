import { describe, it, expect } from "vitest";
import { requirementBaselineCaptureInput, requirementBaselineSnapshot, requirementBaselineDetailInput, requirementBaselineReceipt, requirementBaselineAcknowledgementKey } from "./requirementBaselineSchema.js";
// Authored only during deferred-validation source increment.
describe("bounded reviewed requirement baseline schema", () => {
  it("preserves exact omitted legacy capture/receipt shapes and admits only complete bound org/Clerk scope", () => {
    const capture = { projectId: "project", requirementId: "requirement", requestId: "f74dbd60-7425-41b5-aa5a-481d8bc6a0bf", expectedLatestVersion: 0, currentFingerprint: "a".repeat(64), rationale: "Original human rationale", acknowledgeNotVerifiedCoverage: true };
    expect(requirementBaselineCaptureInput.parse(capture)).toEqual(capture);
    expect(Object.hasOwn(requirementBaselineCaptureInput.parse(capture), "expectedScope")).toBe(false);
    const bound = requirementBaselineCaptureInput.parse({ ...capture, expectedScope: { organizationId: "org", clerkActorId: "clerk" } });
    expect(requirementBaselineAcknowledgementKey(bound)).not.toBe(requirementBaselineAcknowledgementKey(requirementBaselineCaptureInput.parse(capture)));
    for (const expectedScope of [{ organizationId: "org" }, { clerkActorId: "clerk" }, { organizationId: "", clerkActorId: "clerk" }, { organizationId: "org", clerkActorId: "clerk", role: "OWNER" }])
      expect(requirementBaselineCaptureInput.safeParse({ ...capture, expectedScope }).success).toBe(false);
    const receipt = { requestId: capture.requestId, baselineId: "baseline", displayId: "SYN-B00001", version: 1 };
    expect(requirementBaselineReceipt.parse(receipt)).toEqual(receipt);
    expect(requirementBaselineReceipt.safeParse({ ...receipt, organizationId: "org" }).success).toBe(false);
  });
  const snapshot = { version: 1, requirement: { title: "Synthetic requirement", description: "Native authored intent",
    externalRef: null, externalRefWithheld: false, linearIssueId: null, jiraIssueKey: null, issueIdentifiersWithheld: false }, links: [] };
  it("accepts recorded native text and refuses provider/raw/share-token fields", () => {
    expect(requirementBaselineSnapshot.parse(snapshot)).toEqual(snapshot);
    expect(() => requirementBaselineSnapshot.parse({ ...snapshot, rawProviderBody: "not retained" })).toThrow();
    expect(() => requirementBaselineSnapshot.parse({ ...snapshot, requirement: { ...snapshot.requirement, shareToken: "not retained" } })).toThrow();
  });
  it("bounds full UTF-8 capture and direct link population without truncation", () => {
    expect(() => requirementBaselineSnapshot.parse({ ...snapshot, requirement: { ...snapshot.requirement, description: "界".repeat(10001) } })).toThrow();
    expect(() => requirementBaselineSnapshot.parse({ ...snapshot, links: Array.from({ length: 41 }, (_, n) => ({ id: `link${n}`, caseId: `case${n}`,
      displayId: `SYN-${n}`, title: "Synthetic", titleIsExcerpt: false, archived: false })) })).toThrow();
    expect(() => requirementBaselineSnapshot.parse({ ...snapshot, requirement: { ...snapshot.requirement, description: "\u0000".repeat(10000) } })).toThrow();
  });
  it("requires exact preview fingerprint, prior latest version, rationale, acknowledgement and actor receipt", () => {
    const capture = { projectId: "project", requirementId: "requirement", requestId: "f74dbd60-7425-41b5-aa5a-481d8bc6a0bf",
      expectedLatestVersion: 0, currentFingerprint: "a".repeat(64), rationale: "Reviewed native scope", acknowledgeNotVerifiedCoverage: true };
    expect(requirementBaselineCaptureInput.parse(capture)).toEqual(capture);
    expect(() => requirementBaselineCaptureInput.parse({ ...capture, actorId: "forged" })).toThrow();
    expect(() => requirementBaselineCaptureInput.parse({ ...capture, acknowledgeNotVerifiedCoverage: false })).toThrow();
    expect(() => requirementBaselineCaptureInput.parse({ ...capture, rationale: " " })).toThrow();
    expect(() => requirementBaselineCaptureInput.parse({ ...capture, expectedLatestVersion: 100 })).toThrow();
  });
  it("requires a native requirement or retained baseline and bounded history/candidate pages", () => {
    expect(() => requirementBaselineDetailInput.parse({ projectId: "project" })).toThrow();
    expect(requirementBaselineDetailInput.parse({ projectId: "project", baselineId: "baseline" })).toMatchObject({ affectedOffset: 0, historyOffset: 0 });
    expect(() => requirementBaselineDetailInput.parse({ projectId: "project", requirementId: "requirement", affectedOffset: 61 })).toThrow();
  });
});
