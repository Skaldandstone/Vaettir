import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { createHash } from "node:crypto";
import * as helpers from "./case-prerequisite-draft.ts";
import { manualStartDefinitivelyRejected } from "./manual-run-start.ts";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const source = readFileSync(new URL("./use-case-prerequisites.ts", import.meta.url), "utf8"), ast = ts.createSourceFile("controller.ts", source, ts.ScriptTarget.Latest, true);
const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "useCasePrerequisites");
const code = ts.transpileModule(`${ts.createPrinter().printNode(ts.EmitHint.Unspecified, declaration, ast).replace(/\bexport\s+/, "")}\nthis.controller=useCasePrerequisites;`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const scope = { projectId: "synthetic-project", organizationId: "synthetic-org", actorId: "synthetic-native", actorClerkUserId: "synthetic-clerk" }, graphHash = "a".repeat(64);
const row = { id: "old", displayId: "SYN-2", title: "Exact retained pending", reviewStatus: "PENDING_REVIEW", archived: false, unavailable: false }, approved = { id: "approved", displayId: "SYN-3", title: "Exact approved", reviewStatus: "APPROVED", archived: false, unavailable: false };
function harness() {
  const hooks = [], effects = [], cleanups = new Map(), sent = [], reads = []; let cursor = 0, dirty = false, uuid = 0, editor;
  const params = { projectId: scope.projectId, caseId: "main", active: true, permitted: true };
  const auth = { isLoaded: true, isSignedIn: true, userId: scope.actorClerkUserId, sessionId: "synthetic-session-A" };
  const state = { accessError: null, pageError: null, pageFetching: false, fetching: false, paused: false, staleRead: false, nativeActor: scope.actorId, canEdit: true, onHash: null, onSend: null, failure: null, wrong: null, graphHash, total: 1, callbackFail: false, items: [approved] };
  const counts = { invalidation: 0 };
  function query(input, page) {
    reads.push({ input, page });
    const error = page ? state.pageError : state.accessError;
    const data = { projectId: input.projectId, caseId: input.caseId, readRequestId: state.staleRead ? "old-read-uuid" : input.readRequestId, readScope: { ...scope, actorId: state.nativeActor, actorClerkUserId: auth.userId }, canEdit: state.canEdit };
    if (page) {
      const offset = input.cursor?.offset ?? 0;
      Object.assign(data, { graphHash: state.graphHash, prerequisiteIds: ["old"], linked: [row], items: state.items, offset, total: state.total, populationHash: "b".repeat(64), nextCursor: offset + 20 < state.total ? { offset: offset + 20, populationHash: "b".repeat(64), graphHash: state.graphHash } : null });
    }
    return { data, isSuccess: !error, error, isFetching: state.fetching || (page && state.pageFetching), isPaused: state.paused };
  }
  const context = vm.createContext({ Error, ...helpers, manualStartDefinitivelyRejected,
    prerequisiteInputHash: async input => { state.onHash?.(); return helpers.prerequisiteInputHash(input); },
    crypto: { randomUUID: () => `6ee2ec04-4d34-40bf-b0e9-${String(++uuid).padStart(12, "0")}` },
    useAuth: () => auth,
    trpcReact: { useUtils: () => ({ testCaseStructure: { list: { invalidate: async () => { counts.invalidation++; if (state.callbackFail) throw Error("Refresh failure"); } } } }), testCaseStructure: {
      prerequisiteAccess: { useQuery: input => query(input, false) }, prerequisitePage: { useQuery: input => query(input, true) },
      reviewedSetPrerequisites: { useMutation: () => ({ mutateAsync: async input => { sent.push(input); state.onSend?.(); if (state.failure) throw state.failure; const ack = { projectId: input.projectId, caseId: input.caseId, organizationId: input.originalOrganizationId, actorId: input.expectedActorId, actorClerkUserId: input.expectedClerkActorId, requestId: input.requestId, requestHash: await helpers.prerequisiteInputHash(input), prerequisiteIds: input.prerequisiteIds, replayed: false }; if (state.wrong === "native") ack.actorId = "replacement"; if (state.wrong === "body") ack.prerequisiteIds = []; if (state.wrong === "hash") ack.requestHash = "b".repeat(64); return ack; } }) },
    } },
    useState: initial => { const at = cursor++; if (!Object.hasOwn(hooks, at)) hooks[at] = typeof initial === "function" ? initial() : initial; return [hooks[at], value => { const next = typeof value === "function" ? value(hooks[at]) : value; if (!Object.is(next, hooks[at])) { hooks[at] = next; dirty = true; } }]; },
    useRef: initial => { const at = cursor++; if (!Object.hasOwn(hooks, at)) hooks[at] = { current: initial }; return hooks[at]; },
    useLayoutEffect: (effect, deps) => { const at = cursor++, prior = hooks[at]; if (!prior || deps.some((value, index) => !Object.is(value, prior[index]))) { hooks[at] = deps; effects.push(() => { cleanups.get(at)?.(); const cleanup = effect(); if (cleanup) cleanups.set(at, cleanup); }); } },
  }); vm.runInContext(code, context);
  function render() { for (let i = 0; i < 40; i++) { cursor = 0; dirty = false; editor = context.controller(params.projectId, params.caseId, params.active, params.permitted); effects.splice(0).forEach(effect => effect()); if (!dirty) return editor; } throw Error("Prerequisite controller did not settle"); }
  render();
  function ready() { editor.show(); render(); editor.change(["old", "approved"]); return render(); }
  return { render, ready, state, params, auth, sent, reads, counts, unmount: () => cleanups.forEach(fn => fn()), get editor() { return editor; } };
}
test("exact frozen native actor/org/link-set/UUID hash is SHA256-equivalent to server body with no session authorization claim", async () => {
  const h = harness(); h.ready(); await h.editor.submit(); h.render(); assert.equal(h.sent.length, 1); const input = h.sent[0]; assert.equal(Object.isFrozen(input), true); assert.equal(Object.isFrozen(input.prerequisiteIds), true); assert.equal(input.expectedActorId, scope.actorId); assert.equal(Object.hasOwn(input, "sessionId"), false); assert.equal(await helpers.prerequisiteInputHash(input), createHash("sha256").update(JSON.stringify(input)).digest("hex")); assert.equal(h.editor.draft, null); assert.equal(h.editor.pending, null); assert.equal(h.counts.invalidation, 1);
});
// Actual component callbacks delegate to the real current hook controller.
// Hook/query/event boundaries remain synthetic; no native/browser claim.
function prerequisiteButtons(h) {
  const text = readFileSync(new URL("../components/TestCasePrerequisites.tsx", import.meta.url), "utf8"), file = ts.createSourceFile("prerequisites.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const component = file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "TestCasePrerequisites");
  assert.ok(component);
  const compiled = ts.transpileModule(`${component.getText(file).replace(/\bexport\s+/, "")}\nthis.component=TestCasePrerequisites;`, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, module: ts.ModuleKind.None } }).outputText;
  const control = h.editor, context = vm.createContext({ React, styles: {}, useCasePrerequisites: () => control });
  vm.runInContext(compiled, context);
  const tree = context.component({ projectId: h.params.projectId, caseId: h.params.caseId, canEdit: h.params.permitted, active: h.params.active });
  function descendants(node) {
    if (!React.isValidElement(node)) return [];
    return [node, ...React.Children.toArray(node.props.children).flatMap(descendants)];
  }
  const nodes = descendants(tree);
  return name => {
    const button = nodes.find(node => node.type === "button" && node.props.children === name);
    assert.ok(button, `Actual prerequisite button ${name} must exist`);
    return button.props.onClick;
  };
}

