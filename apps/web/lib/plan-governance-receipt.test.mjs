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
test("detachment acknowledgement requires an explicit NULL target and original non-null release", () => {
  const detach = { ...pending, operation: "DETACH_ATTACHED_PLAN", input: { requestId: input.requestId, testPlanId: "plan", expectedPlanRevision: input.expectedPlanRevision, expectedReleaseId: "source-release", releaseId: null } };
  const saved = { ...ack, operation: detach.operation, criterionId: null, releaseId: null };
  assertGovernanceAcknowledgement(saved, detach);
  for (const change of [{ releaseId: "source-release" }, { releaseId: undefined }, { criterionId: "criterion" }, { operation: "ATTACH_UNASSIGNED_PLAN" }, { requestHash: "d".repeat(64) }, { beforeRevision: "d".repeat(64) }]) assert.throws(() => assertGovernanceAcknowledgement({ ...saved, ...change }, detach));
  for (const change of [{ releaseId: undefined }, { expectedReleaseId: null }, { expectedReleaseId: "" }, { expectedReleaseId: undefined }]) assert.throws(() => assertGovernanceAcknowledgement(saved, { ...detach, input: { ...detach.input, ...change } }));
});
test("detachment hash binds exact original release, NULL target and unchanged revision", async () => {
  const operation = "DETACH_ATTACHED_PLAN", body = { testPlanId: "plan", expectedReleaseId: "source-release", releaseId: null, expectedPlanRevision: "a".repeat(64) };
  const hash = await planGovernanceRequestHash(operation, body);
  const expected = createHash("sha256").update('{"input":{"expectedPlanRevision":"' + "a".repeat(64) + '","expectedReleaseId":"source-release","releaseId":null,"testPlanId":"plan"},"operation":"DETACH_ATTACHED_PLAN"}').digest("hex");
  assert.equal(hash, expected);
  for (const change of [{ expectedReleaseId: "other-release" }, { releaseId: "other-release" }, { expectedPlanRevision: "b".repeat(64) }]) assert.notEqual(await planGovernanceRequestHash(operation, { ...body, ...change }), hash);
  const missingTarget = { ...body }; delete missingTarget.releaseId;
  assert.notEqual(await planGovernanceRequestHash(operation, missingTarget), hash);
});
test("detachment history renders the retained NULL assignment as Unassigned", () => {
  const source = readFileSync(new URL("../components/PlanGovernanceHistory.tsx", import.meta.url), "utf8");
  assert.match(source, /entry\.receipt\.after\.releaseId \?\? "Unassigned"/);
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
test("both actual criterion surfaces mount guarded wording/verdict/history without stale field resubmission", () => {
  for (const path of ["../components/TestPlanDetailContent.tsx", "../app/projects/[projectId]/releases/[releaseId]/page.tsx"]) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    for (const name of ["CriterionDescriptionEditor", "CriterionVerdictEditor", "PlanGovernanceHistory"]) assert.match(source, new RegExp(`<${name}\\b`));
    assert.doesNotMatch(source, /updateAcceptanceCriterion\.useMutation\(|async function updateCriterionStatus\(/);
  }
  const plan = readFileSync(new URL("../components/TestPlanDetailContent.tsx", import.meta.url), "utf8");
  assert.match(plan, /<span hidden=\{readOnly\}><CriterionDescriptionEditor/);
  assert.match(plan, /<div hidden=\{readOnly\}><CriterionVerdictEditor/);
});
function controllerHarness(component, { allowed = true, editable = true, lateActor = false, latePlan = false, readOnly = false, wrongAck = false, failure } = {}) {
  const source = readFileSync(new URL(`../components/${component}.tsx`, import.meta.url), "utf8").replaceAll("\r\n", "\n");
  const start = source.indexOf("  async function commit()"), end = source.indexOf(component === "AttachUnassignedPlan" ? "  if (!access.readable)" : "  const readable", start);
  assert.ok(start > 0 && end > start);
  const attachment = component === "AttachUnassignedPlan";
  const { description: _description, ...verdictInput } = input;
  const held = attachment ? { ...pending, operation: "ATTACH_UNASSIGNED_PLAN", input: { ...input, criterionId: undefined, releaseId: "release" } } : component === "CriterionVerdictEditor" ? { ...pending, operation: "SET_CRITERION_VERDICT", input: { ...verdictInput, status: "MET" } } : component === "GovernedCriterionCollection" ? { ...pending, operation: "DELETE_CRITERION", input: { ...verdictInput, expectedCriterionRevision:"d".repeat(64), expectedRequirementId:"req" } } : pending;
  const state = { pending: held }, calls = [];
  let currentAllowed = allowed;
  const context = {
    pending: held, draft: null, baseline:null, origin, frame:{current:{projectId:"project",testPlanId:"plan",readOnly}}, readOnly, busy:false, preparing: false, fresh: null, confirmed: false, reason: "", targetBlocked: false,
    access: { origin, owns: (_original, mode) => currentAllowed && (mode !== "edit" || editable) },
    save: { isPending: false, mutateAsync: async actual => { calls.push(actual); if (failure) throw failure; if (lateActor) currentAllowed = false; if(latePlan) context.frame.current.testPlanId="other-plan"; return { ...ack, operation: held.operation, criterionId: attachment ? null : input.criterionId, releaseId: attachment ? "release" : null, requestId: wrongAck ? "wrong" : input.requestId }; } },
    assertGovernanceAcknowledgement, retainedGovernancePending, planGovernanceRequestHash,
    setPending: value => { state.pending = value; }, setDraft: value => { state.draft = value; }, setBaseline:value=>{state.baseline=value;}, setDescription:value=>{state.description=value;},setCriterionId:value=>{state.criterionId=value;},setRequirementId:value=>{state.requirementId=value;},setConfirmed: value => { state.confirmed = value; }, setReason: value => { state.reason = value; }, setNotice: value => { state.notice = value; }, setPlanId: value => { state.planId = value; },
    query: { refetch: async () => calls.push("refetch") }, onChanged: () => calls.push("changed"),
  };
  context.add=context.save; context.remove=context.save; context.associate=context.save;
  const compiled = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return { commit: runInNewContext(`${compiled}; commit`, context), state, calls, held };
}
test("actual wording and attachment retry controllers refuse revoked or changed actors without sending retained private bodies", async () => {
  for (const component of ["CriterionDescriptionEditor", "AttachUnassignedPlan", "CriterionVerdictEditor", "GovernedCriterionCollection"]) for (const options of [{ allowed: false }, { editable: false }]) {
    const h = controllerHarness(component, options); await h.commit(); assert.deepEqual(h.calls, []); assert.equal(h.state.pending, h.held);
  }
});
test("actual controllers retain exact pending requests after wrong ACK or late actor switch without refreshing another account", async () => {
  for (const component of ["CriterionDescriptionEditor", "AttachUnassignedPlan", "CriterionVerdictEditor", "GovernedCriterionCollection"]) for (const options of [{ wrongAck: true }, { lateActor: true }]) {
    const h = controllerHarness(component, options); await h.commit(); assert.equal(h.calls.length, 1); assert.equal(h.state.pending.input, h.held.input); assert.equal(h.state.pending.uncertain, true);
  }
});
test("actual controllers never discard an earlier uncertain request after later definite rejection", async () => {
  for (const component of ["CriterionDescriptionEditor", "AttachUnassignedPlan", "CriterionVerdictEditor", "GovernedCriterionCollection"]) {
    const h = controllerHarness(component, { failure: { data: { code: "CONFLICT" } } }); await h.commit(); assert.equal(h.state.pending.input, h.held.input); assert.equal(h.state.pending.uncertain, true);
  }
});
test("only matching acknowledged controller requests clear and refresh the current original workspace", async () => {
  for (const component of ["CriterionDescriptionEditor", "AttachUnassignedPlan", "CriterionVerdictEditor", "GovernedCriterionCollection"]) {
    const h = controllerHarness(component); await h.commit(); assert.equal(h.state.pending, null); assert.equal(h.calls[0], h.held.input); assert.equal(h.calls.at(-1), "changed");
  }
});
test("criterion collection keeps uncertain receipts on same-project plan switches or temporary read-only hosts", async () => {
  const switched=controllerHarness("GovernedCriterionCollection",{latePlan:true}); await switched.commit(); assert.equal(switched.calls.length,1); assert.equal(switched.state.pending.input,switched.held.input); assert.equal(switched.state.pending.uncertain,true);
  const read=controllerHarness("GovernedCriterionCollection",{readOnly:true}); await read.commit(); assert.deepEqual(read.calls,[]); assert.equal(read.state.pending,read.held);
});
test("collection scopes requirement choices, preserves exact prose and seeds an existing association before an explicit reviewed unlink", () => {
  const collection=readFileSync(new URL("../components/GovernedCriterionCollection.tsx",import.meta.url),"utf8");
  const editor=readFileSync(new URL("../components/CriterionDescriptionEditor.tsx",import.meta.url),"utf8");
  assert.match(collection,/keepMounted/); assert.match(collection,/requirementChoices.useQuery/); assert.match(collection,/sameGovernanceReader\(\s*choicesQuery.data.scope,\s*origin,?\s*\)/); assert.match(collection,/take: 25/);
  assert.match(collection,/expectedRequirementId: criterion!.requirementId/); assert.match(collection,/Reviewed association:/);
  assert.match(collection,/setRequirementId\(\s*baseline\.snapshot\.criteria\.find/); assert.doesNotMatch(collection,/description: description.trim\(\)/);
  assert.match(editor,/description: draft.text,/); assert.match(editor,/wordingMode: "EXACT"/); assert.doesNotMatch(editor,/description: draft.text.trim\(\)/);
});
test("the actual new wording controller sends raw EXACT prose and accepts only its browser-hashed acknowledgement", async () => {
  const source=readFileSync(new URL("../components/CriterionDescriptionEditor.tsx",import.meta.url),"utf8").replaceAll("\r\n","\n");
  const start=source.indexOf("  async function commit()"),end=source.indexOf("  const readable",start);
  const raw="  Exact new wording\nwith whitespace.  \n", calls=[], state={pending:null};
  const context={
    pending:null, draft:{text:raw,revision:input.expectedPlanRevision,criterionRevision:"e".repeat(64),origin},fresh:{canEdit:true},reason:"Human wording review",confirmed:true,preparing:false,
    projectId:"project",testPlanId:"plan",criterionId:"criterion", crypto:{randomUUID:()=>input.requestId},
    access:{owns:()=>true},
    save:{isPending:false,mutateAsync:async request=>{calls.push(request);return{...ack,requestHash:await planGovernanceRequestHash("EDIT_CRITERION_DESCRIPTION",request)};}},
    planGovernanceRequestHash,assertGovernanceAcknowledgement,retainedGovernancePending,
    setPreparing:value=>{state.preparing=value;},setPending:value=>{state.pending=value;},setDraft:value=>{state.draft=value;},setConfirmed:()=>{},setReason:()=>{},setNotice:value=>{state.notice=value;},
    query:{refetch:async()=>{}},onChanged:()=>{state.changed=true;},
  };
  const compiled=ts.transpileModule(source.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
  await runInNewContext(`${compiled}; commit`,context)();
  assert.equal(calls.length,1); assert.equal(calls[0].description,raw); assert.equal(calls[0].wordingMode,"EXACT"); assert.equal(state.pending,null); assert.equal(state.changed,true);
});
test("a retained unmarked wording request is not retroactively marked EXACT on retry", async () => {
  const h=controllerHarness("CriterionDescriptionEditor"); await h.commit();
  assert.equal(h.calls[0],h.held.input); assert.equal(Object.hasOwn(h.calls[0],"wordingMode"),false);
});
test("verdict control sends only the reviewed native verdict and refuses fake computed evidence", () => {
  const control = readFileSync(new URL("../components/CriterionVerdictEditor.tsx", import.meta.url), "utf8");
  const page = readFileSync(new URL("../app/projects/[projectId]/releases/[releaseId]/page.tsx", import.meta.url), "utf8");
  assert.match(control, /SET_CRITERION_VERDICT/); assert.match(control, /fresh.manualVerdicts/); assert.match(control, /keepMounted/);
  const request = control.slice(control.indexOf("const input: Input"), control.indexOf("setPreparing(true)", control.indexOf("const input: Input")));
  assert.doesNotMatch(request, /description:|requirementId:/); assert.match(request, /status: draft.status/);
  assert.match(page, /<CriterionVerdictEditor/); assert.doesNotMatch(page, /updateAcceptanceCriterion|updateCriterionStatus/);
});
