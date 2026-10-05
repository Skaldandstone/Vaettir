import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { assertCaseFieldAcknowledgement, retainedCaseFieldReceipt } from "./case-field-origin.ts";
const source = readFileSync(new URL("../components/CaseCustomFields.tsx", import.meta.url), "utf8").replaceAll("\r\n", "\n");

test("retained field bodies require fresh original access and current editing role", () => {
  assert.match(source, /const access = useCaseFieldAccess\(projectId, caseId, active\)/);
  assert.match(source, /\{baseline && access\.readable && \(/);
  assert.match(source, /disabled=\{!fresh \|\| changed \|\| !fresh\.canEdit\}/);
  assert.match(source, /\{!pending && access\.readable && \(/);
  assert.match(source, /if \(!access\.canEdit\) setConfirmed\(false\)/);
  assert.match(source, /key=\{`\$\{caseId\}:\$\{revision\}`\}/);
  assert.match(source, /keepMounted/);
  assert.match(source, /!sameCaseFieldOrigin\(pending\.origin, access\.current\)/);
  const render = source.slice(source.indexOf("\n  return (", source.indexOf("async function commit()")));
  assert.doesNotMatch(render, /access\.owns\(/, "Rendering must use current state, not the previous committed access ref");
  assert.doesNotMatch(source, /key=\{`\$\{caseId\}:\$\{open\}`\}/);
});

function harness({ allowed = true, editable = true, wrongAck = false, lateActor = false, failure } = {}) {
  const start = source.indexOf("  async function commit()");
  const body = source.indexOf("{", start), end = source.indexOf("\n  return (", body);
  assert.ok(start >= 0 && end > body);
  const input = { projectId:"p", caseId:"c", requestId:"original-request", values:{ note:"Private human draft", count:0, flag:false } };
  const origin = { projectId:"p", caseId:"c", organizationId:"org-a", clerkActorId:"actor-a" };
  const pending = { input, origin, uncertain:true }, calls = [], state = { pending, open:true, revision:0 };
  let currentAllowed = allowed;
  const context = {
    pending, projectId:"p", caseId:"c", draft:null, fresh:null, reason:"", confirmed:false,
    access:{ canEdit:editable, origin, owns:(_original, mode) => currentAllowed && (mode !== "edit" || editable) },
    save:{ isPending:false, mutateAsync:async actual => { calls.push(actual); if(lateActor) currentAllowed = false; if(failure) throw failure; return { requestId:wrongAck?"wrong-request":input.requestId, replayed:true }; } },
    utils:{ caseFields:{ get:{ invalidate:async () => calls.push("fields-read") } }, testCases:{ byId:{ invalidate:async () => calls.push("case-read") } } },
    assertCaseFieldAcknowledgement, retainedCaseFieldReceipt,
    setPending:value => { state.pending=value; }, setNotice:value => { state.notice=value; },
    setOpen:value => { state.open=value; }, setRevision:fn => { state.revision=fn(state.revision); },
    setReason:value => { state.reason=value; }, setConfirmed:value => { state.confirmed=value; },
  };
  const compiled = ts.transpileModule(`async function commit() ${source.slice(body,end).trim()}`, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
  const commit = runInNewContext(`${compiled}; commit`,context,{timeout:1000});
  return { commit, calls, state, pending, input };
}
test("uncertain editor retries refuse another actor and current Viewer", async () => {
  for (const options of [{allowed:false},{editable:false}]) {
    const h=harness(options); await h.commit(); assert.deepEqual(h.calls,[]); assert.equal(h.state.pending,h.pending);
  }
});
test("incorrect editor acknowledgement retains original body UUID and origin", async () => {
  const h=harness({wrongAck:true}); await h.commit(); assert.equal(h.calls.length,1);
  assert.equal(h.state.pending.input,h.input); assert.equal(h.state.pending.origin,h.pending.origin);
  assert.equal(h.state.pending.uncertain,true); assert.equal(h.state.open,true);
});
test("late editor acceptance does not refresh or reset the newly active account", async () => {
  const h=harness({lateActor:true}); await h.commit(); assert.equal(h.calls.length,1);
  assert.equal(h.state.pending,null); assert.equal(h.state.open,true); assert.equal(h.state.revision,0);
  assert.match(h.state.notice,/Confirmed the previous/);
});
test("later definite refusal cannot erase an earlier unknown editor receipt", async () => {
  const h=harness({failure:{data:{code:"FORBIDDEN"}}}); await h.commit();
  assert.equal(h.state.pending.input,h.input); assert.equal(h.state.pending.origin,h.pending.origin);
  assert.equal(h.state.pending.uncertain,true);
});
