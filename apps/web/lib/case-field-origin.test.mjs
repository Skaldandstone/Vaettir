import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sameCaseFieldOrigin, retainedCaseFieldReceipt, assertCaseFieldAcknowledgement } from "./case-field-origin.ts";
const original = { projectId:"project-a", organizationId:"org-a", clerkActorId:"actor-a", caseId:"case-a" };
test("field origin requires the complete original project organization and actor", () => {
  assert.equal(sameCaseFieldOrigin(original, { ...original }), true);
  for (const field of Object.keys(original)) {
    assert.equal(sameCaseFieldOrigin(original, { ...original, [field]: "other" }), false);
    assert.equal(sameCaseFieldOrigin({ ...original, [field]: "" }, { ...original, [field]: "" }), false);
  }
  assert.equal(sameCaseFieldOrigin(null, original), false);
  assert.equal(sameCaseFieldOrigin(original, null), false);
  assert.equal(sameCaseFieldOrigin({ ...original, caseId:null }, { ...original, caseId:null }), true);
});
test("lost field response preserves exact original body UUID and origin through later denials", () => {
  const input = { requestId:"synthetic-retained-request", values:{ private_note:"A draft", count:0, approved:false } };
  const attempt = { input, origin:original, uncertain:false };
  let retained = retainedCaseFieldReceipt(attempt, new Error("lost response"));
  for (const code of ["FORBIDDEN", "UNAUTHORIZED", "CONFLICT", "BAD_REQUEST", "NOT_FOUND"]) {
    retained = retainedCaseFieldReceipt(retained, { data:{ code } });
    assert.equal(retained.input, input); assert.equal(retained.origin, original); assert.equal(retained.uncertain, true);
  }
  assert.equal(sameCaseFieldOrigin(retained.origin, { ...original, clerkActorId:"actor-b" }), false);
  assert.equal(sameCaseFieldOrigin(retained.origin, { ...original }), true);
});
test("first definite field refusal does not manufacture uncertainty", () => {
  assert.equal(retainedCaseFieldReceipt({ input:{}, origin:original, uncertain:false }, { data:{ code:"CONFLICT" } }), null);
});
test("field ACK must echo the exact request before consuming a retained receipt", () => {
  for (const replayed of [true, false]) assert.doesNotThrow(() => assertCaseFieldAcknowledgement({ requestId:"one", replayed }, "one"));
  assert.throws(() => assertCaseFieldAcknowledgement({ requestId:"two", replayed:false }, "one"));
  assert.throws(() => assertCaseFieldAcknowledgement({ requestId:"one", replayed:null }, "one"));
});
test("field freshness uses actual provider auth without remounting private drafts", () => {
  const source = readFileSync(new URL("./use-case-field-access.ts", import.meta.url), "utf8");
  assert.match(source, /useAuth\(\)/);
  assert.match(source, /enabled: active && authReady/);
  assert.match(source, /!query\.error &&\s*!query\.isFetching &&\s*!query\.isPaused/);
  assert.match(source, /sameCaseFieldOrigin\(original, latest\.current\)/);
  assert.match(source, /useLayoutEffect/);
  assert.match(source, /fresh: readable \? fresh : null/);
});
