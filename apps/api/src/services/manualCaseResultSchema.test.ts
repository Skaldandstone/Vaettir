// SOURCE ONLY: authored, not executed tonight.
import { describe, expect, it } from "vitest";
import { manualCaseResultWriteSchema, manualCaseResultReadSchema, manualCaseResultHistorySchema, manualCaseResultWriteKey, manualCaseResultRevisionOutputSchema } from "./manualCaseResultSchema.js";
const scope = { projectId: "project", organizationId: "org", clerkActorId: "clerk" };
const read = { projectId: "project", testRunId: "run", testCaseId: "case", expectedScope: scope };
const request = { ...read, expectedRevisionId: null, expectedCurrentFingerprint: "a".repeat(64), status: "FAIL" as const, note: "Literal old observation", observations: {}, correctionReason: "A human correction", idempotencyKey: "88c47b3b-d1f7-43b5-bd88-b49ddf14b8c0" };
describe("whole-case native result strict reviewed schema", () => {
  it("requires original actor/project/org and exact CAS without arbitrary permission fields", () => {
    expect(manualCaseResultReadSchema.safeParse({ projectId: "project", testRunId: "run", testCaseId: "case" }).success).toBe(false);
    expect(manualCaseResultReadSchema.safeParse({ ...read, role: "OWNER" }).success).toBe(false);
    expect(manualCaseResultWriteSchema.safeParse({ ...request, expectedRevisionId: undefined }).success).toBe(false);
    expect(manualCaseResultWriteSchema.safeParse({ ...request, expectedCurrentFingerprint: "invalid" }).success).toBe(false);
  });
  it("keeps literal notes, bounded supported observations and an explicit blank-first observation status", () => {
    const parsed = manualCaseResultWriteSchema.parse({ ...request, note: "  Original\ntext | literal  " });
    expect(parsed.note).toBe("  Original\ntext | literal  ");
    for (const change of [{ status: "FLAKY" }, { status: "" }, { observations: { rawSource: "forbidden" } }, { observations: { measurements: [{ name: "Known", unit: "units", value: 1, unreviewedMetadata: "must not disappear" }] } }, { correctionReason: " " }])
      expect(manualCaseResultWriteSchema.safeParse({ ...request, ...change }).success).toBe(false);
  });
  it("bounds pages and stable original scope/UUID/current-fingerprint serialization", () => {
    expect(manualCaseResultHistorySchema.parse(read).limit).toBe(20);
    expect(manualCaseResultHistorySchema.safeParse({ ...read, limit: 21 }).success).toBe(false);
    const parsed = manualCaseResultWriteSchema.parse(request), key = manualCaseResultWriteKey(parsed);
    for (const change of [{ expectedCurrentFingerprint: "b".repeat(64) }, { note: "different" }, { idempotencyKey: "9b9c47bb-abeb-4338-85b1-3e96cff2f1ad" }, { expectedScope: { ...scope, clerkActorId: "other" } }])
      expect(manualCaseResultWriteKey(manualCaseResultWriteSchema.parse({ ...parsed, ...change }))).not.toBe(key);
  });
  it("unversioned prior capture cannot invent original recorder/time or masquerade as an earlier revision", () => {
    const revision = { id: "rev", revisionNumber: 1, result: { resultId: "result", status: "FAIL", note: null, observations: {} }, actorLabel: "Current recorder", recordedAt: new Date(), correctionReason: "Corrected note", previousRevisionId: null,
      legacyPrior: { basis: "UNVERSIONED_OBSERVATION_CAPTURED_NOW", originalRecorder: null, originalRecordedAt: null, captured: { resultId: "result", status: "FAIL", note: "Prior note", observations: {} } } };
    expect(manualCaseResultRevisionOutputSchema.safeParse(revision).success).toBe(true);
    expect(manualCaseResultRevisionOutputSchema.safeParse({ ...revision, legacyPrior: { ...revision.legacyPrior, originalRecordedAt: new Date().toISOString() } }).success).toBe(false);
    expect(manualCaseResultRevisionOutputSchema.safeParse({ ...revision, revisionNumber: 0 }).success).toBe(false);
  });
});
