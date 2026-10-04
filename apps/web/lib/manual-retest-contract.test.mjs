import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
test("retest module explicitly reviews exact frozen procedure and no-cost separate approval", () => {
  const modal = source("../components/ManualRetestWizard.tsx");
  assert.match(modal, /<Modal\s+open=\{open && active\}/);
  assert.match(modal, /preview\.caseDefinitions\.map/);
  assert.match(modal, /c\.background/);
  assert.match(modal, /c\.steps\.map/);
  assert.match(modal, /preview\.configuration/);
  assert.match(modal, /preview\.sourceResults\.map/);
  assert.match(modal, /0\s+AI credits/);
  assert.match(modal, /type="checkbox"/);
  assert.match(modal, /!approved \|\| busy \|\| rejected/);
  assert.match(
    modal.replace(/\s+/g, " "),
    /not proof that a linked defect was fixed/,
  );
});
test("retest uses fresh original review and never resets an ambiguous approved request", () => {
  const modal = source("../components/ManualRetestWizard.tsx");
  assert.match(modal, /staleTime: 0/);
  assert.match(modal, /const request = attempt \?\?/);
  assert.match(modal, /expectedReviewHash: preview\.reviewHash/);
  assert.match(modal, /idempotencyKey: crypto\.randomUUID\(\)/);
  assert.match(modal, /setAttempt\(request\)/);
  assert.match(modal, /definitive && !ambiguous/);
  assert.match(
    modal,
    /busy \|\| ambiguous \|\| Boolean\(attempt && !rejected\)/,
  );
  assert.match(modal, /Retry same retest request/);
  assert.match(modal, /links\.isError/);
  assert.match(modal, /links\.fetchStatus === "paused"/);
});
test("retest mounts are pinned to exact project, execution and stable case identity", () => {
  const history = source("../components/TestCaseExecutionHistory.tsx");
  assert.match(history, /sourceRunId=\{item\.runId\}/);
  assert.match(history, /testCaseId=\{item\.definition\.originalCaseId\}/);
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
