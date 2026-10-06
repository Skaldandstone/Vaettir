// SOURCE ONLY: authored exact receipt checks, not executed or rendered tonight.
import { createHash, webcrypto } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { verifiedManualRetestAck, verifiedManualRetestRead, verifiedReviewedRetestAck } from "./manual-retest-scope-ack";
import { manualRetestReadRequestKey } from "@vaettir/api/src/services/manualRetestScopeSchema";
const expectedScope = { projectId: "project", organizationId: "organization", clerkActorId: "clerk" };
const input = { projectId: "project", sourceRunId: "source", testCaseId: "case", expectedScope, expectedReviewHash: "a".repeat(64), idempotencyKey: "88c47b3b-d1f7-43b5-bd88-b49ddf14b8c0" };
const runId = (actorId = "native-actor") => `retest_${createHash("sha256").update(JSON.stringify([input.projectId, actorId, input.idempotencyKey])).digest("hex")}`;
const ack = () => ({ testRunId: runId(), recovered: false, scope: { ...expectedScope, actorId: "native-actor", sourceRunId: input.sourceRunId, testCaseId: input.testCaseId, idempotencyKey: input.idempotencyKey, reviewHash: input.expectedReviewHash } });
afterEach(() => vi.unstubAllGlobals());
describe("retained scoped retest receipt verification", () => {
  it("accepts exactly the original tuple and native deterministic identity for both new and recovered receipts", async () => {
    vi.stubGlobal("crypto", webcrypto); const before = structuredClone(input);
    expect(await verifiedManualRetestAck(input, ack())).toBe(true);
    expect(await verifiedManualRetestAck(input, { ...ack(), recovered: true })).toBe(true);
    expect(input).toEqual(before);
  });
  it("refuses changed actor/org/UUID/source/case/hash and forged run IDs before consuming an unknown request", async () => {
    vi.stubGlobal("crypto", webcrypto);
    for (const changed of [{ actorId: "other-native" }, { clerkActorId: "other" }, { organizationId: "other" }, { projectId: "other" }, { sourceRunId: "other" }, { testCaseId: "other" }, { reviewHash: "b".repeat(64) }, { idempotencyKey: "9b9c47bb-abeb-4338-85b1-3e96cff2f1ad" }])
      expect(await verifiedManualRetestAck(input, { ...ack(), scope: { ...ack().scope, ...changed } })).toBe(false);
    expect(await verifiedManualRetestAck(input, { ...ack(), testRunId: "unrelated-run" })).toBe(false);
    expect(await verifiedManualRetestAck(input, { ...ack(), unexpected: "permission" })).toBe(false);
  });
  it("legacy incomplete ACK and unavailable browser crypto retain uncertainty instead of substituting a receipt", async () => {
    vi.stubGlobal("crypto", webcrypto);
    expect(await verifiedManualRetestAck(input, { testRunId: runId(), recovered: true })).toBe(false);
    vi.stubGlobal("crypto", undefined);
    expect(await verifiedManualRetestAck(input, ack())).toBe(false);
  });
  it("private read results require exact echoed original request identity including pagination", () => {
    const value = { scope: { ...expectedScope, actorId: "native-actor" }, requested: manualRetestReadRequestKey(input) };
    expect(verifiedManualRetestRead(input, value)).toBe(true);
    expect(verifiedManualRetestRead({ ...input, before: "older" }, value)).toBe(false);
    expect(verifiedManualRetestRead(input, { ...value, scope: { ...value.scope, clerkActorId: "other" } })).toBe(false);
    expect(verifiedManualRetestRead(input, { ...value, requested: "unrelated" })).toBe(false);
  });
});

describe("additive reviewed outer native-owner ACK verifier", () => {
  const envelope = () => ({ request: structuredClone(input), expectedNativeActorId: "native-actor" });
  it("requires held original native N independently, without changing old legacy ACK interpretation", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const remapped = { ...ack(), testRunId: runId("M"), scope: { ...ack().scope, actorId: "M" } };
    expect(await verifiedManualRetestAck(input, remapped)).toBe(true);
    expect(await verifiedReviewedRetestAck(envelope(), remapped)).toBeNull();
    const receipt = await verifiedReviewedRetestAck(envelope(), { ...ack(), recovered: true });
    expect(receipt?.scope.actorId).toBe("native-actor"); expect(receipt?.recovered).toBe(true);
    expect(Object.isFrozen(receipt)).toBe(true); expect(Object.isFrozen(receipt?.scope)).toBe(true);
  });
  it("malformed/absent scope/extra/oversized/accessor bodies fail generically without invocation or clipping", async () => {
    vi.stubGlobal("crypto", webcrypto); const invoke = vi.fn(() => "PRIVATE");
    for (const value of [{ testRunId: runId(), recovered: true }, { ...ack(), scope: null }, { ...ack(), unexpected: "PRIVATE" }, { ...ack(), testRunId: "x".repeat(9000) }, Object.defineProperty(ack(), "scope", { enumerable: true, get: invoke })]) expect(await verifiedReviewedRetestAck(envelope(), value)).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });
  it.each(["native", "org", "Clerk", "UUID", "source", "case", "hash"])("changed %s does not replace pending receipt", async changed => {
    vi.stubGlobal("crypto", webcrypto); const value = ack();
    if (changed === "native") value.scope.actorId = "M"; if (changed === "org") value.scope.organizationId = "M"; if (changed === "Clerk") value.scope.clerkActorId = "M"; if (changed === "UUID") value.scope.idempotencyKey = "9b9c47bb-abeb-4338-85b1-3e96cff2f1ad"; if (changed === "source") value.scope.sourceRunId = "M"; if (changed === "case") value.scope.testCaseId = "M"; if (changed === "hash") value.scope.reviewHash = "b".repeat(64);
    expect(await verifiedReviewedRetestAck(envelope(), value)).toBeNull();
  });
  it("legacy scope-absent request is never repaired into reviewed authority", async () => {
    vi.stubGlobal("crypto", webcrypto); const { expectedScope: omitted, ...bare } = input; expect(omitted).toEqual(expectedScope);
    expect(await verifiedReviewedRetestAck({ request: bare, expectedNativeActorId: "native-actor" }, ack())).toBeNull(); expect(Object.hasOwn(bare, "expectedScope")).toBe(false);
  });
  it("extra envelope or inner keys cannot turn a parser-refused request into a confirmed reviewed receipt", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const outer = {...envelope(),unexpected:"permission"}, inner = {...envelope(),request:{...input,unexpected:"permission"}}, nested = {...envelope(),request:{...input,expectedScope:{...expectedScope,unexpected:"permission"}}};
    expect(await verifiedReviewedRetestAck(outer,ack())).toBeNull();
    expect(await verifiedReviewedRetestAck(inner,ack())).toBeNull();
    expect(await verifiedReviewedRetestAck(nested,ack())).toBeNull();
  });
});
