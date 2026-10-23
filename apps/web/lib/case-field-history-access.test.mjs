// Authored source/isolated-handler regressions only; NOT RUN in authoring lane.
// Actual StrictMode/tRPC/Clerk/cache/render acceptance remains root-owned.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import {
  assertCaseFieldAcknowledgement,
  retainedCaseFieldReceipt,
} from "./case-field-origin.ts";
const source = readFileSync(new URL("../components/CaseFieldHistory.tsx", import.meta.url), "utf8").replaceAll("\r\n", "\n");

test("history privacy uses original fresh access but read admission never depends on its own fetching", () => {
  assert.match(source, /const access = useCaseFieldAccess\(projectId, caseId\)/);
  assert.match(source, /enabled: expanded && access\.authReady/);
  assert.match(source, /access\.readable &&\s*!query\.error &&\s*!query\.isFetching &&\s*!query\.isPaused/);
  assert.match(source, /sameCaseFieldOrigin\(pending\.origin, access\.current\)/);
  assert.match(source, /access\.readable && notice && !open/);
  assert.match(source, /readEnabled=\{open && access\.authReady\}/);
  assert.doesNotMatch(source, /enabled:\s*(?:fresh|access\.readable|readable)/);
});

test("comparison and human reason remain mounted while private rows and definitions disappear", () => {
  assert.match(source, /keepMounted=\{!!selection \|\| !!pending\}/);
  assert.match(source, /key=\{selection\.auditId\}/);
  assert.doesNotMatch(source, /key=\{`\$\{selection\.auditId\}:\$\{open\}`\}/);
  assert.match(source, /if \(!readable\)\s*return\s*\(\s*<p role="status">/);
  assert.match(source, /\{baseline && fresh && \(/);
  assert.match(source, /if \(!fresh \|\| !canEdit\) setConfirmed\(false\)/);
  assert.match(source, /const ready =\s*!!baseline &&\s*!!fresh &&\s*!changed &&\s*canEdit &&\s*fresh\.canRestore &&\s*!busy/);
  assert.match(source, /disabled=\{restore\.isPending \|\| !access\.canEdit\}/);
  // Access loss is not a reason/selection/pending reset effect.
  assert.doesNotMatch(source, /if \(!fresh \|\| !canEdit\)\s*\{[^}]*setReason/);
});

function harness({ owns = true, editable = true, failure, wrongAck = false, lateActor = false } = {}) {
  const start = source.indexOf("  async function commit(");
  const body = source.indexOf("{", start);
  const end = source.indexOf("\n  return (", body);
  assert.ok(start >= 0 && body > start && end > body);
  const calls = [], origin = { projectId: "p", organizationId: "org-a", clerkActorId: "actor-a" };
  const input = { projectId: "p", caseId: "c", requestId: "immutable-request", reason: "Human original reason" };
  const attempt = { input, origin, uncertain: true };
  const state = { pending: attempt, open: true, selection: { auditId: "audit-a", side: "AFTER" }, cursor: "page-a" };
  let currentOwns = owns;
  const namespace = { history: { invalidate: async () => { calls.push("history-read"); } }, get: { invalidate: async () => { calls.push("metadata-read"); } } };
  const context = {
    pending: attempt, projectId: "p", caseId: "c", Promise,
    access: { origin, canEdit: editable, owns: (_original, mode) => currentOwns && (mode !== "edit" || editable) },
    restore: { isPending: false, mutateAsync: async actual => {
      calls.push(actual); if (lateActor) currentOwns = false;
      if (failure) throw failure;
      return { requestId: wrongAck ? "foreign-request" : input.requestId, replayed: true };
    } },
    utils: { caseFields: namespace, testCases: { byId: { invalidate: async () => { calls.push("case-read"); } } } },
    assertCaseFieldAcknowledgement, retainedCaseFieldReceipt,
    setPending: value => { state.pending = value; },
    setNotice: value => { state.notice = value; },
    setOpen: value => { state.open = value; },
    setSelection: value => { state.selection = value; },
    setCursor: value => { state.cursor = value; },
  };
  const commit = runInNewContext(`(async function commit(input) ${source.slice(body, end).trim()})`, context, { timeout: 1000 });
  return { commit, input, attempt, calls, state };
}

test("retained retries cannot run under wrong actor, unavailable access or demoted role", async () => {
  for (const options of [{ owns: false }, { editable: false }]) {
    const h = harness(options); await h.commit(h.input);
    assert.deepEqual(h.calls, []); assert.equal(h.state.pending, h.attempt);
    assert.equal(h.state.open, true);
  }
});

test("wrong acknowledgement retains the exact origin UUID and body instead of clearing it", async () => {
  const h = harness({ wrongAck: true }); await h.commit(h.input);
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0], h.input);
  assert.equal(h.state.pending.input, h.input); assert.equal(h.state.pending.origin, h.attempt.origin);
  assert.equal(h.state.pending.uncertain, true); assert.equal(h.state.open, true);
});

test("late accepted original ACK clears only its receipt without closing or refetching into B", async () => {
  const h = harness({ lateActor: true }); await h.commit(h.input);
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0], h.input);
  assert.equal(h.state.pending, null); assert.equal(h.state.open, true);
  assert.deepEqual(h.state.selection, { auditId: "audit-a", side: "AFTER" });
  assert.equal(h.state.cursor, "page-a"); assert.match(h.state.notice, /Confirmed the previous/);
});

test("a later typed refusal cannot discard an earlier uncertain original request", async () => {
  const h = harness({ failure: { data: { code: "FORBIDDEN" } } }); await h.commit(h.input);
  assert.equal(h.calls.length, 1); assert.equal(h.state.pending.input, h.input);
  assert.equal(h.state.pending.origin, h.attempt.origin); assert.equal(h.state.pending.uncertain, true);
  assert.equal(h.state.open, true);
});
