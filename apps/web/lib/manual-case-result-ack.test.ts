// SOURCE ONLY: authored response verification, not executed tonight.
import { createHash, webcrypto } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { manualCaseAckMatches, manualCaseReadMatches } from "./manual-case-result-ack";
import { manualCaseResultReadKey, manualCaseResultWriteKey, manualCaseResultWriteSchema } from "@vaettir/api/src/services/manualCaseResultSchema";
const input = manualCaseResultWriteSchema.parse({ projectId: "project", testRunId: "run", testCaseId: "case", expectedScope: { projectId: "project", organizationId: "org", clerkActorId: "clerk" },
  expectedRevisionId: "rev1", expectedCurrentFingerprint: "a".repeat(64), status: "FAIL", note: "Retained human text", observations: {}, correctionReason: "A reviewed correction", idempotencyKey: "88c47b3b-d1f7-43b5-bd88-b49ddf14b8c0" });
const ack = () => ({ scope: { ...input.expectedScope, actorId: "native-actor" }, testRunId: input.testRunId, testCaseId: input.testCaseId, resultId: "result", revisionId: "rev2", revisionNumber: 2,
  idempotencyKey: input.idempotencyKey, requestHash: createHash("sha256").update(manualCaseResultWriteKey(input)).digest("hex"), recovered: false });
afterEach(() => vi.unstubAllGlobals());
describe("exact immutable observation ACK", () => {
  it("checks original scope/UUID/input digest/current-head successor without consuming another request", async () => {
    vi.stubGlobal("crypto", webcrypto); const before = structuredClone(input);
    expect(await manualCaseAckMatches(input, 2, ack())).toBe(true);
    expect(await manualCaseAckMatches(input, 2, { ...ack(), recovered: true })).toBe(true);
    expect(input).toEqual(before);
    expect(await manualCaseAckMatches(input, 2, ack(), "different-result", "native-actor")).toBe(false);
    expect(await manualCaseAckMatches(input, 2, ack(), "result", "different-actor")).toBe(false);
  });
  it("refuses changed scope/result tuple/UUID/revision number or body digest", async () => {
    vi.stubGlobal("crypto", webcrypto);
    for (const change of [{ scope: { ...ack().scope, clerkActorId: "other" } }, { scope: { ...ack().scope, organizationId: "other" } }, { testRunId: "other" }, { testCaseId: "other" }, { revisionNumber: 3 }, { requestHash: "b".repeat(64) }, { idempotencyKey: "9b9c47bb-abeb-4338-85b1-3e96cff2f1ad" }, { permission: "OWNER" }])
      expect(await manualCaseAckMatches(input, 2, { ...ack(), ...change })).toBe(false);
  });
  it("missing fields or unavailable crypto retain uncertainty rather than declaring a save", async () => {
    expect(await manualCaseAckMatches(input, 2, { revisionId: "rev2" })).toBe(false);
    vi.stubGlobal("crypto", undefined);
    expect(await manualCaseAckMatches(input, 2, ack())).toBe(false);
  });
  it("history cached data must match original native actor/org and exact current page identity", () => {
    const read = { projectId: input.projectId, testRunId: input.testRunId, testCaseId: input.testCaseId, expectedScope: input.expectedScope, limit: 10 };
    const page = { scope: ack().scope, requested: manualCaseResultReadKey(read) };
    expect(manualCaseReadMatches(read, page)).toBe(true);
    expect(manualCaseReadMatches({ ...read, before: "older" }, page)).toBe(false);
    expect(manualCaseReadMatches(read, { ...page, scope: { ...page.scope, clerkActorId: "other" } })).toBe(false);
  });
});
