// Source contracts only; actual QueryClient/browser acceptance remains separate.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
test("procedure snapshot restoration is a project-scoped focused reviewed modal", () => {
  const component = source("../components/TestCaseProcedureReimport.tsx");
  const page = source("../app/projects/[projectId]/test-cases/page.tsx");
  assert.match(component, /key=\{projectId\}/);
  assert.match(component, /title="Restore reviewed case procedures"/);
  assert.match(component, /size="wide"/);
  assert.match(component, /type="file"/);
  assert.match(component, /Same-project version 1 snapshots only/);
  assert.match(component, /Original identity unavailable; not recreated/);
  assert.match(component, /entry\.status === "CONFLICT"/);
  assert.match(component, /overwriteConfirmed: true/);
  assert.match(component, /Reason for replacing current content\s+\(required\)/);
  assert.match(component, /reasons\[id\]\?\.trim\(\)/);
  assert.match(
    component,
    /All current records\s+absent from this file stay untouched/,
  );
  assert.match(
    page,
    /!readOnly && <TestCaseProcedureReimport projectId=\{projectId\}/,
  );
});
test("comparison has readable procedure columns, explicit partial scope and pagination", () => {
  const component = source("../components/TestCaseProcedureReimport.tsx");
  for (const label of [
    "Step",
    "Action",
    "Expected data",
    "Expected result",
    "Response",
    "Media IDs",
  ])
    assert.ok(component.includes(`<th>${label}</th>`));
  assert.match(component, /<strong>Current<\/strong>/);
  assert.match(component, /<strong>Snapshot<\/strong>/);
  assert.match(component, /overflowX: "auto"/);
  assert.match(
    component,
    /preview\.entries\s*\.slice\(page \* 10, page \* 10 \+ 10\)/,
  );
  assert.match(component, /No attachment files are\s+fetched/);
  assert.match(component, /Previous/);
  assert.match(component, /Back to file/);
});
test("uncertain approval retains immutable exact request across close and subsequent failure", () => {
  const component = source("../components/TestCaseProcedureReimport.tsx");
  assert.match(component, /pending \?\? \{/);
  assert.match(component, /requestId: crypto\.randomUUID\(\)/);
  assert.match(component, /approveMutation\.mutateAsync\(attempt\.input\)/);
  assert.match(component, /retainedTraceabilityReceipt\(attempt, error\)/);
  assert.match(component, /Closing this\s+dialog does not discard it/);
  assert.match(component, /Retry exact approval/);
  assert.match(component, /onClose=\{\(\) => setOpen\(false\)\}/);
  assert.match(component, /if \(pending \|\| busy\) return/);
  assert.match(component, /generation === fileGeneration\.current/);
});
