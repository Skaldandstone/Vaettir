import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  manualRunCaseMatches,
  nextUntestedManualCase,
} from "./manual-run-navigator.ts";
import { renderCurrentManualRunRecordJson } from "./manual-run-record-export.ts";
const cases = Array.from({ length: 851 }, (_, index) => ({
  testCaseId: `case-${index + 1}`,
  displayId: `TC-${index + 1}`,
  title: `Synthetic case ${index + 1}`,
  currentResult: index === 0 ? { status: "PASS" } : null,
}));
test("all 851 run cases remain navigable by stable ID or title without changing scope", () => {
  const before = structuredClone(cases);
  assert.deepEqual(
    cases
      .filter((value) => manualRunCaseMatches(value, " TC-851 ", "ALL"))
      .map((value) => value.testCaseId),
    ["case-851"],
  );
  assert.equal(
    cases.filter((value) => manualRunCaseMatches(value, "", "UNTESTED")).length,
    850,
  );
  assert.equal(
    cases.filter((value) =>
      manualRunCaseMatches(value, "synthetic case 851", "ALL"),
    ).length,
    1,
  );
  assert.deepEqual(cases, before);
});
test("next untested advances and wraps without recording anything", () => {
  assert.equal(nextUntestedManualCase(cases, null), "case-2");
  assert.equal(nextUntestedManualCase(cases, "case-2"), "case-3");
  assert.equal(nextUntestedManualCase(cases, "case-851"), "case-2");
  assert.equal(nextUntestedManualCase([], null), null);
  assert.equal(nextUntestedManualCase([{ ...cases[0] }], "case-1"), null);
});
test("status filters distinguish failed, blocked, recorded and untested", () => {
  const value = { ...cases[0], currentResult: { status: "BLOCKED" } };
  assert.equal(manualRunCaseMatches(value, "", "FAILED"), false);
  assert.equal(manualRunCaseMatches(value, "", "BLOCKED"), true);
  assert.equal(manualRunCaseMatches(value, "", "RECORDED"), true);
  assert.equal(
    manualRunCaseMatches({ ...value, currentResult: null }, "", "UNTESTED"),
    true,
  );
});
const record = {
  runId: "synthetic-run",
  projectId: "synthetic-project",
  status: "RUNNING",
  executionContext: { version: 1, configuration: { build: "Synthetic build" } },
  stepFieldLabels: { action: "Tester action" },
  cases: [
    {
      ...cases[850],
      steps: [
        {
          order: 0,
          action: "Click\nbutton",
          expectedActionOrData: "GET /synthetic",
          expectedResult: "",
          expectedResponse: null,
          mediaAttachmentIds: ["synthetic-reference"],
        },
      ],
      given: [],
      when: ["Act"],
      then: ["Observe"],
      currentResult: null,
    },
  ],
};
test("current JSON preserves complete present procedures and null/empty values with honest boundaries", () => {
  const before = structuredClone(record);
  const result = JSON.parse(renderCurrentManualRunRecordJson(record));
  assert.deepEqual(result.cases, record.cases);
  assert.deepEqual(result.executionContext, record.executionContext);
  assert.match(
    result.evidenceBoundary.outcomes,
    /not a complete revision history/,
  );
  assert.match(result.evidenceBoundary.media, /No attachment files/);
  assert.deepEqual(record, before);
  assert.match(
    JSON.parse(
      renderCurrentManualRunRecordJson({ ...record, executionContext: null }),
    ).evidenceBoundary.procedures,
    /may reflect later case edits/,
  );
});
test("ambiguous, oversized and out-of-bounds JSON exports refuse rather than silently slice", () => {
  assert.throws(
    () =>
      renderCurrentManualRunRecordJson({
        ...record,
        cases: [record.cases[0], record.cases[0]],
      }),
    /ambiguous/,
  );
  assert.throws(
    () =>
      renderCurrentManualRunRecordJson({
        ...record,
        cases: Array.from({ length: 1001 }, (_, i) => ({
          testCaseId: String(i),
        })),
      }),
    /unsupported/,
  );
  assert.throws(
    () =>
      renderCurrentManualRunRecordJson({
        ...record,
        executionContext: { text: "x".repeat(8 * 1024 * 1024) },
      }),
    /8 MiB/,
  );
});
test("display filtering keeps all keyed row components mounted and navigation only opens a target", () => {
  const source = readFileSync(
    new URL(
      "../app/projects/[projectId]/test-runs/manual/[testRunId]/page.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(source, /\(rows\.retained\?\.rows \?\? \[\]\)\.map\(\(tc\) =>/);
  assert.match(source, /hidden=\{!readable \|\| !fresh\?\.cases\.some/);
  assert.match(source, /\|\| !manualRunCaseMatches\(tc, caseSearch, caseFilter\)/);
  assert.doesNotMatch(source, /matchingCases\.map\(/);
  assert.match(source, /parentCurrent\(\) && navigationTarget && navigationRevision > focusedRevision\.current/);
  assert.match(source, /focusedRevision\.current = navigationRevision/);
  assert.match(source, /reader\.current\(\) === snapshot/);
  assert.match(source, /setExpanded\(true\)/);
});
test("manual cards open the execution record and expose truthful broader report routes", () => {
  const source = readFileSync(
    new URL("../components/RunOverview.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /View run and cases/);
  assert.match(source, /onClick=\{\(\) => onView\(run.id\)\}/);
  assert.match(source, /execution-trends/);
  assert.match(source, /Compare recorded CI runs/);
});
