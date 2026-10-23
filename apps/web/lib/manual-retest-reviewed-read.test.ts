import { expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { admitRetestRead, freezeRetestRead, inspectRetestWire, retestReviewedBrowserKey, RetestReadRenderGuard, type RetestReviewedInput, type RetestProjection } from "./manual-retest-reviewed-read";
const input = (): RetestReviewedInput => ({ request: { projectId: "p", sourceRunId: "run", testCaseId: "case", expectedScope: { projectId: "p", organizationId: "o", clerkActorId: "cl" } }, readRequestId: "6ee2ec04-4d34-40bf-b0e9-000000000001", expectedNativeActorId: "n" });
type MutableWire = Record<string, unknown> & { readContext: { scope: Record<string, unknown>; requestId: unknown; requested: unknown; projection: unknown }; preview: Record<string, unknown> & { scope: Record<string, unknown>; caseDefinitions: Array<{ steps: Array<{ expectedResponse?: unknown }> }>; sourceResults: Array<{ status: unknown; testCaseId: unknown }>; sourceOutcome: unknown; prerequisiteCount: unknown; testCaseId: unknown }; links: { retests: Array<{ startedAt: unknown; status: unknown; url?: unknown }>; nextCursor: unknown } };
function required<T>(values: readonly T[]): T { const value = values[0]; if (value === undefined) throw Error("Missing required synthetic fixture row"); return value; }
function wire(projection: RetestProjection, i = input()): MutableWire {
  const scope = { projectId: "p", organizationId: "o", clerkActorId: "cl", actorId: "n" }, readContext = { requestId: i.readRequestId, requested: retestReviewedBrowserKey(i), projection, scope };
  if (projection === "ACCESS") return { readContext, basis: "CURRENT_PROJECT_MEMBER_ONLY", sourceRelationshipVerified: false } as unknown as MutableWire;
  if (projection === "LINKS") return { readContext, links: { scope, requested: JSON.stringify(JSON.parse(retestReviewedBrowserKey(i)).request), original: null, retests: [{ testRunId: "retained", startedAt: "2026-10-06T12:00:00.123Z", status: "RUNNING" }], nextCursor: null } } as unknown as MutableWire;
  return { readContext, basis: "LEGACY_BOUNDED_PREPARATION_V1", preview: { scope, requested: JSON.stringify(JSON.parse(retestReviewedBrowserKey(i)).request), projectId: "p", sourceRunId: "run", testCaseId: "case", displayId: "TC-1", reviewHash: "a".repeat(64), sourceOutcome: "FAIL", stepFieldLabels: { action: " Tester action ", expectedActionOrData: " Technical\n behavior " }, configuration: { configuration: "", platform: "", build: "", hardwareRevision: "", firmwareVersion: "", rig: "", batchOrLot: "", environment: " Raw\n environment ", calibrationReference: "", protocolReference: "" }, caseDefinitions: [{ testCaseId: "case", title: " Raw\n title ", validationDomain: "SOFTWARE", reviewStatus: "APPROVED", background: null, given: ["", " Given "], when: [" When "], then: [" Then "], verificationProfile: { setup: "", safety: "", instruments: "", acceptanceCriteria: "" }, steps: [{ order: 0, action: " Click\n button ", expectedActionOrData: " GET /synthetic ", expectedResult: "", expectedResponse: null, mediaAttachmentIds: ["ref"] }] }], sourceResults: [{ id: "result", testCaseId: "case", status: "FAIL", note: null, errorMessage: "", observations: { specimen: "", hardwareRevision: "", firmwareVersion: "", environment: "", measurements: [{ name: " Reading ", unit: " V ", value: 0, lowerLimit: 0, instrument: " Meter\n A " }] } }], prerequisiteCount: 0, credits: 0, sourceDatasetExecution: { batchId: `dataset_${"b".repeat(64)}`, datasetId: "dataset", datasetHash: "c".repeat(64), rowIndex: 0, rowName: " Row ", values: { empty: "", multiline: " One\n two " } } } } as unknown as MutableWire;
}
it("request key follows exact old parser order and optional omission, not caller insertion order/defaults", () => {
  const original = input();
  const reversed = { expectedNativeActorId: "n", readRequestId: original.readRequestId, request: { expectedScope: { clerkActorId: "cl", organizationId: "o", projectId: "p" }, testCaseId: "case", sourceRunId: "run", projectId: "p" } };
  expect(retestReviewedBrowserKey(reversed)).toBe(retestReviewedBrowserKey(original));
  const absent = { request: { projectId: "p", sourceRunId: "run", testCaseId: "case" }, readRequestId: original.readRequestId };
  expect(JSON.parse(retestReviewedBrowserKey(absent))).toEqual({ version: 1, ...absent });
  const explicit = { ...absent, expectedNativeActorId: undefined, request: { ...absent.request, expectedScope: undefined, before: undefined } };
  expect(retestReviewedBrowserKey(explicit)).toBe(retestReviewedBrowserKey(absent)); expect(retestReviewedBrowserKey({ ...original, expectedNativeActorId: "n", request: { ...original.request, before: "older" } })).not.toBe(retestReviewedBrowserKey(original));
});
it.each(["ACCESS", "PREVIEW", "LINKS"] as const)("admits complete %s without mutation, stored NULL/empty/newline/zero survive frozen copy", projection => {
  const i = input(), raw = wire(projection, i), before = JSON.stringify(raw), admitted = admitRetestRead(raw, i, projection, "cl", null)!;
  expect(admitted.origin).toEqual({ projectId: "p", sourceRunId: "run", testCaseId: "case", organizationId: "o", clerkActorId: "cl", nativeActorId: "n" }); expect(admitted.data).toEqual(raw); expect(Object.isFrozen(admitted.data)).toBe(true); expect(JSON.stringify(raw)).toBe(before);
  raw.readContext.scope.actorId = "M"; expect(admitted.origin.nativeActorId).toBe("n");
});
it("standalone ACCESS cannot infer Clerk actor from response or claim relationships/FULL permission", () => {
  const i = { request: { projectId: "p", sourceRunId: "run", testCaseId: "case" }, readRequestId: input().readRequestId }, raw = wire("ACCESS", i);
  expect(admitRetestRead(raw, i, "ACCESS", "cl", null)).not.toBeNull(); expect(admitRetestRead(raw, i, "ACCESS", "other", null)).toBeNull(); raw.sourceRelationshipVerified = true; expect(admitRetestRead(raw, i, "ACCESS", "cl", null)).toBeNull();
});
it.each(["native", "org", "Clerk", "project", "nonce", "key", "projection"])("mismatched %s echo never admits a cached payload", kind => {
  const i = input(), raw = wire("PREVIEW", i);
  if (kind === "native") raw.readContext.scope.actorId = "M"; if (kind === "org") raw.readContext.scope.organizationId = "foreign"; if (kind === "Clerk") raw.readContext.scope.clerkActorId = "other"; if (kind === "project") raw.readContext.scope.projectId = "foreign"; if (kind === "nonce") raw.readContext.requestId = input().readRequestId.replace(/1$/, "2"); if (kind === "key") raw.readContext.requested = "stale"; if (kind === "projection") raw.readContext.projection = "ACCESS";
  expect(admitRetestRead(raw, i, "PREVIEW", "cl", null)).toBeNull();
});
it.each([[], {}, 0, null, "UNKNOWN"])("enum value %j is refused literally, never String-coerced", v => {
  const raw = wire("PREVIEW"); raw.preview.sourceOutcome = v; expect(admitRetestRead(raw, input(), "PREVIEW", "cl", null)).toBeNull(); raw.preview.sourceOutcome = "FAIL"; required(raw.preview.sourceResults).status = v; expect(admitRetestRead(raw, input(), "PREVIEW", "cl", null)).toBeNull();
});
it("actual enum arrays refuse without coercion and ACCESS/PREVIEW cannot inherit a links cursor", () => {
  const raw = wire("PREVIEW"); raw.preview.sourceOutcome = ["FAIL"]; expect(admitRetestRead(raw, input(), "PREVIEW", "cl", null)).toBeNull(); raw.preview.sourceOutcome = "FAIL"; required(raw.preview.sourceResults).status = ["FAIL"]; expect(admitRetestRead(raw, input(), "PREVIEW", "cl", null)).toBeNull();
  const linkedInput = { ...input(), expectedNativeActorId: "n", request: { ...input().request, before: "cursor" } }; expect(admitRetestRead(wire("ACCESS", linkedInput), linkedInput, "ACCESS", "cl", null)).toBeNull();
});
it.each(["missing", "unknown", "duplicate", "foreignResult", "wrongCount", "wrongCase", "wrongBasis"])("complete preview %s refuses instead of partial approval", kind => {
  const raw = wire("PREVIEW");
  if (kind === "missing") delete required(required(raw.preview.caseDefinitions).steps).expectedResponse; if (kind === "unknown") raw.preview.retiredUnknown = null; if (kind === "duplicate") raw.preview.caseDefinitions.push(structuredClone(required(raw.preview.caseDefinitions))); if (kind === "foreignResult") required(raw.preview.sourceResults).testCaseId = "foreign"; if (kind === "wrongCount") raw.preview.prerequisiteCount = 3; if (kind === "wrongCase") raw.preview.testCaseId = "foreign"; if (kind === "wrongBasis") raw.basis = "RAW_NATIVE_AUDIT";
  expect(admitRetestRead(raw, input(), "PREVIEW", "cl", null)).toBeNull();
});
it.each(["dateObject", "invalidDate", "submillisecond", "enumArray", "unknownField", "cursor", "eleven"])("links %s refuses whole page, preserves UTC wire/current labels distinction", kind => {
  const raw = wire("LINKS"), row = required(raw.links.retests); if (kind === "dateObject") row.startedAt = new Date(); if (kind === "invalidDate") row.startedAt = "2026-02-30T00:00:00.000Z"; if (kind === "submillisecond") row.startedAt = "2026-10-06T12:00:00.123456Z"; if (kind === "enumArray") row.status = ["RUNNING"]; if (kind === "unknownField") row.url = "not-used"; if (kind === "cursor") raw.links.nextCursor = "other"; if (kind === "eleven") raw.links.retests = Array(11).fill(row); expect(admitRetestRead(raw, input(), "LINKS", "cl", null)).toBeNull();
});
it("structure/bytes refuse getters/hooks/array gaps/symbols/deep/oversize before clone without invocation", () => {
  const invoked = vi.fn(() => "PRIVATE"), getter = Object.defineProperty({}, "x", { enumerable: true, get: invoked }); expect(() => inspectRetestWire(getter)).toThrow(); expect(() => freezeRetestRead(getter)).toThrow(); expect(invoked).not.toHaveBeenCalled();
  const hole = [0, 1]; delete hole[0]; const symbol = [0]; Reflect.set(symbol, Symbol("x"), 1); for (const bad of [hole, symbol, { toJSON: invoked }, { x: Infinity }, { x: undefined }, { x: "\ud800" }]) expect(() => inspectRetestWire(bad)).toThrow();
  let deep: unknown = null; for (let i = 0; i < 66; i++) deep = { x: deep }; expect(() => inspectRetestWire(deep)).toThrow(); expect(() => inspectRetestWire({ x: "x".repeat(2097152) })).toThrow(); expect(invoked).not.toHaveBeenCalled();
});
it("native scope property insertion order does not change exact identity, hidden mappings are not dropped", () => {
  const raw = wire("PREVIEW"); raw.preview.scope = { actorId: "n", clerkActorId: "cl", organizationId: "o", projectId: "p" }; expect(admitRetestRead(raw, input(), "PREVIEW", "cl", null)).not.toBeNull();
  Object.defineProperty(raw.preview.scope, "hidden", { value: "x" }); expect(admitRetestRead(raw, input(), "PREVIEW", "cl", null)).toBeNull();
});
it("render/cache revocation cannot be cleared by a posted A-B-A effect; fresh nonce is required", () => {
  const g = new RetestReadRenderGuard(), frame = {}, view = {}, stamp = g.observe(frame, view); g.revokeCache("A"); expect(g.matchesRead(stamp, "A")).toBe(false); expect(g.matchesRead(g.observe(frame, view), "A")).toBe(false); const next = g.observe({}, {}); expect(g.matchesRead(next, "B")).toBe(true); expect(g.matchesRender(stamp)).toBe(false);
});
it("production reader has only type-only router contract and no server schema graph import", () => { const source = readFileSync(new URL("./manual-retest-reviewed-read.ts", import.meta.url), "utf8"); expect(source).not.toContain("@vaettir/api"); expect(source).toContain('import type { RouterInputs, RouterOutputs }'); });
