// Actual CaseRow intent handler and JSX boundaries. Synthetic only, not native
// authorization, transactional, browser or production acceptance.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const source = readFileSync(new URL("../app/projects/[projectId]/test-runs/manual/[testRunId]/page.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("manual-page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const row = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "CaseRow");
const handler = row?.body.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "reviewOutcome");
assert.ok(handler, "actual row intent handler remains present");
const code = ts.transpileModule(ts.createPrinter().printNode(ts.EmitHint.Unspecified, handler, ast), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
function harness() {
  const h = {
    rowFrame: { current: { readable: true, disabled: false, hidden: false, stepMode: false, wholeCasePending: false } },
    parentCurrent: () => true,
    testCase: { currentResult: null }, blockedBy: [],
    readScope: { expectedClerkActorId: "original-clerk" },
    window: { Clerk: { loaded: true, session: { id: "original-session", user: { id: "original-clerk" } } } },
    // Transport boundary is synthetic; the actual row guard reads this value.
    currentSessionScope: session => session ? { sessionId: session.id, userId: session.user.id } : null,
    crypto: { randomUUID: () => "synthetic-review-seed" },
    expanded: [], intents: [],
  };
  h.setExpanded = value => h.expanded.push(value);
  h.setReviewIntent = value => h.intents.push(value);
  vm.createContext(h); vm.runInContext(code, h); return h;
}
test("each quick outcome only seeds one reviewed editor, never records or converts observations", () => {
  for (const status of ["PASS", "FAIL", "BLOCKED", "SKIP"]) {
    const h = harness(); h.reviewOutcome(status);
    assert.deepEqual(h.expanded, [true]);
    assert.equal(h.intents.length, 1);
    assert.equal(h.intents[0].seedId, "synthetic-review-seed");
    assert.equal(h.intents[0].status, status); assert.equal(h.intents[0].note, null);
    assert.equal(Object.hasOwn(h.intents[0], "context"), false);
    assert.equal(Object.hasOwn(h.intents[0], "readings"), false);
  }
  assert.doesNotMatch(source, /manualExecution\.recordResult|recordMutation|handleRecord|Number\(m\./);
  assert.equal((source.match(/<ManualCaseResultHistory\b/g) ?? []).length, 1);
  assert.match(source, /reviewIntent=\{reviewIntent\}/);
  assert.match(source, /This\s+does not save a result/);
});
test("stale hidden/read-only/mode/uncertain rows and existing observations cannot seed new work", () => {
  for (const [field, value] of [["readable", false], ["disabled", true], ["hidden", true], ["stepMode", true], ["wholeCasePending", true]]) {
    const h = harness(); h.rowFrame.current[field] = value; h.reviewOutcome("BLOCKED");
    assert.equal(h.expanded.length, 0); assert.equal(h.intents.length, 0);
  }
  const h = harness(); h.testCase.currentResult = { status: "PASS" }; h.reviewOutcome("FAIL");
  assert.equal(h.intents.length, 0);
});
test("actual SDK account mismatch or unavailable session refuses even before auth hooks update", () => {
  for (const session of [null, { id: "other-session", user: { id: "other-clerk" } }]) {
    const h = harness(); h.window.Clerk.session = session; h.reviewOutcome("PASS");
    assert.equal(h.intents.length, 0);
  }
  const h = harness(); h.window.Clerk.loaded = false; h.reviewOutcome("SKIP");
  assert.equal(h.intents.length, 0);
});

test("exact parent snapshot/frame revocation refuses even while legacy row booleans and SDK actor still match", () => {
  const h = harness(); h.parentCurrent = () => false; h.reviewOutcome("PASS");
  assert.equal(h.expanded.length, 0); assert.equal(h.intents.length, 0);
});
test("blocked prerequisites allow only Blocked or Skip review intent", () => {
  for (const status of ["PASS", "FAIL", "BLOCKED", "SKIP"]) {
    const h = harness(); h.blockedBy = ["PRE-0001"]; h.reviewOutcome(status);
    assert.equal(h.intents.length, status === "BLOCKED" || status === "SKIP" ? 1 : 0);
  }
});
test("closed status blocks new quick intents while native case/step review controls preserve receipt recovery; hidden rows retain editors", () => {
  assert.match(source, /runClosed=\{data.status !== "RUNNING"\}/);
  assert.match(source, /rowFrame.current = \{ readable, disabled: disabled \|\| runClosed/);
  assert.match(source, /disabled=\{disabled \|\| wholeCasePending\}/);
  assert.doesNotMatch(source, /disabled=\{disabled \|\| runClosed \|\| wholeCasePending\}/, "Native canRecord blocks new closed-run edits without blocking original exact-receipt recovery");
  const mount = source.slice(source.indexOf("<ManualCaseResultHistory"), source.indexOf("</div>", source.indexOf("<ManualCaseResultHistory")));
  assert.match(mount, /active=\{readable && expanded && !hidden && !stepMode\}/);
  assert.match(mount, /disabled=\{disabled\}/);
  assert.doesNotMatch(mount, /disabled=\{[^}]*runClosed/);
  assert.match(source, /!canEdit \|\| completeMutation.isPending/);
  assert.match(source, /unconfirmedWholeCases.size > 0 \|\|/);
});
