// SOURCE ONLY, authored NOT RUN. Native QueryClient/Clerk/run races remain gates.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { manualCaseRecoveryAllowed } from "./manual-case-recovery-policy.ts";
const original = { freshOriginalAccess: true, currentFullEditor: true,
  exactRetainedRequest: true, confirmedReceipt: false, definitiveRejection: false,
  parentWriteDisabled: true, runStatus: "PASSED" };
test("identical original receipt can be recovered after each known native completed status", () => {
  for (const runStatus of ["PASSED", "FAILED", "PARTIAL"])
    assert.equal(manualCaseRecoveryAllowed({ ...original, runStatus }), true);
});
test("new work, changed actor/scope, accepted receipts and definitive refusals never become recovery", () => {
  for (const field of ["freshOriginalAccess", "currentFullEditor", "exactRetainedRequest"])
    assert.equal(manualCaseRecoveryAllowed({ ...original, [field]: false }), false);
  for (const field of ["confirmedReceipt", "definitiveRejection"])
    assert.equal(manualCaseRecoveryAllowed({ ...original, [field]: true }), false);
  for (const runStatus of [null, "", "COMPLETED", "unknown"])
    assert.equal(manualCaseRecoveryAllowed({ ...original, runStatus }), false);
});
test("running parent write freeze remains respected while restored running access allows exact retry", () => {
  assert.equal(manualCaseRecoveryAllowed({ ...original, runStatus: "RUNNING" }), false);
  assert.equal(manualCaseRecoveryAllowed({ ...original, runStatus: "RUNNING", parentWriteDisabled: false }), true);
});
const ui = readFileSync(new URL("../components/ManualCaseResultHistory.tsx", import.meta.url), "utf8");
test("closed-run recovery resumes same reviewed attempt rather than building or rebasing a new correction", () => {
  assert.match(ui, /exactRetainedRequest: !!attempt && sameScope/);
  assert.match(ui, /attempt.testRunId === nativeOrigin.testRunId/);
  assert.match(ui, /attempt.testCaseId === nativeOrigin.testCaseId/);
  assert.match(ui, /\(!editor && !canRetryRetained\)/);
  assert.match(ui, /attempt \?\? buildRequest\(\)/);
  assert.match(ui, /Resume identical receipt recovery/);
  assert.match(ui, /canInspectRetainedReceipt/);
});
