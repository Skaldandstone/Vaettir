import assert from "node:assert/strict";
import { test } from "node:test";
import {
  reportOutcomeChart,
  renderReportOutcomeChart,
} from "./frozen-report.ts";

// Authored tonight; not executed during the source-only implementation window.
const report = {
  definition: { sections: ["execution"] },
  execution: {
    results: 5,
    outcomes: [
      { key: "PASS", count: 3 },
      { key: "FAIL", count: 2 },
    ],
  },
};
test("charts preserve exact recorded counts and disclose their relative scale", () => {
  const chart = reportOutcomeChart(report);
  assert.equal(chart.recordedResults, 5);
  assert.deepEqual(
    chart.rows.map((row) => row.count),
    [3, 2],
  );
  assert.deepEqual(
    chart.rows.map((row) => row.width),
    [100, (2 / 3) * 100],
  );
  assert.match(chart.note, /not a pass rate/);
  assert.match(chart.note, /no result does not mean pass/);
});
test("missing execution selection omits the chart and empty outcomes do not fabricate passes", () => {
  assert.equal(
    reportOutcomeChart({ ...report, definition: { sections: ["inventory"] } }),
    null,
  );
  const empty = { ...report, execution: { results: 0, outcomes: [] } };
  assert.deepEqual(reportOutcomeChart(empty).rows, []);
  assert.match(renderReportOutcomeChart(empty), /not a passing result/);
  assert.equal(
    reportOutcomeChart({
      ...report,
      execution: { results: 0, outcomes: [{ key: "FAIL", count: 0 }] },
    }).rows[0].width,
    0,
  );
});
test("portable chart escapes labels, has text counts and includes no external asset or script", () => {
  const html = renderReportOutcomeChart({
    ...report,
    execution: {
      results: 1,
      outcomes: [{ key: '<script>"x"</script>', count: 1 }],
    },
  });
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("<script"));
  assert.ok(!html.includes("<img"));
  assert.match(html, /<strong>1<\/strong>/);
});
