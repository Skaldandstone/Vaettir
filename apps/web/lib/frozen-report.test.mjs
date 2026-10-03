import { test } from "node:test";
import assert from "node:assert/strict";
import {
  renderFrozenReportHtml,
  reportMetricRows,
  reportScopeSummary,
} from "./frozen-report.ts";
const payload = {
  state: "approved",
  projectName: "Synthetic",
  title: '<script>alert("secret")</script>',
  asOf: "2026-10-02T10:00:00Z",
  windowStart: "2026-09-02T10:00:00Z",
  definition: {
    audience: "stakeholders",
    windowDays: 30,
    sections: ["execution", "automation", "defects"],
    summary: '<img src="https://external.invalid/a">',
    risks: "",
    nextActions: "",
  },
  inventory: {
    active: 2,
    riskAssessed: 1,
    flaky: 0,
    priority: [],
    automation: [{ key: "AUTOMATED", count: 2 }],
  },
  execution: {
    runs: 1,
    results: 2,
    outcomes: [{ key: "SKIP", count: 2 }],
    distinctCases: 0,
    highPriorityCases: 1,
    highPriorityExecuted: 0,
  },
  traceability: {
    requirements: 0,
    coveredRequirements: 0,
    casesWithLinks: 0,
    links: 0,
  },
  defects: null,
  cohort: [{ id: "private-cohort-id", status: "AUTOMATED" }],
  automationChange: null,
  limitations: ["No runtime acceptance"],
};
test("portable snapshot escapes all authored text and contains no scripts, assets or cohort IDs", () => {
  const html = renderFrozenReportHtml(payload);
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("<script"));
  assert.ok(!html.includes("<img"));
  assert.ok(!html.includes("private-cohort-id"));
  assert.ok(html.includes("review recipients first"));
});
test("selected sections, missing baseline/data and honest distinct-case denominator are explicit", () => {
  const rows = reportMetricRows(payload);
  assert.ok(
    rows.every((row) =>
      ["execution", "automation", "defects"].includes(row.section),
    ),
  );
  assert.equal(
    rows.find((row) => row.label === "Distinct active cases executed")?.value,
    "0 / 2",
  );
  assert.equal(
    rows.find((row) => row.label === "Defect evidence")?.value,
    "Not imported",
  );
  assert.ok(rows.some((row) => row.value === "No earlier approved snapshot"));
});
test("scoped snapshot exports exact UTC end and exclusions without claiming project-wide coverage", () => {
  const scoped = {
    ...payload,
    windowEnd: "2020-01-15T23:59:59.999Z",
    windowStart: "2020-01-15T00:00:00Z",
    scope: {
      kind: "recorded-execution",
      filters: { planId: "plan", platform: "<PC>", runId: "run", build: "v1" },
      planName: "Synthetic plan",
      contributingRunIds: ["run"],
      cohortBasis: "Current active planned and linked cases",
    },
    execution: {
      ...payload.execution,
      matchedResults: 1,
      unmatchedResults: 1,
      plannedCaseRunPairs: 3,
      notRecordedCaseRunPairs: 2,
    },
  };
  assert.equal(
    reportScopeSummary(scoped),
    "Plan: Synthetic plan · Run: run · Platform: <PC> · Build: v1",
  );
  const html = renderFrozenReportHtml(scoped);
  assert.ok(html.includes("2020-01-15T23:59:59.999Z"));
  assert.ok(html.includes("&lt;PC&gt;"));
  assert.ok(!html.includes("Project-wide scope"));
  const rows = reportMetricRows(scoped);
  assert.equal(
    rows.find((row) => row.label === "Defect evidence").value,
    "Excluded from this scope",
  );
  assert.equal(
    rows.find((row) => row.label === "Unmatched / foreign case results").value,
    1,
  );
  assert.equal(
    rows.find((row) => row.label === "Planned pairs without a result").value,
    2,
  );
});
