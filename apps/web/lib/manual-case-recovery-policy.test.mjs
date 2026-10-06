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
const completion = readFileSync(new URL("./whole-case-reviewed-controller.ts", import.meta.url), "utf8");
const reviewed = readFileSync(new URL("../../api/src/services/manualCaseResultsReviewed.ts", import.meta.url), "utf8");
test("closed-run recovery resumes same reviewed attempt rather than building or rebasing a new correction", () => {
  const compact = completion.replace(/\s+/g, " ");
  assert.match(compact, /canRetry: authorized && !this.busy && !!this.pending && same\(this.pending.origin, this.frame.origin\)/);
  assert.match(compact, /const held = this.pending \?\? this.reviewed/);
  assert.match(compact, /send\(held.request\)/);
  assert.match(compact, /input.testRunId !== this.origin.testRunId/);
  assert.match(compact, /input.testCaseId !== this.origin.testCaseId/);
  assert.match(ui, /Recover identical observation UUID/);
  assert.match(ui, /disabled=\{!view.canSubmit && !view.canRetry\}/);
  assert.ok(reviewed.indexOf("return ack(receipt, true)") < reviewed.indexOf('identity.status !== "RUNNING"'));
  assert.match(reviewed, /Legacy recovery cannot create a new write/);
});