test("actual Next/Previous component callbacks consume one transition per rendered candidate page and retain the draft", () => {
  const h = harness(); h.state.total = 851; h.ready(); const draft = h.editor.draft;
  const firstNext = prerequisiteButtons(h)("Next"); firstNext(); firstNext(); h.render();
  assert.deepEqual(Array.from(h.editor.cursors, cursor => cursor.offset), [20]); assert.equal(h.editor.freshPage.offset, 20); assert.equal(h.editor.draft, draft);
  const secondNext = prerequisiteButtons(h)("Next"); secondNext(); secondNext(); h.render();
  assert.deepEqual(Array.from(h.editor.cursors, cursor => cursor.offset), [20, 40]); assert.equal(h.editor.freshPage.offset, 40);
  const previous = prerequisiteButtons(h)("Previous"); previous(); previous(); h.render();
  assert.deepEqual(Array.from(h.editor.cursors, cursor => cursor.offset), [20]); assert.equal(h.editor.freshPage.offset, 20);
  prerequisiteButtons(h)("Previous")(); h.render(); assert.equal(h.editor.cursors.length, 0); assert.equal(h.editor.freshPage.offset, 0);
  assert.equal(h.editor.draft, draft); assert.deepEqual(h.sent, []); assert.equal(h.counts.invalidation, 0);
});

