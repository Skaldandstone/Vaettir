// SOURCE ONLY: authored NOT RUN; native frozen-run desktop/mobile review deferred.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { manualProcedurePhases } from "./manual-procedure-phases.ts";

test("Given absence never removes independently stored When or Then procedure text", () => {
  const value = {
    given: [],
    when: ["Act\nwith exact spacing", ""],
    then: ["Expected result"],
  };
  const phases = manualProcedurePhases(value);
  assert.deepEqual(
    phases.map((p) => p.label),
    ["Given", "When", "Then"],
  );
  assert.strictEqual(phases[0].steps, value.given);
  assert.strictEqual(phases[1].steps, value.when);
  assert.strictEqual(phases[2].steps, value.then);
  assert.deepEqual(phases[1].steps, ["Act\nwith exact spacing", ""]);
});
test("a Then-only imported procedure remains independent from setup and prerequisite cases", () => {
  const value = { given: [], when: [], then: ["Retained Then-only assertion"] };
  assert.deepEqual(manualProcedurePhases(value)[2].steps, value.then);
  assert.deepEqual(value, {
    given: [],
    when: [],
    then: ["Retained Then-only assertion"],
  });
});
const page = readFileSync(
  new URL(
    "../app/projects/[projectId]/test-runs/manual/[testRunId]/page.tsx",
    import.meta.url,
  ),
  "utf8",
);
test("manual run renders every independent phase and complete ordered expected/media evidence", () => {
  assert.match(page, /manualProcedurePhases\(testCase\)\.map/);
  assert.doesNotMatch(page, /testCase.given.length > 0 &&/);
  for (const field of [
    "action",
    "expectedActionOrData",
    "expectedResult",
    "expectedResponse",
  ])
    assert.ok(page.includes(`"${field}"`));
  assert.match(page, /stepFieldLabels.expectedResponse/);
  assert.match(page, /s.mediaAttachmentIds.map/);
  assert.match(page, /s\[field\] === null/);
  assert.match(page, /s\[field\] === ""/);
  assert.match(page, /whiteSpace: "pre-wrap"/);
  assert.match(
    page,
    /aria-label="Complete stored procedure steps"\s+tabIndex=\{0\}/,
  );
  assert.match(page, /overflowX: "auto"/);
  // The complete stored table remains readable after step mode activates;
  // BDD phases and case-level recording guidance remain conditional.
  assert.match(page, /\)\}\s*<\/>\s*\)\}\s*\{testCase.steps.length > 0 &&/);
  assert.match(page, /\{!stepMode && \(\s*<p>\s*Review an observation below/);
});
test("prerequisite chips show stable project IDs without replacing frozen procedure or losing drafts on navigation", () => {
  assert.match(page, /displayId: prerequisite\?\.displayId \?\? null/);
  assert.match(page, /encodeURIComponent\(id\)/);
  assert.match(page, /target="_blank"\s+rel="noopener noreferrer"/);
  assert.match(page, /not this run's frozen procedure/);
  assert.match(page, /testCase.displayId \?\? testCase.testCaseId/);
  assert.match(page, /Stable case record ID/);
  assert.match(page, /displayId \?\? id/);
  assert.match(page, /if \(!parentCurrent\(\)\) event.preventDefault\(\)/);
});
