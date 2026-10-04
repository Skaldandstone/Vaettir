import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { renderReportComparisonHtml } from "./report-comparison.ts";

// Authored source regressions only; not executed in the source-only night.
test("portable comparisons escape retained text and preserve unavailable/neutral counts and original boundaries", () => {
  const capture = {
    id: "not-exported",
    title: "<script>bad</script>",
    asOf: "2026-10-04T00:00:00Z",
    windowStart: "2026-10-01",
    windowEnd: "2026-10-02",
  };
  const html = renderReportComparisonHtml({
    baseline: capture,
    target: capture,
    scopeDescription: "Project-wide scope",
    scope: "project",
    sameExecutionWindow: false,
    cohort: { common: 1, added: 2, removed: 0 },
    rows: [
      {
        section: "defects",
        label: "Defect count",
        baseline: null,
        target: 2,
        delta: null,
        note: "No import is not zero",
      },
    ],
    limitations: ["Not a stored approval"],
    sourceLimitations: {
      baseline: ["Earlier boundary"],
      target: ["Later boundary"],
    },
  });
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("<script"));
  assert.match(html, /Unavailable/);
  assert.match(html, /Different original execution windows/);
  assert.match(html, /Earlier boundary/);
  assert.match(html, /Later boundary/);
  assert.ok(!html.includes("not-exported"));
  assert.ok(!html.includes("<img"));
});
test("comparison controls use a modal, fresh exact-pair guard and explicit export review", () => {
  const ui = readFileSync(
    new URL("../components/ReportSnapshotComparison.tsx", import.meta.url),
    "utf8",
  ).replace(/\s+/g, " ");
  assert.match(ui, /<Modal open/);
  assert.match(ui, /!query.error && !query.isFetching && !query.isPaused/);
  assert.match(
    ui,
    /query.data.baseline.id === baselineId && query.data.target.id === targetId/,
  );
  assert.match(ui, /if \(!data \|\| !reviewed\) return/);
  assert.match(ui, /disabled=\{!reviewed\}/);
});
