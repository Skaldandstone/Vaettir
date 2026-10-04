// SOURCE ONLY: authored static contracts, no checker/browser run tonight.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const raw = readFileSync(
    new URL("../components/TestCaseClone.tsx", import.meta.url),
    "utf8",
  ),
  ui = raw.replace(/\s+/g, " ");
const api = readFileSync(
  new URL("../../api/src/services/caseClone.ts", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
test("optional review shows every concrete value and names new composite row identity without transferring evidence", () => {
  for (const phrase of [
    "Include parameter dataset (optional)",
    "Complete independent dataset review",
    "baseline.dataset.parameterNames.map",
    "baseline.dataset.rows.map",
    "row.values[name]",
    "Empty string",
    "new dataset ID, row index",
    "expectedDatasetHash: baseline.datasetReviewHash",
    "expectedDataset: baseline.datasetSource",
    "Historical copied dataset mapping",
  ])
    assert.ok(ui.includes(phrase), phrase);
});
test("frozen human fields and exact uncertain request remain mounted through mode/close/scope changes with fresh actor/member denial guards", () => {
  for (const phrase of [
    "if (!draftSeeded)",
    "scope.matches(previewScope)",
    "preview.data.copyParameterDataset === copyParameterDataset",
    "membership.isPaused",
    "membership.isFetching",
    "scope.changed",
    'currentMember?.seatType === "FULL"',
    "const attempt = pending ??",
    "exactAttempt.current?.input !== attempt.input",
    "retainedTraceabilityReceipt(attempt, error)",
    "if (!mounted.current) return",
  ])
    assert.ok(ui.includes(phrase), phrase);
  assert.ok(
    raw.indexOf("await verifiedIndependentCloneAck(attempt.input, result)") <
      raw.indexOf("setPending(null)"),
  );
  assert.ok(ui.includes("accepted duplicate was not retried"));
});
test("server gates expected scope before receipt and preserves no-option helper/audit/result semantics with atomic opted dataset receipt", () => {
  for (const phrase of [
    "independentCloneScope",
    "receipt.organizationId !== organization.organizationId",
    "FOR UPDATE",
    "FOR SHARE OF d",
    "plan.reviewHash !== input.expectedDatasetHash",
    "qualityProfileHash(plan.source)",
    "validatedDatasetReplay",
    "copyParameterDataset: true",
    "excluded: exclusionNotice.replace",
  ])
    assert.ok(api.includes(phrase), phrase);
  assert.ok(
    api.indexOf("const scope =") < api.indexOf('entityType: "TestCaseClone"'),
  );
  assert.ok(api.includes("if (!scope) return state.preview"));
  assert.ok(api.includes("if (!plan) return"));
});