test("actual pager reaches all 43 native-offset pages and returns without duplicate cursor history or draft writes", () => {
  const h = harness(); h.state.total = 851; h.ready(); const draft = h.editor.draft, offsets = [];
  for (let index = 0; index < 43; index++) {
    offsets.push(h.editor.freshPage.offset);
    if (index < 42) { const next = prerequisiteButtons(h)("Next"); next(); next(); h.render(); }
  }
  assert.deepEqual(offsets, Array.from({ length: 43 }, (_, index) => index * 20)); assert.equal(h.editor.freshPage.nextCursor, null); assert.equal(h.editor.cursors.length, 42);
  for (let index = 41; index >= 0; index--) {
    const previous = prerequisiteButtons(h)("Previous"); previous(); previous(); h.render(); assert.equal(h.editor.freshPage.offset, index * 20);
  }
  assert.equal(h.editor.cursors.length, 0); assert.equal(h.editor.draft, draft); assert.deepEqual(h.sent, []);
});

for (const transition of ["new-page", "search", "session-A-B-A"]) test(`actual saved pager callbacks after ${transition} cannot navigate a newer page or replace the original draft`, () => {
  const h = harness(); h.state.total = 851; h.ready(); prerequisiteButtons(h)("Next")(); h.render();
  const draft = h.editor.draft, buttons = prerequisiteButtons(h), staleNext = buttons("Next"), stalePrevious = buttons("Previous");
  if (transition === "new-page") { staleNext(); h.render(); }
  else if (transition === "search") { h.editor.setSearch("New exact synthetic filter"); h.render(); }
  else { h.auth.sessionId = "B"; h.render(); h.auth.sessionId = "synthetic-session-A"; h.render(); }
  const currentCursors = h.editor.cursors, offset = h.editor.freshPage.offset;
  staleNext(); stalePrevious(); h.render(); assert.equal(h.editor.cursors, currentCursors); assert.equal(h.editor.freshPage.offset, offset);
  assert.equal(h.editor.draft, draft); assert.deepEqual(h.sent, []);
});

test("same-event search reset cannot be replaced by captured Next/Previous updaters", () => {
  const h = harness(); h.state.total = 851; h.ready(); prerequisiteButtons(h)("Next")(); h.render();
  const draft = h.editor.draft, buttons = prerequisiteButtons(h), next = buttons("Next"), previous = buttons("Previous");
  h.editor.setSearch("Original narrowed synthetic search"); next(); previous(); h.render();
  assert.equal(h.editor.search, "Original narrowed synthetic search"); assert.equal(h.editor.cursors.length, 0); assert.equal(h.editor.freshPage.offset, 0);
  assert.equal(h.editor.draft, draft); assert.deepEqual(h.sent, []);
});

