import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
test("retest module explicitly reviews exact frozen procedure and no-cost separate approval", () => {
  const modal = source("../components/ManualRetestWizard.tsx");
  assert.match(modal, /<Modal\s+open=\{open\s*&&\s*active\}/);
  assert.match(modal, /preview\.caseDefinitions\.map/);
  assert.match(modal, /c\.background/);
  assert.match(modal, /c\.steps\.map/);
  assert.match(modal, /preview\.configuration/);
  assert.match(modal, /preview\.sourceResults\.map/);
  assert.match(modal, /No AI credits or automatic execution/);
  assert.match(modal, /type="checkbox"/);
  assert.match(modal, /approval!==snapshot\?\.data\.readContext\.requestId\|\|!state\.canSubmit/);
  assert.match(
    modal.replace(/\s+/g, " "),
    /not proof that a defect was fixed/,
  );
});
test("retest uses fresh original review and never resets an ambiguous approved request", () => {
  const modal = source("../components/ManualRetestWizard.tsx");
  const controller = source("./manual-retest-reviewed-controller.ts");
  const reader = source("./use-manual-retest-reviewed-access.ts");
  assert.match(modal, /staleTime: 0/);
  assert.match(controller, /const held = this.pending \?\? this.reviewed/);
  assert.match(modal, /expectedReviewHash:\s*preview\.reviewHash/);
  assert.match(modal, /idempotencyKey:\s*crypto\.randomUUID\(\)/);
  assert.match(controller, /this.pending = held; held.submitted = true/);
  assert.match(controller, /definitive && !held.ambiguous && !wasSubmitted/);
  assert.match(modal, /legacyBlocked\|\|view.busy\|\|view.reviewed\|\|view.pending/);
  assert.match(modal, /Retry identical retest request/);
  assert.match(reader, /!query.error && !query.isFetching && !query.isPaused/);
  assert.match(modal, /legacyBlocked\|\|!current\(\)/);
});
test("retest mounts are pinned to exact project, execution and stable case identity", () => {
  const history = source("../components/TestCaseExecutionHistory.tsx");
  assert.match(history, /setSelectedRetest\(\{ runId: item\.runId, caseId: item\.definition\.originalCaseId, canRetest:/);
  assert.match(history, /sourceRunId=\{selectedRetest\.runId\} testCaseId=\{selectedRetest\.caseId\}/);
  assert.match(history, /canRetest=\{selectedRetest\.canRetest && memberCanWrite\} active=\{!!page\}/);
  assert.match(
    history,
    /item\.outcome === "FAIL" \|\| item\.outcome === "BLOCKED"/,
  );
  const run = source(
    "../app/projects/[projectId]/test-runs/manual/[testRunId]/page.tsx",
  );
  assert.match(run, /sourceRunId=\{testRunId\}/);
  assert.match(run, /testCaseId=\{tc\.testCaseId\}/);
});
