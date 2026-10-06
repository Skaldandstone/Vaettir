import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { decodeStepReviewWire } from "./step-execution-review-draft";
import { stepObservationBuffer, stepObservationEvidence } from "./step-observation-buffer";
function preview(note: string | null = null) {
  const current = { id: "old", status: "FAIL", note, observations: { specimen: "", hardwareRevision: " rev ", firmwareVersion: "", environment: " lab\n context ", measurements: [{ name: " Voltage ", unit: "V", value: 0, upperLimit: 2, instrument: " meter " }] }, evidenceAttachments: [{ id: "unavailable", fileName: " exact old label " }], actorName: "Stored author", recordedAt: "2026-10-05T20:00:00.123Z", correctionReason: "Historical reason must not approve a new correction", previousRevisionId: null, revisionNumber: 1 };
  return decodeStepReviewWire({ projectId: "p", testRunId: "r", testCaseId: "c", stepIndex: 0, readRequestId: randomUUID(), scope: { projectId: "p", organizationId: "o", actorId: "n", actorClerkUserId: "cl" }, canRecover: true, canRecord: true, supported: true, blockedReason: null, frozenDefinition: { testCaseId: "c", steps: [{ order: 0, action: "Click", expectedActionOrData: "GET /apiURL" }] }, current, rawCurrent: current, procedureHash: "a".repeat(64), currentFingerprint: "b".repeat(64), provenance: "CURRENT_AUTHORITY_LEGACY_ORIGINAL_TENANCY_UNRECORDED" });
}
it.each([null, "", " exact\n note "])("explicit new draft retains exact note %j, context, zero and unavailable references", note => {
  const source = preview(note), buffer = stepObservationBuffer(source);
  expect(buffer.note).toBe(note); expect(buffer.context).toEqual(source.current?.observations && { specimen: "", hardwareRevision: " rev ", firmwareVersion: "", environment: " lab\n context " });
  expect(buffer.readings[0]).toEqual({ name: " Voltage ", unit: "V", value: "0", lowerLimit: "", upperLimit: "2", instrument: " meter " });
  expect(buffer.evidenceAttachmentIds).toEqual(["unavailable"]); expect(buffer.correctionReason).toBeNull(); expect(Object.isFrozen(buffer)).toBe(true);
});
it("new unrecorded step requires explicit outcome and distinguishes initial NULL note from empty text", () => {
  const source = preview(); const buffer = stepObservationBuffer({ ...source, current: null, rawCurrent: null });
  expect(buffer.status).toBe(""); expect(buffer.note).toBeNull(); expect(buffer.readings).toEqual([]); expect(buffer.evidenceAttachmentIds).toEqual([]);
});
it.each(["supported", "canRecord"] as const)("a refused %s projection cannot seed an editable buffer", key => {
  expect(() => stepObservationBuffer({ ...preview(), [key]: false })).toThrow("fresh editable");
});
it("picker deltas preserve unavailable selections and raw duplicates; limits/refusals never prune", () => {
  const original = { ...stepObservationBuffer(preview()), evidenceAttachmentIds: ["unavailable", "duplicate", "duplicate"] };
  expect(stepObservationEvidence(original, "new", true).evidenceAttachmentIds).toEqual(["unavailable", "duplicate", "duplicate", "new"]);
  expect(stepObservationEvidence(original, "duplicate", true).evidenceAttachmentIds).toEqual(original.evidenceAttachmentIds);
  expect(stepObservationEvidence(original, "duplicate", false).evidenceAttachmentIds).toEqual(["unavailable"]);
  const full = { ...original, evidenceAttachmentIds: Array.from({ length: 20 }, (_, n) => `retained-${n}`) };
  expect(() => stepObservationEvidence(full, "extra", true)).toThrow("20 evidence"); expect(full.evidenceAttachmentIds).toHaveLength(20);
  expect(() => stepObservationEvidence(original, "\ud800", true)).toThrow("Unsupported evidence"); expect(original.evidenceAttachmentIds).toHaveLength(3);
});
