// Actual handler contracts only. Mounted provider/cache/DOM acceptance is separate.
// Authored for root execution; no test run was performed by the source author.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import ts from "typescript";
import { assertCaseFieldAcknowledgement, retainedCaseFieldReceipt, sameCaseFieldOrigin } from "./case-field-origin.ts";

const source = readFileSync(new URL("../components/ProjectCaseFields.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("ProjectCaseFields.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const component = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "FieldDefinitions");
assert.ok(component?.body);
const names = ["show", "applyField", "compare", "commit"];
const printer = ts.createPrinter();
const body = names.map((name) => {
  const node = component.body.statements.find((value) => ts.isFunctionDeclaration(value) && value.name?.text === name);
  assert.ok(node, `Actual ${name} handler exists`);
  return printer.printNode(ts.EmitHint.Unspecified, node, ast);
}).join("\n");
const compiled = ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const original = { projectId: "synthetic-project", organizationId: "synthetic-org", clerkActorId: "synthetic-a", caseId: null };
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
function fixture() {
  const baseline = { projectId: original.projectId, organizationId: original.organizationId, caseId: null, canConfigure: true, expectedSchemaHash: "synthetic-actor-bound-hash", schema: { version: 1, fields: [{ key: "private_key", label: "Private A draft", type: "TEXT", required: true, retired: false, options: [] }] } };
  const state = {
    projectId: original.projectId, busy: false, canApprove: true, baseline,
    schema: baseline.schema, field: baseline.schema.fields[0], selected: 0,
    emptyField: { key: "", label: "", type: "TEXT", required: false, retired: false, options: [] },
    fresh: baseline, open: true, reason: "Original human rationale", confirmed: true,
    notice: "Original A notice", pending: null, submitted: [], refetches: 0, invalidations: 0,
    impact: { projectId: original.projectId, actorId: "synthetic-native-a", expectedSchemaHash: baseline.expectedSchemaHash, expectedImpactHash: "synthetic-impact-hash" },
    crypto: { randomUUID: () => "70cdf568-ccea-4c3d-8d35-269c3bf5fe09" },
    assertCaseFieldAcknowledgement, retainedCaseFieldReceipt,
  };
  state.access = {
    origin: original, current: original, canConfigure: true, readable: true,
    owns: (origin) => state.access.canConfigure && sameCaseFieldOrigin(origin, state.access.current),
  };
  state.query = { refetch: async () => { state.refetches++; return { data: baseline, error: null, isFetching: false, isPaused: false }; } };
  state.review = { mutateAsync: async () => state.impact };
  state.configure = { mutateAsync: async (input) => { state.submitted.push(input); return { requestId: input.requestId, replayed: false }; } };
  state.utils = { caseFields: { get: { invalidate: () => { state.invalidations++; } } } };
  for (const name of ["open", "baseline", "schema", "selected", "field", "impact", "reason", "confirmed", "notice", "pending"]) {
    state[`set${name[0].toUpperCase()}${name.slice(1)}`] = (value) => { state[name] = typeof value === "function" ? value(state[name]) : value; };
  }
  const context = createContext(state);
  return { state, handlers: runInContext(`${compiled}; ({${names.join(",")}})`, context) };
}
function switchActor(state) { state.access.current = { ...original, clerkActorId: "synthetic-b" }; }

test("new unkept field properties refuse impact review and retain the exact editor draft", async () => {
  const changes = [
    { key: "component" }, { label: "Component" }, { type: "CHOICE" },
    { required: true }, { retired: true }, { options: [" Web ", "Mobile"] },
  ];
  for (const change of changes) {
    const { state, handlers } = fixture();
    state.selected = -1;
    state.field = { ...state.emptyField, ...change };
    const field = state.field, schema = state.schema, rationale = state.reason;
    let reviews = 0;
    state.review.mutateAsync = async () => { reviews++; throw Error("Unkept field must not reach review"); };
    await handlers.compare();
    assert.equal(reviews, 0);
    assert.equal(state.field, field);
    assert.equal(state.schema, schema);
    assert.equal(state.reason, rationale);
    assert.equal(state.submitted.length, 0);
    assert.equal(state.impact, null);
    assert.equal(state.confirmed, false);
    assert.equal(state.notice, "Keep this field in the draft before reviewing changes.");
  }
});

test("existing unkept exact scalar and literal ordered-choice edits refuse review", async () => {
  const changes = [
    { key: "different_key" }, { label: " Updated label " }, { type: "TEXT" },
    { required: true }, { retired: true },
    { options: ["Web", "Mobile"] }, { options: ["Mobile", " Web "] },
    { options: [" Web "] }, { options: [" Web ", "Mobile", "Other"] },
  ];
  for (const change of changes) {
    const { state, handlers } = fixture();
    const kept = { key: "component", label: "Component", type: "CHOICE", required: false, retired: false, options: [" Web ", "Mobile"] };
    state.schema = { version: 1, fields: [kept] };
    state.field = { ...kept, ...change };
    const field = state.field, schema = state.schema, rationale = state.reason;
    let reviews = 0;
    state.review.mutateAsync = async () => { reviews++; throw Error("Unkept edit must not reach review"); };
    await handlers.compare();
    assert.equal(reviews, 0);
    assert.equal(state.field, field);
    assert.equal(state.schema, schema);
    assert.equal(state.reason, rationale);
    assert.equal(state.submitted.length, 0);
    assert.equal(state.impact, null);
    assert.equal(state.confirmed, false);
    assert.equal(state.notice, "Keep this field in the draft before reviewing changes.");
  }
});

test("pristine new field and restored equal definitions remain reviewable without normalization", async () => {
  for (const kind of ["empty", "restored"]) {
    const { state, handlers } = fixture();
    if (kind === "empty") {
      state.selected = -1;
      state.field = { ...state.emptyField, options: [] };
    } else {
      const kept = { ...state.schema.fields[0], label: " Literal label ", type: "CHOICE", options: [" Web ", "Mobile"] };
      state.schema = { version: 1, fields: [kept] };
      state.field = { ...kept, label: "Changed" };
      state.field = { ...state.field, label: kept.label, options: [...kept.options] };
    }
    const schema = state.schema, field = state.field, response = state.impact;
    const reviews = [];
    state.review.mutateAsync = async (input) => { reviews.push(input); return response; };
    await handlers.compare();
    assert.equal(reviews.length, 1);
    assert.equal(reviews[0].schema, schema);
    assert.equal(state.field, field);
    assert.equal(state.impact, response);
    assert.equal(state.notice, null);
    assert.equal(state.submitted.length, 0);
  }
});

test("explicit Keep admits review of the exact new or updated field while keeping rationale", async () => {
  for (const selected of [-1, 0]) {
    const { state, handlers } = fixture();
    state.selected = selected;
    state.field = { key: selected < 0 ? "component" : "private_key", label: " Component label ", type: "CHOICE", required: false, retired: false, options: [" Web ", "Mobile"] };
    const field = state.field, rationale = state.reason, response = state.impact;
    handlers.applyField();
    const schema = state.schema;
    assert.equal(schema.fields[selected < 0 ? 1 : 0], field);
    assert.equal(state.field, state.emptyField);
    assert.equal(state.selected, -1);
    assert.equal(state.reason, rationale);
    const reviews = [];
    state.review.mutateAsync = async (input) => { reviews.push(input); return response; };
    await handlers.compare();
    assert.equal(reviews.length, 1);
    assert.equal(reviews[0].schema, schema);
    assert.equal(state.impact, response);
    assert.equal(state.reason, rationale);
    assert.equal(state.submitted.length, 0);
  }
});

test("ordinary authorized reopening retains definitions field rationale and exact pending UUID", async () => {
  const { state, handlers } = fixture();
  const before = JSON.stringify({ schema: state.schema, field: state.field, reason: state.reason, impact: state.impact });
  await handlers.show();
  assert.equal(state.refetches, 0);
  assert.equal(JSON.stringify({ schema: state.schema, field: state.field, reason: state.reason, impact: state.impact }), before);
  const pending = { origin: original, input: { requestId: "70cdf568-ccea-4c3d-8d35-269c3bf5fe09" }, uncertain: true };
  state.pending = pending;
  await handlers.show();
  assert.equal(state.pending, pending);
  assert.equal(state.refetches, 0);
});
test("first open uses completed scoped access without starting another read", async () => {
  const { state, handlers } = fixture();
  state.baseline = null;
  state.query.refetch = () => { throw Error("Redundant read would revoke current admission"); };
  await handlers.show();
  assert.equal(state.baseline, state.fresh);
  assert.equal(state.schema, state.fresh.schema);
  assert.equal(state.refetches, 0);
  assert.equal(state.notice, null);
});
test("initial admission refuses missing fresh access wrong scope actor or role", async () => {
  for (const patch of [{ projectId: "other" }, { organizationId: "other" }, { caseId: "other" }, { canConfigure: false }]) {
    const { state, handlers } = fixture();
    state.baseline = null;
    state.fresh = { ...state.fresh, ...patch };
    await handlers.show();
    assert.equal(state.baseline, null);
  }
  for (const change of [state => { state.fresh = null; }, switchActor, state => { state.access.canConfigure = false; }]) {
    const { state, handlers } = fixture(); state.baseline = null; change(state);
    await handlers.show(); assert.equal(state.baseline, null); assert.equal(state.refetches, 0);
  }
});
test("impact comparison refuses changed project/hash and withholds late actor responses", async () => {
  for (const patch of [{ projectId: "foreign-project" }, { expectedSchemaHash: "stale-hash" }]) {
    const { state, handlers } = fixture();
    // Capture the synthetic response before compare clears the prior review.
    const response = { ...state.impact, ...patch };
    state.review.mutateAsync = async () => response;
    await handlers.compare();
    assert.equal(state.impact, null);
    assert.match(state.notice, /draft remains retained/);
  }
  const { state, handlers } = fixture(), held = deferred();
  const response = state.impact;
  state.review.mutateAsync = () => held.promise;
  const task = handlers.compare();
  switchActor(state);
  held.resolve(response);
  await task;
  assert.equal(state.impact, null);
  assert.equal(state.notice, null);
  assert.equal(state.reason, "Original human rationale");
});
test("unknown acknowledgement retains exact origin/input despite subsequent denial", async () => {
  const { state, handlers } = fixture();
  state.configure.mutateAsync = async (input) => { state.submitted.push(input); throw new Error("lost ACK"); };
  await handlers.commit();
  const retained = state.pending;
  assert.equal(retained.origin, original);
  assert.equal(retained.input, state.submitted[0]);
  assert.equal(retained.uncertain, true);
  state.configure.mutateAsync = async () => { throw { data: { code: "FORBIDDEN" } }; };
  await handlers.commit();
  assert.equal(state.pending.input, retained.input);
  assert.equal(state.pending.origin, original);
  assert.equal(state.pending.uncertain, true);
});
test("wrong ACK cannot clear receipt close dialog or invalidate current definitions", async () => {
  const { state, handlers } = fixture();
  state.configure.mutateAsync = async () => ({ requestId: "wrong", replayed: false });
  await handlers.commit();
  assert.equal(state.pending.uncertain, true);
  assert.equal(state.open, true);
  assert.equal(state.invalidations, 0);
});
test("matching late ACK settles original receipt without showing A success in B", async () => {
  const { state, handlers } = fixture(), held = deferred();
  state.configure.mutateAsync = (input) => { state.submitted.push(input); return held.promise; };
  const task = handlers.commit();
  switchActor(state);
  held.resolve({ requestId: state.submitted[0].requestId, replayed: true });
  await task;
  assert.equal(state.pending, null);
  assert.equal(state.open, true);
  assert.equal(state.notice, null);
  assert.equal(state.invalidations, 0);
  assert.equal(state.reason, "Original human rationale");
});
test("retry remains bound to original actor organization and current full administrative role", async () => {
  for (const change of [switchActor, (state) => { state.access.current = { ...original, organizationId: "other-org" }; }, (state) => { state.access.canConfigure = false; }]) {
    const { state, handlers } = fixture();
    const pending = { origin: original, input: { projectId: original.projectId, requestId: "70cdf568-ccea-4c3d-8d35-269c3bf5fe09" }, uncertain: true };
    state.pending = pending;
    change(state);
    await handlers.commit();
    assert.equal(state.pending, pending);
    assert.equal(state.submitted.length, 0);
  }
});
test("private schema controls are conditionally withheld not hidden in retained DOM", () => {
  assert.match(source, /useCaseFieldAccess\(projectId\)/);
  assert.match(source, /key=\{projectId\}/);
  assert.match(source, /if \(!access\.canConfigure\) setConfirmed\(false\)/);
  assert.match(source, /!access\.readable \|\| !access\.canConfigure \? \(/);
  assert.match(source, /\) : \(\s*<>\s*<p>\s*Typed metadata/);
  assert.match(source, /access\.readable && access\.canConfigure && notice/);
  assert.match(source, /Discard local definition draft/);
  assert.match(source, /baseline && !pending && \(/);
  assert.ok(!source.includes("display: \"none\""));
  const acknowledgement = source.match(/assertCaseFieldAcknowledgement\(result, attempt\.input\.requestId\)/);
  const consume = source.match(/setPending\(\(current\) =>\s*\(current === attempt \? null : current\)\s*\)/);
  assert.ok(acknowledgement && consume);
  assert.ok(acknowledgement.index < consume.index);
});
