import { test } from "node:test";
import assert from "node:assert/strict";
import { renderFrozenReportHtml, reportMetricRows } from "./frozen-report.ts";
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
