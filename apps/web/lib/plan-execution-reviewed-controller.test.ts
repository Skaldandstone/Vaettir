// Real controller/helper + complete synthetic native-read DTOs. No database,
// authorization service, transmission or production/runtime acceptance.
import { createHash, webcrypto } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { admitPlanExecutionRead, planExecutionReviewedReadKey, planExecutionCandidateBrowserKey, type PlanExecutionReadSnapshot } from "./plan-execution-reviewed-reader";
import { admitRunStartRead, runStartReviewedReadKey, type RunStartReadSnapshot } from "./manual-run-start-reviewed-reader";
import { PlanExecutionReviewedController, type PlanExecutionFrame } from "./plan-execution-reviewed-controller";
import type { ReviewedRunStartEnvelope } from "./run-start-reviewed-write";
const key = "00000000-0000-4000-8000-000000000001", config = "00000000-0000-4000-8000-000000000002";
export function syntheticPlan(projection: "ACCESS" | "PAGE" = "PAGE", selectedState: "AVAILABLE" | "MISSING" | "ARCHIVED" = "AVAILABLE"): PlanExecutionReadSnapshot {
  const scope = { projectId: "p", testPlanId: "plan", originalOrganizationId: "o", expectedClerkActorId: "cl", expectedNativeActorId: "n", requestId: key };
  const input = projection === "PAGE" ? { ...scope, search: "", limit: 50 } : scope;
  const readContext = { projection, requestId: key, requestedKey: planExecutionReviewedReadKey(input, projection), scope: { projectId: "p", testPlanId: "plan", organizationId: "o", actorClerkUserId: "cl", actorId: "n" } };
  const context = { configuration: "Rig\nA", platform: "", build: "", hardwareRevision: "", firmwareVersion: "", rig: "", batchOrLot: "", environment: "", calibrationReference: "", protocolReference: "" };
  const template = { version: 1, testCaseIds: ["second", "first"], configurations: [{ id: config, name: "Rig\nA", context }] };
  const wire = projection === "ACCESS" ? { readContext, hasFullEditorAccess: true } : {
    readContext, hasFullEditorAccess: true, plan: { id: "plan", projectId: "p", name: "PRIVATE Plan\n name", status: "ACTIVE" }, rawTemplate: { sqlNull: false, jsonText: JSON.stringify(template) }, template, templateHash: "b".repeat(64), interpretation: "EXACT_SUPPORTED",
    selected: template.testCaseIds.map(testCaseId => ({ testCaseId, state: selectedState, metadata: selectedState === "MISSING" ? null : { id: testCaseId, title: "PRIVATE Case\n title", displayId: "", reviewStatus: "APPROVED", archived: selectedState === "ARCHIVED" } })), candidates: [], search: "", limit: 50, candidateScopeKey: planExecutionCandidateBrowserKey({ ...scope, search: "", limit: 50 }), nextCursor: null, limitations: [],
  };
  const value = admitPlanExecutionRead(wire, input, projection, "cl"); if (!value) throw Error("Synthetic complete plan DTO unsupported");
  return Object.freeze({ origin: value.origin, observedSessionId: "A", projection, epoch: 1, revision: 1, receivedAt: "2026-10-06T00:00:00.000Z", data: value.data });
}
export function syntheticProfile(projection: "ACCESS" | "PREVIEW" = "PREVIEW"): RunStartReadSnapshot {
  const input = { projectId: "p", originalOrganizationId: "o", expectedClerkActorId: "cl", expectedNativeActorId: "n", requestId: key };
  const readContext = { requestId: key, requestedKey: runStartReviewedReadKey(input, projection), projection, scope: { projectId: "p", organizationId: "o", actorId: "n", actorClerkUserId: "cl" } };
  const wire = projection === "ACCESS" ? { readContext, canConfigure: true, canRecover: true } : { readContext, canConfigure: true, canRecover: true, canStart: true, profile: { kind: "SUPPORTED", experience: null, profileHash: "a".repeat(64) }, limitations: [] };
  const value = admitRunStartRead(wire, input, projection, "cl"); if (!value) throw Error("Synthetic complete profile DTO unsupported");
  return Object.freeze({ origin: value.origin, observedSessionId: "A", projection, epoch: 1, revision: 1, receivedAt: "2026-10-06T00:00:00.000Z", data: value.data });
}
function literalPlan(): PlanExecutionReadSnapshot {
  const original = syntheticPlan();
  if (!("template" in original.data) || !original.data.template) throw Error("Expected synthetic PAGE");
  const template = { ...original.data.template, version: 2, configurations: original.data.template.configurations.map(item => ({ ...item, name: "  Literal\n name  ", context: { ...item.context, build: "0" } })) },
    raw = { ...original.data, template, rawTemplate: { sqlNull: false, jsonText: JSON.stringify(template) }, interpretation: "EXACT_LITERAL_V2_READ_ONLY" },
    input = { projectId: "p", testPlanId: "plan", originalOrganizationId: "o", expectedClerkActorId: "cl", expectedNativeActorId: "n", requestId: key, search: "", limit: 50 },
    value = admitPlanExecutionRead(raw, input, "PAGE", "cl");
  if (!value) throw Error("Expected admitted complete literal PAGE");
  return Object.freeze({ ...original, origin: value.origin, data: value.data });
}
export function syntheticAck(input: ReviewedRunStartEnvelope) {
  return { mode: "START", currentScope: { projectId: "p", organizationId: "o", actorId: input.expectedNativeActorId, actorClerkUserId: "cl" }, idempotencyKey: input.request.idempotencyKey, legacyAck: { testRunId: `manual_${createHash("sha256").update(JSON.stringify(["p", input.expectedNativeActorId, input.request.idempotencyKey])).digest("hex")}`, originalOrganizationId: "o", expectedClerkActorId: "cl", idempotencyKey: input.request.idempotencyKey }, historicalOuterProvenance: "UNRECORDED", interpretation: "LEGACY_NORMALIZED_NOT_RAW_LOSSLESS" };
}
function harness() {
  let plan: PlanExecutionReadSnapshot | null = syntheticPlan(), profile: RunStartReadSnapshot | null = syntheticProfile(), open = true, sdk = true, callbacks = 0;
  const alive = true;
  const uuid = vi.fn(() => key), controller = new PlanExecutionReviewedController("p", "plan", () => {}, uuid);
  controller.attach();
  const frame = (): PlanExecutionFrame => ({ active: alive, open, legacyBlocked: false, plan, profile, currentPlan: () => sdk ? plan : null, currentProfile: () => sdk ? profile : null });
  const bind = () => controller.bind(frame()); bind();
  const prepare = () => { expect(controller.select(config)).toBe(true); expect(controller.review()).toBe(true); };
  return { controller, uuid, prepare, bind, frame, callback: () => { callbacks++; }, get callbacks() { return callbacks; }, setSDK: (v: boolean) => { sdk = v; }, close: () => { open = false; bind(); }, reopen: () => { open = true; bind(); }, revoke: () => { plan = null; profile = null; bind(); }, recover: () => { plan = null; profile = syntheticProfile("ACCESS"); bind(); }, setPlan: (v: PlanExecutionReadSnapshot | null) => { plan = v; bind(); }, setProfile: (v: RunStartReadSnapshot | null) => { profile = v; bind(); } };
}
beforeEach(() => vi.stubGlobal("crypto", { subtle: webcrypto.subtle, randomUUID: () => key }));
afterEach(() => vi.unstubAllGlobals());
it("literal-v2 PAGE never creates a UUID, review or dispatch through the unchanged legacy controller", async () => {
  const h = harness(), transport = vi.fn(async (input: ReviewedRunStartEnvelope) => syntheticAck(input));
  h.setPlan(literalPlan()); h.controller.select(config);
  expect(h.controller.view().readable).toBe(true); expect(h.controller.view().canReview).toBe(false);
  expect(h.controller.review()).toBe(false); expect(h.uuid).not.toHaveBeenCalled();
  expect(await h.controller.submit(transport)).toBe(false); expect(transport).not.toHaveBeenCalled();
  expect(h.controller.view().hasReview).toBe(false); expect(h.controller.view().pending).toBe(false);
});
it.each(["v2", "unavailable"])("owned v1 UNKNOWN recovers the identical envelope under current profile ACCESS with %s PAGE", async mode => {
  const h = harness(), sent: ReviewedRunStartEnvelope[] = [];
  h.prepare(); await h.controller.submit(async input => { sent.push(input); throw Error("Synthetic lost ACK"); });
  const original = sent[0], body = JSON.stringify(original);
  h.setPlan(mode === "v2" ? literalPlan() : null); h.setProfile(syntheticProfile("ACCESS"));
  expect(h.controller.view().canRetry).toBe(true); expect(h.controller.view().canReview).toBe(false);
  expect(await h.controller.submit(async input => { sent.push(input); return syntheticAck(input); })).toBe(true);
  expect(sent[1]).toBe(original); expect(JSON.stringify(sent[1])).toBe(body); expect(h.uuid).toHaveBeenCalledOnce();
  expect(h.controller.view().confirmed).toBe(true); expect(h.controller.view().canRetry).toBe(false);
});
it("complete current native selection/configuration creates one immutable unchanged plan-reference body", async () => {
  const h = harness(); h.prepare(); let sent: ReviewedRunStartEnvelope | null = null;
  expect(await h.controller.submit(async input => { sent = input; return syntheticAck(input); }, h.callback)).toBe(true);
  expect(sent).toMatchObject({ expectedNativeActorId: "n", request: { testCaseIds: ["second", "first"], idempotencyKey: key, planReference: { testPlanId: "plan", expectedTemplateHash: "b".repeat(64), configurationId: config } } });
  expect(Object.isFrozen((sent as unknown as ReviewedRunStartEnvelope).request.testCaseIds)).toBe(true); expect(h.callbacks).toBe(1); expect(h.controller.view().canSend).toBe(false); expect(h.controller.review()).toBe(false);
});
it.each(["ACCESS", "missing", "archived", "SDK", "profileACCESS", "legacy"])("%s cannot create a new reviewed intent", mode => {
  const h = harness();
  if (mode === "ACCESS") h.setPlan(syntheticPlan("ACCESS"));
  if (mode === "missing") h.setPlan(syntheticPlan("PAGE", "MISSING"));
  if (mode === "archived") h.setPlan(syntheticPlan("PAGE", "ARCHIVED"));
  if (mode === "SDK") h.setSDK(false);
  if (mode === "profileACCESS") h.setProfile(syntheticProfile("ACCESS"));
  if (mode === "legacy") h.controller.bind({ ...h.frame(), legacyBlocked: true });
  h.controller.select(config); expect(h.controller.review()).toBe(false); expect(h.controller.view().hasReview).toBe(false);
});
it("UNKNOWN uses only exact original envelope through fresh current FULL ACCESS; no new plan/profile/cohort adoption", async () => {
  const h = harness(); h.prepare(); const sent: ReviewedRunStartEnvelope[] = [];
  await h.controller.submit(async input => { sent.push(input); throw Error("PRIVATE provider body"); });
  const body = JSON.stringify(sent[0]); expect(h.controller.view().unknown).toBe(true); expect(h.controller.discard()).toBe(false);
  h.close(); expect(h.controller.view().canRetry).toBe(false); h.reopen(); h.recover();
  expect(h.controller.view().canRetry).toBe(true); expect(await h.controller.submit(async input => { sent.push(input); return syntheticAck(input); }, h.callback)).toBe(true);
  expect(sent[1]).toBe(sent[0]); expect(JSON.stringify(sent[1])).toBe(body); expect(h.callbacks).toBe(0); expect(h.controller.view().confirmedRunId).toMatch(/^manual_/);
});
it.each(["close", "unmount", "SDK", "cache"])("late exact ACK after %s privately settles without current callback or historical DOM", async mode => {
  const h = harness(); h.prepare(); let finish!: () => void;
  const pending = h.controller.submit(input => new Promise(resolve => { finish = () => resolve(syntheticAck(input)); }), h.callback);
  if (mode === "close") h.close(); if (mode === "unmount") h.controller.detach(); if (mode === "SDK") h.setSDK(false); if (mode === "cache") h.revoke();
  finish(); expect(await pending).toBe(true); expect(h.callbacks).toBe(0); expect(h.controller.view().pending).toBe(false); expect(h.controller.view().confirmedRunId).toBe(null);
  if (mode === "unmount") h.controller.attach(); h.setSDK(true); h.reopen(); h.recover(); expect(h.controller.view().confirmedRunId).toMatch(/^manual_/); expect(h.controller.view().canRetry).toBe(false);
});
it("synchronous busy latch blocks double dispatch and a reentrant revocation before dispatch", async () => {
  const h = harness(); h.prepare(); let finish!: () => void, calls = 0;
  const first = h.controller.submit(input => { calls++; return new Promise(resolve => { finish = () => resolve(syntheticAck(input)); }); });
  expect(await h.controller.submit(async input => { calls++; return syntheticAck(input); })).toBe(false); finish(); await first; expect(calls).toBe(1);
  const other = harness(); other.prepare(); other.setSDK(false); expect(await other.controller.submit(async input => { calls++; return syntheticAck(input); })).toBe(false); expect(calls).toBe(1);
});
it("malformed native ACK remains UNKNOWN, never inferred confirmation from a target string", async () => {
  const h = harness(); h.prepare(); await h.controller.submit(async input => ({ ...syntheticAck(input), currentScope: { ...syntheticAck(input).currentScope, actorId: "M" } }));
  expect(h.controller.view().unknown).toBe(true); expect(h.controller.view().confirmedRunId).toBe(null); expect(h.controller.discard()).toBe(false);
});
it("first current definitive refusal requires explicit disposal; earlier UNKNOWN cannot be cleared by a later refusal", async () => {
  const error = { data: { code: "PRECONDITION_FAILED" } }, h = harness(); h.prepare(); await h.controller.submit(async () => { throw error; }); expect(h.controller.view().refused).toBe(true); expect(h.controller.discard()).toBe(true);
  h.prepare(); await h.controller.submit(async () => { throw Error("lost"); }); await h.controller.submit(async () => { throw error; }); expect(h.controller.view().unknown).toBe(true); expect(h.controller.discard()).toBe(false);
});
