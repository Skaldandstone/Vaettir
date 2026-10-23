import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseStepMeasurements, isDefinitiveStepRejection } from "./step-execution-form.ts";
const reading = { name: "Core temperature", value: "75", unit: "C", lowerLimit: "", upperLimit: "", instrument: "CAL-4" };
test("step measurements preserve approved limits and reject non-finite or inverted inputs", () => {
  assert.deepEqual(parseStepMeasurements([reading], "PASS"), [{ name: "Core temperature", value: 75, unit: "C", lowerLimit: undefined, upperLimit: undefined, instrument: "CAL-4" }]);
  for (const change of [{ value: "" }, { value: "Infinity" }, { value: "NaN" }, { unit: " " }, { name: "" }, { lowerLimit: "Infinity" }, { lowerLimit: "80", upperLimit: "70" }]) assert.throws(() => parseStepMeasurements([{ ...reading, ...change }], "FAIL"));
  assert.throws(() => parseStepMeasurements([{ ...reading, lowerLimit: "80" }], "PASS"), /cannot be recorded as Pass/);
  assert.equal(parseStepMeasurements([{ ...reading, lowerLimit: "80" }], "FAIL")[0].value, 75);
});
test("ambiguous step receipts are never discarded after a later authoritative rejection", () => {
  for (const code of ["CONFLICT", "FORBIDDEN", "UNAUTHORIZED", "BAD_REQUEST", "NOT_FOUND", "PRECONDITION_FAILED"]) {
    assert.equal(isDefinitiveStepRejection(code, false), true);
    assert.equal(isDefinitiveStepRejection(code, true), false);
  }
  for (const code of [undefined, "INTERNAL_SERVER_ERROR", "TIMEOUT"]) assert.equal(isDefinitiveStepRejection(code, false), false);
});
test("mounted step caller uses native reviewed editors, never the legacy trimming/mutation path", () => {
  const source = readFileSync(new URL("../components/StepExecutionPanel.tsx", import.meta.url), "utf8");
  const editor = readFileSync(new URL("../components/ReviewedStepObservation.tsx", import.meta.url), "utf8");
  assert.match(source, /<ReviewedStepObservation/);
  assert.match(source, /stepIndex=\{index\}/);
  assert.match(source, /retention.markPending\(index, pending\)/);
  assert.match(source, /no missing step is assumed to pass/);
  assert.doesNotMatch(source, /recordStepResult|listStepEvidence|stepResultHistory|\.trim\(|parseStepMeasurements/);
  assert.match(editor, /Choose observed outcome/);
  assert.match(editor, /Review against current procedure/);
  assert.match(editor, /Retry identical reviewed request/);
  assert.match(editor, /<StepObservationResources/);
  assert.match(editor, /Reload\/route-away recovery is not supported/);
});
test("manual page separates step mode from case-level recording", () => {
  const source = readFileSync(new URL("../app/projects/[projectId]/test-runs/manual/[testRunId]/page.tsx", import.meta.url), "utf8");
  assert.match(source, /stepModeChosen \|\| testCase.stepResults.some/);
  assert.match(source, /!stepMode\s*&&\s*\(?\s*<div/);
  assert.match(source, /StepExecutionPanel/);
  assert.match(source, /if \(!data\)/);
  assert.match(source, /Displayed evidence and open drafts are retained/);
  assert.match(source, /Refresh run without discarding drafts/);
  assert.match(source, /unconfirmedStepCases.size/);
  assert.match(source, /readable=\{readable && expanded && !hidden\}/);
  assert.match(source, /disabled=\{disabled \|\| wholeCasePending\}/);
  assert.doesNotMatch(source, /disabled=\{disabled \|\| runClosed \|\| wholeCasePending\}/, "Native canRecord governs new writes; closing a run cannot block identical accepted-UUID recovery under current FULL access");
});
