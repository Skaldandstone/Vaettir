import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { assertGovernanceAcknowledgement, planGovernanceRequestHash, retainedGovernancePending, sameGovernanceReader } from "./plan-governance-receipt.ts";
const origin = { projectId: "project", organizationId: "org", clerkActorId: "clerk", caseId: null };
const input = { requestId: "9c33b316-593d-4306-a1c8-08e54dcb7b93", testPlanId: "plan", expectedPlanRevision: "a".repeat(64), criterionId: "criterion", description: "Retained text" };
const pending = { input, origin, requestHash: "b".repeat(64), operation: "EDIT_CRITERION_DESCRIPTION", uncertain: true };
const ack = { scope: { projectId: "project", organizationId: "org", actorId: "native", actorClerkUserId: "clerk" }, requestId: input.requestId, requestHash: pending.requestHash, operation: pending.operation, testPlanId: "plan", criterionId: "criterion", releaseId: null, versionId: "version", versionNumber: 1, beforeRevision: input.expectedPlanRevision, afterRevision: "c".repeat(64), replayed: true };
test("original reader and exact request identity guard governance acknowledgements", () => {
  assertGovernanceAcknowledgement(ack, pending);
  for (const change of [{ requestId: "wrong" }, { requestHash: "d".repeat(64) }, { operation: "ATTACH_UNASSIGNED_PLAN" }, { criterionId: "other" }, { testPlanId: "other" }, { beforeRevision: "d".repeat(64) }, { versionId: "" }, { scope: { ...ack.scope, organizationId: "foreign" } }, { scope: { ...ack.scope, actorClerkUserId: "other" } }]) assert.throws(() => assertGovernanceAcknowledgement({ ...ack, ...change }, pending));
  assert.equal(sameGovernanceReader(undefined, origin), false);
});
test("attachment acknowledgement cannot name a different release", () => {
  const attachment = { ...pending, operation: "ATTACH_UNASSIGNED_PLAN", input: { ...input, criterionId: undefined, releaseId: "release" } };
  assertGovernanceAcknowledgement({ ...ack, operation: attachment.operation, criterionId: null, releaseId: "release" }, attachment);
  assert.throws(() => assertGovernanceAcknowledgement({ ...ack, operation: attachment.operation, criterionId: null, releaseId: "other" }, attachment));
});
test("unknown first acknowledgement latches the original input through later refusals", () => {
  const unknown = retainedGovernancePending({ ...pending, uncertain: false }, new Error("timeout"));
  assert.equal(unknown.input, input); assert.equal(unknown.uncertain, true);
  assert.equal(retainedGovernancePending(unknown, { data: { code: "CONFLICT" } }).input, input);
  assert.equal(retainedGovernancePending({ ...pending, uncertain: false }, { data: { code: "CONFLICT" } }), null);
});
test("browser hashing uses the server's sorted canonical JSON rather than object insertion order", async () => {
  const operation = "EDIT_CRITERION_DESCRIPTION", value = { z: [false, { y: "Text", a: 2 }], a: 1 };
  const expected = createHash("sha256").update('{"input":{"a":1,"z":[false,{"a":2,"y":"Text"}]},"operation":"EDIT_CRITERION_DESCRIPTION"}').digest("hex");
  assert.equal(await planGovernanceRequestHash(operation, value), expected);
  assert.equal(await planGovernanceRequestHash(operation, { a: 1, z: [false, { a: 2, y: "Text" }] }), expected);
});
test("controls keep original pending bodies mounted and only submit description-only or unassigned attachment paths", () => {
  const editor = readFileSync(new URL("../components/CriterionDescriptionEditor.tsx", import.meta.url), "utf8");
  const attach = readFileSync(new URL("../components/AttachUnassignedPlan.tsx", import.meta.url), "utf8");
  const page = readFileSync(new URL("../app/projects/[projectId]/releases/[releaseId]/page.tsx", import.meta.url), "utf8");
  assert.match(editor, /keepMounted/); assert.match(editor, /pending\?\.origin \?\? draft\?\.origin/);
  for (const source of [editor, attach]) { assert.match(source, /assertGovernanceAcknowledgement\(result, retained\)/); assert.match(source, /retainedGovernancePending\(retained, cause\)/); assert.match(source, /access\.owns\(original, "edit"\)/); }
  assert.match(attach, /expectedReleaseId: null/); assert.match(page, /<AttachUnassignedPlan/);
  assert.doesNotMatch(page, /async function attachPlan\(/); assert.match(page, /<CriterionDescriptionEditor/);
});
function controllerHarness(component, { allowed = true, editable = true, lateActor = false, wrongAck = false, failure } = {}) {
  const source = readFileSync(new URL(`../components/${component}.tsx`, import.meta.url), "utf8").replaceAll("\r\n", "\n");
  const start = source.indexOf("  async function commit()"), end = source.indexOf(component === "CriterionDescriptionEditor" ? "  const readable" : "  if (!access.readable)", start);
  assert.ok(start > 0 && end > start);
  const attachment = component === "AttachUnassignedPlan";
  const held = attachment ? { ...pending, operation: "ATTACH_UNASSIGNED_PLAN", input: { ...input, criterionId: undefined, releaseId: "release" } } : pending;
  const state = { pending: held }, calls = [];
  let currentAllowed = allowed;
  const context = {
    pending: held, draft: null, preparing: false, fresh: null, confirmed: false, reason: "", targetBlocked: false,
    access: { origin, owns: (_original, mode) => currentAllowed && (mode !== "edit" || editable) },
    save: { isPending: false, mutateAsync: async actual => { calls.push(actual); if (failure) throw failure; if (lateActor) currentAllowed = false; return { ...ack, operation: held.operation, criterionId: attachment ? null : input.criterionId, releaseId: attachment ? "release" : null, requestId: wrongAck ? "wrong" : input.requestId }; } },
    assertGovernanceAcknowledgement, retainedGovernancePending, planGovernanceRequestHash,
    setPending: value => { state.pending = value; }, setDraft: value => { state.draft = value; }, setConfirmed: value => { state.confirmed = value; }, setReason: value => { state.reason = value; }, setNotice: value => { state.notice = value; }, setPlanId: value => { state.planId = value; },
    query: { refetch: async () => calls.push("refetch") }, onChanged: () => calls.push("changed"),
  };
  const compiled = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return { commit: runInNewContext(`${compiled}; commit`, context), state, calls, held };
}
test("actual wording and attachment retry controllers refuse revoked or changed actors without sending retained private bodies", async () => {
  for (const component of ["CriterionDescriptionEditor", "AttachUnassignedPlan"]) for (const options of [{ allowed: false }, { editable: false }]) {
    const h = controllerHarness(component, options); await h.commit(); assert.deepEqual(h.calls, []); assert.equal(h.state.pending, h.held);
  }
});
test("actual controllers retain exact pending requests after wrong ACK or late actor switch without refreshing another account", async () => {
  for (const component of ["CriterionDescriptionEditor", "AttachUnassignedPlan"]) for (const options of [{ wrongAck: true }, { lateActor: true }]) {
    const h = controllerHarness(component, options); await h.commit(); assert.equal(h.calls.length, 1); assert.equal(h.state.pending.input, h.held.input); assert.equal(h.state.pending.uncertain, true);
  }
});
test("actual controllers never discard an earlier uncertain request after later definite rejection", async () => {
  for (const component of ["CriterionDescriptionEditor", "AttachUnassignedPlan"]) {
    const h = controllerHarness(component, { failure: { data: { code: "CONFLICT" } } }); await h.commit(); assert.equal(h.state.pending.input, h.held.input); assert.equal(h.state.pending.uncertain, true);
  }
});
test("only matching acknowledged controller requests clear and refresh the current original workspace", async () => {
  for (const component of ["CriterionDescriptionEditor", "AttachUnassignedPlan"]) {
    const h = controllerHarness(component); await h.commit(); assert.equal(h.state.pending, null); assert.equal(h.calls[0], h.held.input); assert.equal(h.calls.at(-1), "changed");
  }
});
