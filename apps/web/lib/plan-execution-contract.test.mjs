import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = path => readFileSync(new URL(path, import.meta.url), "utf8");

test("reusable plan configuration has reviewed writes and explicit preserved conflicts", () => {
  const modal = source("../components/PlanExecutionModal.tsx");
  assert.match(modal, /<Modal\s+open=\{open\}/);
  assert.match(modal, /screen !== "save-review"/);
  assert.match(modal, /expectedTemplateHash: baseline.templateHash/);
  assert.match(modal, /Your draft is retained/);
  assert.match(modal, /Discard draft and load current state/);
  assert.match(modal, /Keep my draft/);
  assert.match(modal, /type="checkbox"/);
  assert.match(modal, /caseLimitReached/);
  assert.match(modal, /Move case \$\{index \+ 1\} up/);
  assert.match(modal, /maxLength=\{200\}/);
  assert.match(modal, /"FOOD_SAFETY", "CLINICAL", "LABORATORY", "MANUFACTURING"/);
  assert.match(modal, /"hardwareRevision",\s*"firmwareVersion",\s*"rig",\s*"calibrationReference"/);
});

test("plan starts use saved baseline and actor-reviewed stable retry receipt", () => {
  const modal = source("../components/PlanExecutionModal.tsx");
  assert.match(modal, /const request = runAttempt \?\?/);
  assert.match(modal, /testCaseIds: \[\.\.\.baseline.template.testCaseIds\]/);
  assert.match(modal, /executionContext: \{ \.\.\.preset!\.context \}/);
  assert.match(modal, /idempotencyKey: crypto.randomUUID\(\)/);
  assert.match(modal, /setRunAttempt\(request\)/);
  assert.match(modal, /mutateAsync\(request\)/);
  assert.match(modal, /configurationId: preset!\.id/);
  assert.match(modal, /Boolean\(runAttempt\)/);
  assert.match(modal, /rejected && !everAmbiguous/);
  assert.match(modal, /if \(!rejected\) setEverAmbiguous\(true\)/);
  assert.match(modal, /Configure another separate execution/);
  assert.match(modal, /setSelectedCaseLabels/);
  assert.match(modal, /previousCursors/);
  assert.match(modal, /No AI credits, source reading, code execution or device control/);
  assert.match(modal, /!permission.canEdit/);
  assert.match(modal, /setStartedRunId\(result.testRunId\)/);
  assert.doesNotMatch(modal, /window.location|router.push|setTimeout\(.*start\(/);
});

test("plan detail keeps configuration modal mounted on the current page", () => {
  const detail = source("../components/TestPlanDetailContent.tsx");
  assert.match(detail, /const executionControls = controlProjectId \? <PlanExecutionModal key=\{id\}/);
  assert.match(detail, /open=\{executionOpen && !!plan && auth\.isLoaded && !!auth\.isSignedIn && !readOnly && !loadError\}/);
  assert.match(detail, /projectId=\{controlProjectId\}/);
  assert.match(detail, /if \(!plan\) return <div>\{executionControls\}\{reviewedControls\}/);
  assert.equal(detail.match(/<PlanExecutionModal\b/g)?.length, 1);
  assert.equal(detail.match(/\{executionControls\}/g)?.length, 2);
  assert.match(detail, /Configure cases \/ repeat execution/);
  const list = source("../app/projects/[projectId]/test-plans/page.tsx");
  assert.match(list, /save named configurations, then review each repeat execution/);
});
