// Source fixtures authored NOT RUN. Actual Clerk/QueryClient/new-tab rendering remains open.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sourceCodeIncludes } from "./source-contract-tokens.mjs";
import { manualCaseHistorySelection } from "./case-observation-history-entry.ts";
const response = { projectId: "p", testRunId: "r", cases: [{ testCaseId: "c" }], executionContext: { caseDefinitions: [{ testCaseId: "c" }] } };
const input = { requestedCaseIds: ["c"], projectId: "p", testRunId: "r", fresh: true, response };
test("exact fresh native and frozen identity selects only that case, no query selects none", () => {
  assert.deepEqual(manualCaseHistorySelection(input), { kind: "SELECTED", caseId: "c", anchor: "manual-case-c" });
  assert.equal(manualCaseHistorySelection({ ...input, requestedCaseIds: [] }).kind, "NONE");
  assert.deepEqual(response, input.response);
});
test("missing/fetching/error/paused responses cannot resolve a cached selection", () => {
  assert.equal(manualCaseHistorySelection({ ...input, fresh: false }).kind, "WAITING");
  assert.equal(manualCaseHistorySelection({ ...input, response: undefined }).kind, "WAITING");
});
test("foreign, missing, malformed, legacy and duplicated targets never select first case", () => {
  for (const requestedCaseIds of [["other"], [""], ["c", "c"], ["c", "other"], ["\u0000"], ["c".repeat(201)], ["\ud800"]])
    assert.equal(manualCaseHistorySelection({ ...input, requestedCaseIds }).kind, "UNAVAILABLE");
  for (const changed of [{ projectId: "foreign" }, { testRunId: "foreign" }, { executionContext: null }, { cases: [] },
    { cases: [response.cases[0], response.cases[0]] }, { executionContext: { caseDefinitions: [] } },
    { executionContext: { caseDefinitions: [response.cases[0], response.cases[0]] } }])
    assert.equal(manualCaseHistorySelection({ ...input, response: { ...response, ...changed } }).kind, "UNAVAILABLE");
});
const native = readFileSync(new URL("../app/projects/[projectId]/test-runs/manual/[testRunId]/page.tsx", import.meta.url), "utf8");
const summary = readFileSync(new URL("../../api/src/services/caseExecutionHistory.ts", import.meta.url), "utf8");
test("native query and exact-case expansion preserve mounted draft identities without recording", () => {
  for (const text of ['searchParams.getAll("caseId")', "fresh: readable", "ready: access.ready, error: !!dataQuery.error, fetching: dataQuery.isFetching, paused: dataQuery.isPaused", 'historySelection.kind === "SELECTED" && historySelection.caseId === tc.testCaseId',
    "if (selectedFromHistory) setExpanded(true)", "id={manualCaseHistoryAnchor(testCase.testCaseId) ?? undefined}", "No other case was selected", "<Suspense", "scrollIntoView", 'key={`${projectId}:${testRunId}:${tc.testCaseId}`}']) assert.ok(sourceCodeIncludes(native, text), text);
  assert.ok(!native.includes("if (selectedFromHistory) record("));
  assert.ok(!native.includes("setExpanded(selectedFromHistory)"));
  assert.ok(summary.includes("For unversioned observations, earlier changes, observer and observation time were not recorded"));
  assert.ok(summary.includes("does not project immutable whole-case revision evidence"));
});
