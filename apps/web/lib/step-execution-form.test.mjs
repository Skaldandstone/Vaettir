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
test("step modal freezes expected index/revision and explicitly reviews outcomes without default pass", () => {
  const source = readFileSync(new URL("../components/StepExecutionPanel.tsx", import.meta.url), "utf8");
  assert.match(source, /status: current\?\.status \?\? ""/);
  assert.match(source, /Choose observed outcome/);
  assert.match(source, /expectedRevisionId: draft.current\?\.id \?\? null/);
  assert.match(source, /stepIndex: draft.stepIndex/);
  assert.match(source, /const request = attempt \?\? makeRequest\(\)/);
  assert.match(source, /setAttempt\(request\)/);
  assert.match(source, /current baseline and review my correction/);
  assert.match(source, /correctionReason.trim/);
  assert.match(source, /No missing step|no missing step/);
  assert.match(source, /listStepEvidence.useQuery/);
  assert.match(source, /Confirmed|confirmed uploaded files/);
  assert.match(source, /stepResultHistory.useQuery/);
  assert.match(source, /retry receipts remain only while this page is open/);
});
test("manual page separates step mode from case-level recording", () => {
  const source = readFileSync(new URL("../app/projects/[projectId]/test-runs/manual/[testRunId]/page.tsx", import.meta.url), "utf8");
  assert.match(source, /stepModeChosen \|\| testCase.stepResults.some/);
  assert.match(source, /!stepMode && <div/);
  assert.match(source, /StepExecutionPanel/);
  assert.match(source, /if \(!data\)/);
  assert.match(source, /Displayed evidence and open drafts are retained/);
  assert.match(source, /Refresh run without discarding drafts/);
  assert.match(source, /unconfirmedStepCases.size/);
});
