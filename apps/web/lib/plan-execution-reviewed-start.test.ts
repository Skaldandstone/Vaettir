import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { admitPlanExecutionRead, planExecutionReviewedReadKey, planExecutionCandidateBrowserKey, type PlanExecutionReadSnapshot } from "./plan-execution-reviewed-reader";
import { admitRunStartRead, runStartReviewedReadKey, type RunStartReadSnapshot } from "./manual-run-start-reviewed-reader";
import { freezeReviewedPlanStart, expectedReviewedPlanRunId, verifyReviewedPlanStartAck, type ReviewedPlanRunRequest, type ReviewedPlanStartSelection } from "./plan-execution-reviewed-start";
// Test-only authoritative browser-pure envelope validator. No service, router,
// Prisma/client or native hash module is imported/evaluated here.
import { manualRunStartReviewedStartInput } from "../../api/src/services/manualRunStartReviewedWriteSchema";
const key = "00000000-0000-4000-8000-000000000001", configurationId = "00000000-0000-4000-8000-000000000002";
function fixture() {
  const context = { configuration: "Rig\nA", platform: "", build: "", hardwareRevision: "", firmwareVersion: "", rig: "", batchOrLot: "", environment: "", calibrationReference: "", protocolReference: "" };
  const input = { projectId: "p", testPlanId: "plan", originalOrganizationId: "o", expectedClerkActorId: "cl", expectedNativeActorId: "n", requestId: key, search: "", limit: 2 };
  const template = { version: 1, testCaseIds: ["second", "first"], configurations: [{ id: configurationId, name: "Rig\nA", context }] };
  const rawPage = {
    readContext: { projection: "PAGE", requestId: key, requestedKey: planExecutionReviewedReadKey(input, "PAGE"), scope: { projectId: "p", testPlanId: "plan", organizationId: "o", actorClerkUserId: "cl", actorId: "n" } },
    hasFullEditorAccess: true, plan: { id: "plan", projectId: "p", name: " Raw\n plan ", status: "ACTIVE" },
    rawTemplate: { sqlNull: false, jsonText: JSON.stringify(template) }, template, templateHash: "b".repeat(64), interpretation: "EXACT_SUPPORTED",
    selected: template.testCaseIds.map(testCaseId => ({ testCaseId, state: "AVAILABLE", metadata: { id: testCaseId, title: " Exact\n case ", displayId: "", reviewStatus: "APPROVED", archived: false } })),
    candidates: [], search: "", limit: 2, candidateScopeKey: planExecutionCandidateBrowserKey(input), nextCursor: null, limitations: [],
  };
  const admittedPlan = admitPlanExecutionRead(rawPage, input, "PAGE", "cl")!;
  let plan: PlanExecutionReadSnapshot = Object.freeze({ origin: admittedPlan.origin, observedSessionId: "session-A", projection: "PAGE", epoch: 0, revision: 0, receivedAt: "2026-10-06T00:00:00.000Z", data: admittedPlan.data });
  const profileInput = { projectId: "p", originalOrganizationId: "o", expectedClerkActorId: "cl", expectedNativeActorId: "n", requestId: key };
  const rawProfile = { readContext: { requestId: key, requestedKey: runStartReviewedReadKey(profileInput, "PREVIEW"), projection: "PREVIEW", scope: { projectId: "p", organizationId: "o", actorId: "n", actorClerkUserId: "cl" } }, canConfigure: true, canRecover: true, canStart: true, profile: { kind: "SUPPORTED", experience: null, profileHash: "a".repeat(64) }, limitations: [] };
  const admittedProfile = admitRunStartRead(rawProfile, profileInput, "PREVIEW", "cl")!;
  let profile: RunStartReadSnapshot = Object.freeze({ origin: admittedProfile.origin, observedSessionId: "session-A", projection: "PREVIEW", epoch: 0, revision: 0, receivedAt: "2026-10-06T00:00:00.000Z", data: admittedProfile.data });
  const request: ReviewedPlanRunRequest = { projectId: "p", testCaseIds: ["second", "first"], expectedProfileHash: "a".repeat(64), executionContext: { ...context }, idempotencyKey: key, planReference: { testPlanId: "plan", expectedTemplateHash: "b".repeat(64), configurationId }, originalOrganizationId: "o", expectedClerkActorId: "cl" };
  const selection = (): ReviewedPlanStartSelection => ({ intent: "UNSENT", plan, profile, configurationId, currentPlan: () => plan, currentProfile: () => profile });
  function changePlan(edit: (value: typeof rawPage) => void) { const value = structuredClone(rawPage); edit(value); plan = Object.freeze({ ...plan, data: deepFreeze(value) as PlanExecutionReadSnapshot["data"] }); }
  function changeProfile(edit: (value: typeof rawProfile) => void) { const value = structuredClone(rawProfile); edit(value); profile = Object.freeze({ ...profile, data: deepFreeze(value) as RunStartReadSnapshot["data"] }); }
  return { request, selection, changePlan, changeProfile, get plan() { return plan; }, get profile() { return profile; }, setPlan: (value: PlanExecutionReadSnapshot) => { plan = value; }, setProfile: (value: RunStartReadSnapshot) => { profile = value; } };
}
function deepFreeze<T>(value: T): T { if (value && typeof value === "object") { Object.values(value).forEach(deepFreeze); Object.freeze(value); } return value; }
function legacyParsedHashModel(request: ReviewedPlanRunRequest) {
  function canonical(value: unknown): string { if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(",")}}`; return JSON.stringify(value) ?? "null"; }
  // Synthetic model of the source recipe only, not executed native/server proof.
  return createHash("sha256").update(canonical({ testCaseIds: request.testCaseIds, expectedProfileHash: request.expectedProfileHash, configuration: request.executionContext, planReference: request.planReference, originalOrganizationId: request.originalOrganizationId, expectedClerkActorId: request.expectedClerkActorId })).digest("hex");
}
function ack() { return { mode: "START", currentScope: { projectId: "p", organizationId: "o", actorId: "n", actorClerkUserId: "cl" }, idempotencyKey: key, legacyAck: { testRunId: `manual_${createHash("sha256").update(JSON.stringify(["p", "n", key])).digest("hex")}`, originalOrganizationId: "o", expectedClerkActorId: "cl", idempotencyKey: key }, historicalOuterProvenance: "UNRECORDED", interpretation: "LEGACY_NORMALIZED_NOT_RAW_LOSSLESS" }; }
it("prospective exact plan intent preserves original inner bytes/order/key and metadata without native pin injection", () => {
  const h = fixture(), before = JSON.stringify(h.request), owned = freezeReviewedPlanStart(h.request, h.selection());
  expect(JSON.stringify(owned.request)).toBe(before); expect(owned.envelope.request).toBe(owned.request);
  expect(owned.request.testCaseIds).toEqual(["second", "first"]); expect(owned.envelope.expectedNativeActorId).toBe("n");
  expect(Object.hasOwn(owned.request, "expectedNativeActorId")).toBe(false);
  expect(owned.cohortVerified).toBe(false); expect(owned.receiptVerified).toBe(false);
  expect(manualRunStartReviewedStartInput.safeParse(owned.envelope).success).toBe(true);
  expect(legacyParsedHashModel(owned.request)).toBe(legacyParsedHashModel(h.request));
  expect(Object.isFrozen(owned.request.planReference)).toBe(true); expect(Object.isFrozen(owned.request.executionContext)).toBe(true);
  h.request.testCaseIds.reverse(); h.request.executionContext.environment = "changed"; h.request.planReference.expectedTemplateHash = "c".repeat(64);
  expect(JSON.stringify(owned.request)).toBe(before);
});
it("reversed input property order including planReference remains exact rather than rebuilt or sorted", () => {
  const h = fixture(); const reversed = Object.fromEntries(Object.entries(h.request).reverse()) as ReviewedPlanRunRequest;
  reversed.planReference = Object.fromEntries(Object.entries(reversed.planReference).reverse()) as ReviewedPlanRunRequest["planReference"];
  const before = JSON.stringify(reversed), owned = freezeReviewedPlanStart(reversed, h.selection());
  expect(JSON.stringify(owned.request)).toBe(before); expect(legacyParsedHashModel(owned.request)).toBe(legacyParsedHashModel(reversed));
});
it.each(["missing", "bareLegacy", "unknown", "getter", "extra"])("unsupported %s provenance cannot receive a new original N wrapper", kind => {
  const h = fixture(), selection: unknown = kind === "unknown" ? { ...h.selection(), intent: "UNKNOWN" } : kind === "missing" ? { ...h.selection(), plan: null } : kind === "extra" ? { ...h.selection(), historicalNativeActorId: "inferred" } : h.selection();
  if (kind === "bareLegacy") delete (h.request as Partial<ReviewedPlanRunRequest>).originalOrganizationId;
  if (kind === "getter") Object.defineProperty(selection, "plan", { enumerable: true, get: () => { throw Error("PRIVATE_GETTER"); } });
  expect(() => freezeReviewedPlanStart(h.request, selection as ReviewedPlanStartSelection)).toThrow("No historical attempt");
});
it.each(["PAGE", "profile", "session", "plan", "native", "org", "Clerk", "FULL"])("changed %s context refuses before ownership", kind => {
  const h = fixture();
  if (kind === "PAGE") h.setPlan(Object.freeze({ ...h.plan, projection: "ACCESS" }));
  if (kind === "profile") h.setProfile(Object.freeze({ ...h.profile, projection: "ACCESS" }));
  if (kind === "session") h.setProfile(Object.freeze({ ...h.profile, observedSessionId: "B" }));
  if (kind === "plan") h.request.planReference.testPlanId = "other";
  if (kind === "native") h.setProfile(Object.freeze({ ...h.profile, origin: Object.freeze({ ...h.profile.origin, nativeActorId: "M" }) }));
  if (kind === "org") h.setProfile(Object.freeze({ ...h.profile, origin: Object.freeze({ ...h.profile.origin, organizationId: "other" }) }));
  if (kind === "Clerk") h.setProfile(Object.freeze({ ...h.profile, origin: Object.freeze({ ...h.profile.origin, clerkActorId: "other" }) }));
  if (kind === "FULL") h.changePlan(raw => { raw.hasFullEditorAccess = false; });
  expect(() => freezeReviewedPlanStart(h.request, h.selection())).toThrow("nothing was submitted");
});
it.each(["order", "missing", "unreviewed", "archived", "templateHash", "profileHash", "configuration", "context", "zero", "unknownField"])("unsupported %s selected scope/raw configuration is not normalized or partially owned", kind => {
  const h = fixture();
  if (kind === "order") h.request.testCaseIds.reverse();
  if (kind === "missing") h.changePlan(raw => { raw.selected[0]!.state = "MISSING"; (raw.selected[0] as { metadata: unknown }).metadata = null; });
  if (kind === "unreviewed") h.changePlan(raw => { raw.selected[0]!.metadata.reviewStatus = "PENDING_REVIEW"; });
  if (kind === "archived") h.changePlan(raw => { raw.plan.status = "ARCHIVED"; });
  if (kind === "templateHash") h.request.planReference.expectedTemplateHash = "c".repeat(64);
  if (kind === "profileHash") h.request.expectedProfileHash = "c".repeat(64);
  if (kind === "configuration") h.request.planReference.configurationId = key;
  if (kind === "context") h.request.executionContext.configuration = "Rig\nB";
  if (kind === "zero") (h.request.executionContext as Record<string, unknown>).environment = 0;
  if (kind === "unknownField") (h.request as unknown as Record<string, unknown>).future = "retained";
  expect(() => freezeReviewedPlanStart(h.request, h.selection())).toThrow();
});
it("legacy normalized/missing-context defaults stay display-only, not falsely exact start permission", () => {
  const h = fixture(); h.changePlan(raw => { raw.interpretation = "LEGACY_NORMALIZED"; const native = JSON.parse(raw.rawTemplate.jsonText) as { configurations: Array<{ context: unknown }> }; native.configurations[0]!.context = {}; raw.rawTemplate.jsonText = JSON.stringify(native); });
  expect(() => freezeReviewedPlanStart(h.request, h.selection())).toThrow();
});
it("shallow-only snapshot freeze and stale current callbacks cannot establish current authority", () => {
  const h = fixture(); h.setPlan(Object.freeze({ ...h.plan, data: structuredClone(h.plan.data) }));
  expect(() => freezeReviewedPlanStart(h.request, h.selection())).toThrow();
  const fresh = fixture(), selection = fresh.selection();
  expect(() => freezeReviewedPlanStart(fresh.request, { ...selection, currentPlan: () => null })).toThrow();
  expect(() => freezeReviewedPlanStart(fresh.request, { ...selection, currentProfile: () => Object.freeze({ ...fresh.profile }) })).toThrow();
});
it("action-time callbacks must remain exact through validation/copy, while original caller draft mutations cannot change the body", () => {
  const h = fixture(), selection = h.selection(), before = JSON.stringify(h.request);
  const owned = freezeReviewedPlanStart(h.request, { ...selection, currentPlan: () => { h.request.executionContext.environment = "mutated after capture"; return h.plan; } });
  expect(JSON.stringify(owned.request)).toBe(before);
  let calls = 0; const current = fixture();
  expect(() => freezeReviewedPlanStart(current.request, { ...current.selection(), currentPlan: () => ++calls === 1 ? current.plan : null })).toThrow();
});
it("unsafe request getters are never invoked to hash, trim or freeze a plan body", () => {
  const h = fixture(); let calls = 0;
  Object.defineProperty(h.request, "planReference", { enumerable: true, get: () => { calls++; return {}; } });
  expect(() => freezeReviewedPlanStart(h.request, h.selection())).toThrow(); expect(calls).toBe(0);
});
it("shared WebCrypto target and complete exact ACK retain old p,N,UUID derivation without claiming raw-native/cohort provenance", async () => {
  const h = fixture(), owned = freezeReviewedPlanStart(h.request, h.selection());
  expect(await expectedReviewedPlanRunId(owned)).toBe(ack().legacyAck.testRunId);
  const confirmed = await verifyReviewedPlanStartAck(owned, ack());
  expect(confirmed.historicalOuterProvenance).toBe("UNRECORDED"); expect(confirmed.interpretation).toBe("LEGACY_NORMALIZED_NOT_RAW_LOSSLESS");
  for (const bad of [{ ...ack(), currentScope: { ...ack().currentScope, actorId: "M" } }, { ...ack(), legacyAck: { ...ack().legacyAck, testRunId: `manual_${"f".repeat(64)}` } }, { ...ack(), idempotencyKey: configurationId }]) await expect(verifyReviewedPlanStartAck(owned, bad)).rejects.toThrow("unknown");
});
it("runtime dependency imports remain browser-only and this helper has no transport/save/controller mutation", () => {
  const source = readFileSync(new URL("./plan-execution-reviewed-start.ts", import.meta.url), "utf8");
  expect(source).not.toMatch(/from ["'](?:node:|@vaettir\/db|@vaettir\/api)|api\/src/);
  expect(source).not.toMatch(/\.mutateAsync\(|\.fetch\(|\.sort\(|setRunAttempt|saveExecutionTemplate|window\.location/);
  expect(source).toContain("verifyReviewedRunStartAck(owned, value)");
  const legacySource = readFileSync(new URL("../../api/src/services/manualRunStart.ts", import.meta.url), "utf8");
  expect(legacySource).toContain("testCaseIds: input.planReference"); expect(legacySource).toContain("? input.testCaseIds");
});
