import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = readFileSync(
  new URL("../components/TestCaseClone.tsx", import.meta.url),
  "utf8",
);
const detail = readFileSync(
  new URL("../components/TestCaseDetailContent.tsx", import.meta.url),
  "utf8",
);
test("clone workflow state is scoped to project and case, with an editor-only inspector entry", () => {
  assert.match(source, /key=\{`\$\{props.projectId\}:\$\{props.caseId\}`\}/);
  assert.match(
    detail,
    /!readOnly &&[\s\S]*?<TestCaseClone[\s\S]*?projectId=\{projectId\}[\s\S]*?caseId=\{tc.id\}/,
  );
  assert.match(source, /Duplicate case/);
  assert.match(source, /size="wide"/);
});
test("fresh clone previews reject cached errors, active refreshes, offline pauses and wrong identities", () => {
  assert.match(source, /enabled: open && !baseline && !pending && !created/);
  assert.match(source, /staleTime: 0/);
  assert.match(
    source,
    /!preview.error &&\s*!preview.isFetching &&\s*!preview.isPaused &&\s*preview.data\?\.sourceId === caseId/,
  );
  assert.match(
    source,
    /if \(open && !baseline && !pending && !created && fresh\)/,
  );
  assert.match(source, /Retry preview/);
  assert.match(source, /preview.isPaused/);
});
test("case clone reviews procedure, physical context, exclusions, title and suite before explicit creation", () => {
  for (const label of [
    "Review the procedure being copied",
    "Verification context and tags",
    "New title (required)",
    "Suite (optional)",
    "Reason (required)",
    "Create duplicate",
  ])
    assert.ok(source.includes(label));
  assert.match(source, /baseline.definition.steps.map/);
  assert.match(source, /baseline.warnings.map/);
  assert.match(source, /!confirmed \|\| !title.trim\(\) \|\| !reason.trim\(\)/);
  assert.match(
    source,
    /expectedSourceRevision: baseline.expectedSourceRevision/,
  );
  assert.match(source, /confirmed: true as const/);
  assert.match(source, /requestId: crypto.randomUUID\(\)/);
});
test("uncertain clone responses retain the exact request through modal close and reopen", () => {
  assert.match(source, /const attempt = pending \?\?/);
  assert.match(source, /retainedTraceabilityReceipt\(attempt, error\)/);
  assert.match(source, /function show\(\)[\s\S]*?if \(!pending && !created\)/);
  assert.match(source, /dismissible=\{!create.isPending\}/);
  assert.match(source, /disabled=\{create.isPending \|\| Boolean\(pending\)\}/);
  assert.match(source, /Retry reviewed duplicate/);
  assert.match(source, /create.error.message/);
  assert.match(source, /Review another duplicate/);
  assert.match(source, /created.caseId/);
  assert.doesNotMatch(source, /window.location|router.push/);
});