test("same-tick double submit and hash-preparation edit cannot allocate or alter another request", async () => {
  const h = harness(); h.ready(); h.state.onHash = () => h.editor.change([]); await Promise.all([h.editor.submit(), h.editor.submit()]); assert.equal(h.sent.length, 1); assert.equal(JSON.stringify(h.sent[0].prerequisiteIds), '["old","approved"]');
});
test("new additions must be on the current approved page, old retained links can be removed and removal undone without autoapproval", () => {
  const h = harness(); h.editor.show(); h.render(); h.editor.change(["old", "unreviewed"]); assert.equal(h.render().draft, null); h.editor.change([]); h.render(); assert.equal(JSON.stringify(h.editor.draft.ids), "[]"); h.editor.change(["old"]); h.render(); assert.equal(JSON.stringify(h.editor.draft.ids), '["old"]');
});
test("same-event stale Add/Remove/Undo closures cannot replace a newer local complete selection", async () => {
  const h = harness(); h.editor.show(); h.render();
  const first = h.editor; first.change(["old", "approved"]); first.change([]); first.change(["old"]); first.discard(); await first.submit();
  assert.equal(JSON.stringify(h.render().draft.ids), '["old","approved"]'); assert.equal(h.sent.length, 0);
  const remove = h.editor; remove.change(["approved"]); remove.change(["old", "approved"]); assert.equal(JSON.stringify(h.render().draft.ids), '["approved"]');
  h.editor.change(["approved", "old"]); h.render(); assert.equal(JSON.stringify(h.editor.draft.ids), '["approved","old"]');
});
test("visiting and editing many candidate pages retains metadata only for baseline/selected IDs, not unrelated page rows", () => {
  const h = harness(); h.ready();
  for (let page = 0; page < 43; page++) {
    h.state.items = Array.from({ length: 20 }, (_, index) => ({ ...approved, id: `candidate-${page}-${index}`, displayId: `SYN-${page * 20 + index + 10}` }));
    h.editor.setSearch(`Synthetic page ${page}`); h.render(); h.editor.change(["old", "approved", `candidate-${page}-0`]); h.render();
    assert.equal(h.editor.draft.linked.length, 3); assert.equal(JSON.stringify(h.editor.draft.ids), JSON.stringify(["old", "approved", `candidate-${page}-0`]));
    assert.equal(h.editor.draft.linked.some(item => item.id === `candidate-${page}-1`), false);
  }
  h.editor.change(["approved", "candidate-42-0"]); h.render(); assert.ok(h.editor.draft.linked.some(item => item.id === "old")); assert.equal(h.editor.draft.linked.length, 3);
});
test("current 50-ID draft refuses a 51st Undo target without losing IDs, then allows explicit Undo below the cap", () => {
  const h = harness(); h.editor.show(); h.render(); h.editor.change([]); h.render();
  for (let page = 0; page < 3; page++) {
    h.state.items = Array.from({ length: page === 2 ? 10 : 20 }, (_, index) => ({ ...approved, id: `cap-${page}-${index}` }));
    h.editor.setSearch(`Synthetic cap page ${page}`); h.render(); h.editor.change([...h.editor.draft.ids, ...h.state.items.map(item => item.id)]); h.render();
  }
  const captured = h.editor.draft; assert.equal(captured.ids.length, 50); h.editor.change([...captured.ids, "old"]); h.render(); assert.equal(h.editor.draft, captured); assert.equal(h.sent.length, 0);
  h.editor.change(captured.ids.slice(0, 49)); h.render(); h.editor.change([...h.editor.draft.ids, "old"]); h.render(); assert.equal(h.editor.draft.ids.length, 50); assert.equal(h.editor.draft.ids.at(-1), "old");
});
test("closing while real controller save is pending refuses reopen until the same in-flight request settles", async () => {
  const h = harness(); h.ready();
  h.state.onSend = () => { h.editor.close(); h.render(); assert.equal(h.editor.open, false); assert.equal(h.editor.busy, true); h.editor.show(); h.render(); assert.equal(h.editor.open, false); };
  // The synthetic mutation yields while its hash is computed. This assertion
  // exercises the actual existing busy guard, not a production timing claim.
  await h.editor.submit(); h.render(); assert.equal(h.sent.length, 1); assert.equal(h.editor.busy, false); h.editor.show(); h.render(); assert.equal(h.editor.open, true);
});
test("stale page Add closure refuses after search/page nonce changes, but current page retains the newer selection", () => {
  const h = harness(); h.ready(); const old = h.editor, draft = old.draft; h.editor.setSearch("Synthetic different page"); h.render(); old.change([]); assert.equal(h.render().draft, draft); h.editor.change(["old"]); h.render(); assert.equal(JSON.stringify(h.editor.draft.ids), '["old"]');
});
test("fresh native access can narrow refused/oversized candidate pages and repair filters without requiring admitted page data", () => {
  const h = harness(); h.ready(); const old = h.editor, draft = old.draft; h.state.pageError = Error("Candidate metadata exceeds admitted native bounds"); h.render();
  assert.equal(h.editor.readable, true); assert.equal(h.editor.freshPage, null); h.editor.setSearch("Narrow synthetic scope"); h.render(); assert.equal(h.editor.search, "Narrow synthetic scope"); assert.equal(h.editor.draft, draft);
  h.editor.setSort("title"); h.render(); assert.equal(h.editor.sort, "title"); old.setSearch("Stale identity filter"); old.setSort("inventory"); assert.equal(h.render().search, "Narrow synthetic scope"); assert.equal(h.editor.sort, "title");
  h.editor.setSearch("x".repeat(201)); h.render(); assert.equal(h.editor.search, "Narrow synthetic scope"); assert.match(h.editor.notice, /200 characters/); h.editor.setSearch("Shorter"); h.render(); assert.equal(h.editor.search, "Shorter");
  const denied = h.editor; h.state.canEdit = false; h.state.accessError = Error("Current native reader denied"); h.render(); denied.setSearch("Must not rebind"); h.editor.setSearch("Must not expose"); assert.equal(h.render().search, "Shorter"); assert.equal(h.editor.draft, draft);
});
test("fresh read UUID guards hide cache during reopen, fetch/error/paused states, and current native remapping", () => {
  for (const update of [{ staleRead: true }, { fetching: true }, { paused: true }, { accessError: Error("Current read refused") }, { nativeActor: "replacement" }]) { const h = harness(); h.ready(); const draft = h.editor.draft; Object.assign(h.state, update); h.render(); assert.equal(h.editor.readable, false); assert.equal(h.editor.freshPage, null); assert.equal(h.editor.draft, draft); h.editor.discard(); assert.equal(h.editor.draft, draft); }
  const h = harness(); h.ready(); h.editor.close(); h.render(); const oldRead = h.reads.at(-1).input.readRequestId; h.state.staleRead = true; h.editor.show(); h.render(); assert.equal(h.editor.readable, false); assert.notEqual(h.reads.at(-1).input.readRequestId, oldRead);
});
test("lost auth/session or native scope cannot expose or transfer a retained draft; original session return requires a new read UUID", () => {
  const h = harness(); h.ready(); const draft = h.editor.draft, originalRead = h.reads.at(-1).input.readRequestId;
  h.auth.isSignedIn = false; h.render(); assert.equal(h.editor.readable, false); h.auth.isSignedIn = true; h.auth.sessionId = "renewed-session"; h.render(); assert.equal(h.editor.readable, false); assert.equal(h.editor.draft, draft);
  h.auth.sessionId = "synthetic-session-A"; h.render(); assert.equal(h.editor.readable, true); assert.notEqual(h.reads.at(-1).input.readRequestId, originalRead); assert.equal(h.editor.draft, draft);
});
test("scope/actor/session A-B-A revokes stale change/discard/submit handlers", async () => {
  const h = harness(); h.ready(); const old = h.editor, draft = old.draft; h.auth.sessionId = "B"; h.render(); h.auth.sessionId = "synthetic-session-A"; h.render(); old.change([]); old.discard(); await old.submit(); assert.equal(h.sent.length, 0); assert.equal(h.render().draft, draft);
});
test("loss during async hashing sends nothing and retains complete original draft", async () => {
  const h = harness(); h.ready(); const draft = h.editor.draft; h.state.onHash = () => { h.params.active = false; h.render(); }; await h.editor.submit(); assert.equal(h.sent.length, 0); assert.equal(h.render().draft, draft);
});
for (const loss of ["close", "unmount", "session-A-B-A", "actor-loss", "case-reuse", "active-A-B-A"]) test(`exact late ACK after ${loss} privately settles only original receipt, not draft/notice/cache`, async () => {
  const h = harness(); h.ready(); const draft = h.editor.draft, notice = h.editor.notice;
  h.state.onSend = () => { if (loss === "close") { h.editor.close(); h.render(); } else if (loss === "unmount") h.unmount(); else if (loss === "session-A-B-A") { h.auth.sessionId = "B"; h.render(); h.auth.sessionId = "synthetic-session-A"; h.render(); } else if (loss === "actor-loss") { h.auth.userId = "other"; h.render(); } else if (loss === "active-A-B-A") { h.params.active = false; h.render(); h.params.active = true; h.render(); } else { h.params.caseId = "other"; h.render(); } };
  await h.editor.submit(); h.render(); assert.equal(h.editor.pending, null); assert.equal(h.editor.draft, draft); assert.equal(h.editor.settled, draft.identity); assert.equal(h.editor.notice, notice); assert.equal(h.counts.invalidation, 0); await h.editor.submit(); assert.equal(h.sent.length, 1);
});
for (const loss of ["readOnly", "native-error", "fetch", "pause", "page-fetch"]) test(`lost/returned ${loss} within one unchanged session revokes late ACK effects`, async () => {
  const h = harness(); h.ready(); const old = h.editor, draft = old.draft;
  h.state.onSend = () => {
    if (loss === "readOnly") { h.state.canEdit = false; h.render(); h.state.canEdit = true; }
    else if (loss === "native-error") { h.state.accessError = Error("Denied current read"); h.render(); h.state.accessError = null; }
    else if (loss === "fetch") { h.state.fetching = true; h.render(); h.state.fetching = false; }
    else if (loss === "pause") { h.state.paused = true; h.render(); h.state.paused = false; }
    else { h.state.pageFetching = true; h.render(); h.state.pageFetching = false; }
    h.render();
  };
  await old.submit(); h.render(); assert.equal(h.editor.pending, null); assert.equal(h.editor.draft, draft); assert.equal(h.editor.settled, draft.identity); assert.equal(h.counts.invalidation, 0); assert.equal(h.editor.notice, ""); await old.submit(); assert.equal(h.sent.length, 1);
});
test("lost/returned current read authority preserves UNKNOWN and permits only a valid rerender's identical retry", async () => {
  const h = harness(); h.ready(); h.state.failure = Error("Lost ACK"); await h.editor.submit(); h.render(); const old = h.editor, held = old.pending;
  h.state.canEdit = false; h.render(); h.state.canEdit = true; h.render(); h.state.failure = null; await old.submit(); assert.equal(h.sent.length, 1); assert.equal(h.editor.pending.input, held.input);
  await h.editor.submit(); h.render(); assert.equal(h.sent.length, 2); assert.equal(h.sent[1], h.sent[0]); assert.equal(h.editor.pending, null); assert.equal(h.counts.invalidation, 1);
});
test("UNKNOWN exact request survives close and later graph-page admission refusal; independent fresh native access permits identical retry", async () => {
  const h = harness(); h.ready(); h.state.failure = Error("Lost ACK"); await h.editor.submit(); h.render(); const held = h.editor.pending;
  h.editor.close(); h.render(); h.state.pageError = Error("Graph later exceeds native bounds"); h.editor.show(); h.render(); assert.equal(h.editor.freshPage, null); assert.equal(h.editor.readable, true); h.state.failure = { data: { code: "CONFLICT" } }; await h.editor.submit(); h.render(); assert.equal(h.editor.pending.input, held.input); h.state.failure = null; await h.editor.submit(); h.render(); assert.equal(h.sent[1], h.sent[0]); assert.equal(h.sent[2], h.sent[0]); assert.equal(h.editor.pending, null); assert.equal(h.counts.invalidation, 1);
});
test("first proven refusal unlocks unsent edits, mismatched ACK native/hash/body retains unknown receipt", async () => {
  const h = harness(); h.ready(); h.state.failure = { data: { code: "BAD_REQUEST" } }; await h.editor.submit(); h.render(); assert.equal(h.editor.pending, null); assert.ok(h.editor.draft);
  for (const wrong of ["native", "hash", "body"]) { const m = harness(); m.ready(); m.state.wrong = wrong; await m.editor.submit(); m.render(); assert.equal(m.editor.pending.everAmbiguous, true); assert.equal(m.counts.invalidation, 0); }
});
test("complete saved graph baseline change cannot reset draft or approve a new UUID", async () => {
  const h = harness(); h.ready(); const draft = h.editor.draft; h.state.graphHash = "b".repeat(64); h.render(); h.editor.change([]); await h.editor.submit(); h.render(); assert.equal(h.editor.draft, draft); assert.equal(h.sent.length, 0); h.editor.discard(); h.render(); assert.equal(h.editor.draft, null);
});
test("read-only current seat blocks additions/removals/new save and stale handlers even when parent canEdit is true", async () => {
  const h = harness(); h.ready(); const draft = h.editor.draft; h.state.canEdit = false; h.render(); h.editor.change([]); h.editor.discard(); await h.editor.submit(); assert.equal(h.render().draft, draft); assert.equal(h.sent.length, 0);
});
test("known ACK then failed cache invalidation never reopens the original write", async () => {
  const h = harness(); h.ready(); h.state.callbackFail = true; await h.editor.submit(); h.render(); await h.editor.submit(); assert.equal(h.sent.length, 1); assert.equal(h.editor.pending, null); assert.equal(h.editor.draft, null);
});
test("actual component renders retained unreviewed/unavailable IDs, searchable stable chips, explicit removal undo and exact-receipt controls", () => {
  const text = readFileSync(new URL("../components/TestCasePrerequisites.tsx", import.meta.url), "utf8"), parsed = ts.createSourceFile("component.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), component = parsed.statements.find(node => ts.isFunctionDeclaration(node));
  const compiled = ts.transpileModule(`${ts.createPrinter().printNode(ts.EmitHint.Unspecified, component, parsed).replace(/\bexport\s+/, "")}\nthis.component=TestCasePrerequisites;`, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, module: ts.ModuleKind.None } }).outputText;
  const control = { readable: true, freshAccess: { canEdit: true }, freshPage: { graphHash, prerequisiteIds: ["old", "missing"], linked: [row, { id: "missing", unavailable: true }], items: [approved], total: 851, offset: 0, nextCursor: {} }, origin: {}, open: true, draft: null, pending: null, settled: null, busy: false, notice: "", search: "", sort: "case-id", cursors: [], access: {}, page: {} };
  const context = vm.createContext({ React, styles: {}, useCasePrerequisites: () => control }); vm.runInContext(compiled, context); const html = renderToStaticMarkup(React.createElement(context.component, { projectId: scope.projectId, caseId: "main", canEdit: true }));
  assert.match(html, /Retained pending review/); assert.match(html, /Unavailable retained case/); assert.match(html, /SYN-2/); assert.match(html, /SYN-3/); assert.match(html, /Search title or case ID/); assert.match(html, /maxLength="200"|maxlength="200"/); assert.match(html, /Page 1 of 43/); assert.match(html, /Review and save prerequisites/); assert.match(html, /Close and keep draft/); assert.doesNotMatch(html, /type="password"/);
  control.draft = { identity: "synthetic-draft", origin: {}, baseline: ["old", "missing"], ids: ["old", "missing"], graphHash, linked: [{ ...row, title: "Stale retained title", reviewStatus: "REJECTED" }, { id: "missing", unavailable: true }] };
  control.freshPage.linked[0] = { ...row, title: "Fresh admitted title", reviewStatus: "APPROVED", archived: true };
  const current = renderToStaticMarkup(React.createElement(context.component, { projectId: scope.projectId, caseId: "main", canEdit: true })); assert.match(current, /Fresh admitted title/); assert.match(current, /Archived retained case/); assert.match(current, /Unavailable retained case/); assert.doesNotMatch(current, /Stale retained title|Retained rejected/);
  control.freshAccess.canEdit = false;
  const viewer = renderToStaticMarkup(React.createElement(context.component, { projectId: scope.projectId, caseId: "main", canEdit: true })); assert.match(viewer, /<button[^>]*disabled=""[^>]*>Discard retained draft<\/button>/); assert.doesNotMatch(viewer, /aria-label="Remove /); assert.match(viewer, /Fresh admitted title/);
  assert.match(viewer, /<button[^>]*aria-label="Add prerequisite SYN-3 Exact approved"[^>]*disabled=""[^>]*>Add<\/button>/);
  control.draft.ids = ["missing"];
  const undoViewer = renderToStaticMarkup(React.createElement(context.component, { projectId: scope.projectId, caseId: "main", canEdit: true })); assert.match(undoViewer, /<button[^>]*disabled=""[^>]*>Undo removal<\/button>/); assert.match(undoViewer, /Removed in this unsaved draft/);
  control.freshAccess.canEdit = true; control.draft.ids = Array.from({ length: 50 }, (_, index) => `selected-${index}`);
  const capped = renderToStaticMarkup(React.createElement(context.component, { projectId: scope.projectId, caseId: "main", canEdit: true })); assert.match(capped, /Maximum 50 direct prerequisites/); assert.match(capped, /<button[^>]*disabled=""[^>]*>Undo removal<\/button>/);
  control.open = false; control.busy = true;
  const busyClosed = renderToStaticMarkup(React.createElement(context.component, { projectId: scope.projectId, caseId: "main", canEdit: true })); assert.match(busyClosed, /<button[^>]*disabled=""[^>]*>Edit prerequisites<\/button>/);
  control.busy = false;
  const idleClosed = renderToStaticMarkup(React.createElement(context.component, { projectId: scope.projectId, caseId: "main", canEdit: true })); assert.match(idleClosed, /<button[^>]*>Edit prerequisites<\/button>/); assert.doesNotMatch(idleClosed, /<button[^>]*disabled=""[^>]*>Edit prerequisites<\/button>/);
  control.readable = false; const hidden = renderToStaticMarkup(React.createElement(context.component, { projectId: scope.projectId, caseId: "main", canEdit: true })); assert.doesNotMatch(hidden, /Exact retained pending|SYN-2|SYN-3|missing/);
});

