/* eslint-disable @typescript-eslint/no-require-imports -- Node's dependency-free test runner. */
const test = require("node:test");
const assert = require("node:assert/strict");
const { readableError, canRevealWorkspace, containsExpiredSession } = require("../lib/recovery.ts");
const { mobilePermissions } = require("../lib/permissions.ts");

test("mobile mutation controls fail closed for read-only, absent and unknown membership", () => {
  for (const role of ["OWNER", "ADMIN", "EDITOR", "COMPLIANCE_AUDITOR", "VIEWER", "UNKNOWN"]) {
    assert.deepEqual(mobilePermissions({ role, seatType: "READ_ONLY" }), { canReview: false, canSignOff: false });
    assert.deepEqual(mobilePermissions({ role, seatType: "UNKNOWN" }), { canReview: false, canSignOff: false });
  }
  assert.deepEqual(mobilePermissions(), { canReview: false, canSignOff: false });
  assert.deepEqual(mobilePermissions({ role: "UNKNOWN", seatType: "FULL" }), { canReview: false, canSignOff: false });
  assert.deepEqual(mobilePermissions({ role: "EDITOR", seatType: "FULL" }), { canReview: true, canSignOff: false });
  assert.deepEqual(mobilePermissions({ role: "COMPLIANCE_AUDITOR", seatType: "FULL" }), { canReview: false, canSignOff: true });
  for (const role of ["OWNER", "ADMIN"]) assert.deepEqual(mobilePermissions({ role, seatType: "FULL" }), { canReview: true, canSignOff: true });
});

test("foreground return cannot bypass cache purge or revive an invalid session", () => {
  assert.equal(canRevealWorkspace({ purged: false, foreground: true, invalidated: false }), false);
  assert.equal(canRevealWorkspace({ purged: true, foreground: false, invalidated: false }), false);
  assert.equal(canRevealWorkspace({ purged: true, foreground: true, invalidated: true }), false);
  assert.equal(canRevealWorkspace({ purged: true, foreground: true, invalidated: false }), true);
});
test("batched expired sessions are recognized without assuming response shape", () => {
  for (const value of [null, false, "error", {}, [null, { result: {} }]]) assert.equal(containsExpiredSession(value), false);
  assert.equal(containsExpiredSession([{ result: {} }, { error: { data: { code: "UNAUTHORIZED" } } }]), true);
  assert.equal(containsExpiredSession({ error: { json: { data: { code: "UNAUTHORIZED" } } } }), true);
});
test("authentication errors have actionable messages, not raw Clerk payloads", () => {
  assert.match(readableError({ errors: [{ code: "form_password_incorrect" }] }), /email or password/);
  assert.match(readableError({ errors: [{ code: "form_code_incorrect" }] }), /fresh code/);
  assert.match(readableError({ status: 429 }), /Wait/);
  assert.match(readableError({ data: { code: "FORBIDDEN" } }), /administrator/);
  assert.match(readableError(new Error("Network request failed")), /offline/);
  assert.match(readableError(new Error("Insufficient AI credits")), /No automatic overage/);
  assert.doesNotMatch(readableError(new Error("Internal: SECRET_TOKEN=private-value")), /SECRET|private-value/);
});
