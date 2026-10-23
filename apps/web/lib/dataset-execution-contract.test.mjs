import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
test("dataset modal makes concrete procedure review and zero-cost approval separate screens", () => {
  const modal = source("../components/DatasetExecutionWizard.tsx");
  assert.match(modal, /<Modal\s+open=\{open\}/);
  assert.match(modal, /"context" \| "preview" \| "review"/);
  assert.match(modal, /caseDefinitions\.map/);
  assert.match(modal, /definition\.steps\.map/);
  assert.match(modal, /expectedActionOrData/);
  assert.match(modal, /definition\.background/);
  assert.match(modal, /0 AI credits/);
  assert.match(modal, /type="checkbox"/);
  assert.match(modal, /independent row runs/);
  assert.match(modal, /never unlocks this row/);
  assert.match(modal, /!approved \|\| busy \|\| rejected/);
  assert.doesNotMatch(modal, /router\.push|window\.location|setTimeout/);
});
test("dataset start uses exact reviewed configuration/hash and retains ambiguous retry key", () => {
  const modal = source("../components/DatasetExecutionWizard.tsx");
  assert.match(modal, /const request = attempt \?\?/);
  assert.match(modal, /executionContext: preview\.configuration/);
  assert.match(modal, /expectedExpansionHash: preview\.expansionHash/);
  assert.match(modal, /idempotencyKey: crypto\.randomUUID\(\)/);
  assert.match(modal, /setAttempt\(request\)/);
  assert.match(modal, /mutateAsync\(request\)/);
  assert.match(modal, /staleTime: 0/);
  assert.match(modal, /definitive && !ambiguous/);
  assert.match(modal, /busy \|\| receipt \|\| ambiguous/);
  assert.match(modal, /Retry same batch/);
  assert.match(modal, /row\.testRunId/);
});
test("dataset entry stays mounted and row execution shows frozen metadata only", () => {
  const detail = source("../components/TestCaseDetailContent.tsx");
  assert.match(
    detail,
    /<DatasetExecutionWizard\s+key=\{`\$\{projectId\}:\$\{testCaseId\}`\}\s+open=\{executionOpen\}\s+onClose=\{\(\) => setExecutionOpen\(false\)\}\s+projectId=\{projectId\}\s+testCaseId=\{testCaseId\}/,
  );
  assert.match(detail, /!readOnly && !editing && savedRows.length > 0/);
  const run = source(
    "../app/projects/[projectId]/test-runs/manual/[testRunId]/page.tsx",
  );
  assert.match(run, /data\.executionContext\.datasetExecution\.values/);
  assert.match(run, /data\.datasetBatchRuns\.map/);
  assert.match(run, /within\s+this\s+run,\s+not\s+in\s+a\s+sibling\s+row/);
});