test("actual picker explains an all-chosen current page without changing native totals, IDs, paging or privacy", () => {
  // Actual component with a synthetic controller boundary. This is rendered
  // structure/retention evidence, not server paging or authenticated acceptance.
  const text = readFileSync(new URL("../components/TestCasePrerequisites.tsx", import.meta.url), "utf8"), parsed = ts.createSourceFile("component.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), component = parsed.statements.find(node => ts.isFunctionDeclaration(node));
  const compiled = ts.transpileModule(`${ts.createPrinter().printNode(ts.EmitHint.Unspecified, component, parsed).replace(/\bexport\s+/, "")}\nthis.component=TestCasePrerequisites;`, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, module: ts.ModuleKind.None } }).outputText;
  const candidates = Array.from({ length: 20 }, (_, index) => ({ ...approved, id: `page-case-${index}`, displayId: `SYN-${index + 10}`, title: "Repeated title" }));
  const draft = { identity: "synthetic-all-page-draft", origin: {}, baseline: [row.id], ids: [row.id, ...candidates.map(item => item.id)], graphHash, linked: [row, ...candidates] };
  const control = { readable: true, freshAccess: { canEdit: true }, freshPage: { graphHash, prerequisiteIds: [row.id], linked: [row], items: candidates, total: 851, offset: 0, nextCursor: { offset: 20 } }, origin: {}, open: true, draft, pending: null, settled: null, busy: false, notice: "", search: "", sort: "case-id", cursors: [], access: {}, page: {} };
  const context = vm.createContext({ React, styles: {}, useCasePrerequisites: () => control }); vm.runInContext(compiled, context);
  const render = () => renderToStaticMarkup(React.createElement(context.component, { projectId: scope.projectId, caseId: "main", canEdit: true }));
  const allChosen = render();
  assert.match(allChosen, /All 20 matching cases on this page are already selected in your draft above/);
  assert.match(allChosen, /Other pages may contain additional cases/);
  assert.match(allChosen, /<ul aria-label="Available prerequisite cases"><\/ul>/);
  assert.match(allChosen, /Page 1 of 43 · 851 approved candidates/);
  assert.match(allChosen, /<button[^>]*>Next<\/button>/);
  for (const candidate of candidates) assert.ok(allChosen.includes(`>${candidate.displayId}</code>`));
  assert.doesNotMatch(allChosen, /aria-label="Add prerequisite|No matching approved candidates/);
  assert.equal(control.draft, draft);
  assert.deepEqual(control.draft.ids, [row.id, ...candidates.map(item => item.id)]);

  control.search = candidates[0].displayId;
  control.freshPage = { ...control.freshPage, items: [candidates[0]], total: 1, nextCursor: null };
  const selectedIdSearch = render();
  assert.match(selectedIdSearch, /The matching case on this page is already selected in your draft above/);
  assert.match(selectedIdSearch, /value="SYN-10"/);
  assert.match(selectedIdSearch, /Page 1 of 1 · 1 approved candidates/);
  assert.doesNotMatch(selectedIdSearch, /Other pages may contain additional cases|>Next<\/button>|No matching approved candidates/);

  control.freshPage = { ...control.freshPage, items: [], total: 0 };
  const genuinelyEmpty = render();
  assert.match(genuinelyEmpty, /No matching approved candidates/);
  assert.doesNotMatch(genuinelyEmpty, /already selected in your draft above/);
  assert.ok(genuinelyEmpty.includes(">SYN-10</code>"));

  control.freshPage = { ...control.freshPage, items: [candidates[0], { ...approved, id: "another-page-case", displayId: "SYN-900" }], total: 2 };
  const mixed = render();
  assert.match(mixed, /aria-label="Add prerequisite SYN-900 Exact approved"/);
  assert.doesNotMatch(mixed, /aria-label="Add prerequisite SYN-10 |already selected in your draft above/);
  assert.match(mixed, /Page 1 of 1 · 2 approved candidates/);

  control.freshAccess.canEdit = false;
  const readOnly = render();
  assert.match(readOnly, /<button[^>]*aria-label="Add prerequisite SYN-900 Exact approved"[^>]*disabled=""[^>]*>Add<\/button>/);
  assert.doesNotMatch(readOnly, /aria-label="Remove /);
  assert.ok(readOnly.includes(">SYN-10</code>"));
  const mixedPage = control.freshPage;
  control.freshPage = { ...mixedPage, items: candidates, total: 851, nextCursor: { offset: 20 } };
  const readOnlyChosen = render();
  assert.match(readOnlyChosen, /All 20 matching cases on this page are already selected in your draft above/);
  assert.doesNotMatch(readOnlyChosen, /aria-label="Remove |aria-label="Add prerequisite/);
  assert.equal(control.draft, draft);
  control.freshPage = mixedPage;

  control.freshAccess.canEdit = true;
  const retainedRequest = { draft, input: { requestId: "synthetic-retained-unknown-uuid" }, requestHash: "c".repeat(64), everAmbiguous: true };
  control.pending = retainedRequest;
  const unknown = render();
  assert.match(unknown, /Retry same prerequisite request/);
  assert.match(unknown, /synthetic-retained-unknown-uuid/);
  assert.match(unknown, /<button[^>]*aria-label="Add prerequisite SYN-900 Exact approved"[^>]*disabled=""[^>]*>Add<\/button>/);
  assert.match(unknown, /<input[^>]*type="search"[^>]*disabled=""/);
  assert.equal(control.pending, retainedRequest);
  assert.equal(control.pending.draft, draft);
  control.freshPage = { ...mixedPage, items: candidates, total: 851, nextCursor: { offset: 20 } };
  const unknownChosen = render();
  assert.match(unknownChosen, /All 20 matching cases on this page are already selected in your draft above/);
  assert.match(unknownChosen, /Retry same prerequisite request/);
  assert.match(unknownChosen, /Page 1 of 43 · 851 approved candidates/);
  assert.match(unknownChosen, /<button[^>]*disabled=""[^>]*>Next<\/button>/);
  assert.equal(control.pending, retainedRequest);

  control.readable = false;
  const privateView = render();
  assert.doesNotMatch(privateView, /SYN-10|SYN-900|Repeated title|synthetic-retained-unknown-uuid|already selected in your draft above|851 approved candidates/);
  assert.equal(control.pending, retainedRequest);
  assert.equal(control.draft, draft);
});
