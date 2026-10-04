// Authored source-only scenarios. NOT executed during James's deferred-validation night.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  renderFrozenReportCsv,
  renderReportComparisonCsv,
} from "./report-csv.ts";

const report = {
  state: "approved",
  projectName: "Synthetic project",
  title: "Recorded quality status",
  asOf: "2026-10-04T01:00:00Z",
  windowStart: "2026-10-01T00:00:00Z",
  windowEnd: "2026-10-03T23:59:59.999Z",
  definition: {
    audience: "stakeholders",
    windowDays: 7,
    sections: ["execution", "defects"],
    summary: "secret author summary",
    risks: "secret author risks",
    nextActions: "secret author next steps",
  },
  inventory: {
    active: 3,
    riskAssessed: 1,
    flaky: 0,
    priority: [],
    automation: [],
  },
  execution: {
    runs: 1,
    results: 2,
    outcomes: [{ key: "BLOCKED", count: 2 }],
    distinctCases: 0,
    highPriorityCases: 1,
    highPriorityExecuted: 0,
    matchedResults: 1,
    unmatchedResults: 1,
    plannedCaseRunPairs: 4,
    notRecordedCaseRunPairs: 2,
  },
  traceability: {
    requirements: 0,
    coveredRequirements: 0,
    casesWithLinks: 0,
    links: 0,
  },
  defects: null,
  cohort: [{ id: "raw-private-cohort", status: "MANUAL" }],
  automationChange: null,
  scope: {
    kind: "recorded-execution",
    filters: {
      planId: "raw-private-plan",
      runId: "raw-private-run",
      platform: "PC",
    },
    planName: null,
    contributingRunIds: ["raw-private-run"],
    cohortBasis: "Current explicit planned and linked identities",
  },
  evidence: { version: 1, cases: [{ id: "raw-private-case" }], runs: [] },
  limitations: [
    "No runtime acceptance",
    "No recorded outcome is not a passing test",
  ],
};
const capture = {
  id: "raw-private-snapshot",
  title: "Earlier quality status",
  asOf: "2026-10-01T00:00:00Z",
  windowStart: "2026-09-30T00:00:00Z",
  windowEnd: "2026-10-01T00:00:00Z",
};
const comparison = {
  projectId: "raw-private-project",
  baseline: capture,
  target: {
    ...capture,
    title: "Later quality status",
    asOf: "2026-10-04T00:00:00Z",
    windowEnd: "2026-10-04T00:00:00Z",
  },
  scopeDescription: "Project-wide scope",
  scope: "project",
  sections: ["execution", "defects"],
  sameExecutionWindow: false,
  cohort: { common: 2, added: 1, removed: 0 },
  rows: [
    {
      section: "defects",
      label: "Retained defect count",
      baseline: null,
      target: 2,
      delta: null,
      note: "No import is not zero",
    },
    {
      section: "execution",
      label: "Recorded failed results",
      baseline: 3,
      target: 1,
      delta: -2,
      note: "Neutral change, not verified repair",
    },
  ],
  limitations: ["Not a stored approval"],
  sourceLimitations: {
    baseline: ["Baseline original evidence boundary"],
    target: ["Later original evidence boundary"],
  },
};

test("aggregate CSV keeps selected recorded metrics, exact windows, missing evidence and original limits without identities/commentary", () => {
  const value = renderFrozenReportCsv(report);
  assert.ok(
    value.startsWith(
      '\uFEFF"Row type","Section","Label","Recorded value","Evidence note"\r\n',
    ),
  );
  assert.ok(value.includes('"Metric","execution","Blocked results","2"'));
  assert.ok(value.includes('"Planned pairs without a result","2"'));
  assert.ok(value.includes('"Defect evidence","Excluded from this scope"'));
  assert.ok(
    value.includes(report.windowStart) && value.includes(report.windowEnd),
  );
  assert.ok(
    value.includes("No runtime acceptance") &&
      value.includes("Selected recorded run"),
  );
  assert.ok(!value.includes('"Metric","inventory"'));
  for (const omitted of [
    "raw-private-plan",
    "raw-private-run",
    "raw-private-cohort",
    "raw-private-case",
    "secret author summary",
    "secret author risks",
    "secret author next steps",
  ])
    assert.ok(!value.includes(omitted), omitted);
});

test("author text is escaped and formula protected without treating numeric-looking strings as numbers", () => {
  for (const dangerous of [
    '=HYPERLINK("https://external.invalid")',
    "+cmd",
    "-cmd",
    "@SUM(1)",
    "  =1+1",
    "\t=1+1",
    "\r=1+1",
    "\n=1+1",
    "\uFEFF=1+1",
  ]) {
    const value = renderFrozenReportCsv({ ...report, title: dangerous });
    assert.ok(
      value.includes(`"Report title","'${dangerous.replaceAll('"', '""')}"`),
    );
  }
  const plain = renderFrozenReportCsv({
    ...report,
    title: 'Line one, "quoted"\r\nLine two',
  });
  assert.ok(plain.includes('"Line one, ""quoted""\r\nLine two"'));
  assert.ok(
    renderFrozenReportCsv({ ...report, title: "00123" }).includes(
      '"Report title","00123"',
    ),
  );
});

test("preview, unsupported numeric/control values and oversized exports refuse without silent partial output", () => {
  assert.throws(
    () => renderFrozenReportCsv({ ...report, state: "preview" }),
    /Approve/,
  );
  assert.throws(
    () => renderFrozenReportCsv({ ...report, title: "bad\u0000text" }),
    /control/,
  );
  assert.throws(
    () =>
      renderFrozenReportCsv({
        ...report,
        execution: { ...report.execution, results: Infinity },
      }),
    /numeric/,
  );
  assert.throws(
    () =>
      renderFrozenReportCsv({ ...report, limitations: ["x".repeat(32769)] }),
    /cell/,
  );
  assert.throws(
    () =>
      renderFrozenReportCsv({
        ...report,
        limitations: Array(1001).fill("retained boundary"),
      }),
    /row limit/,
  );
  assert.throws(
    () =>
      renderFrozenReportCsv({
        ...report,
        limitations: Array(80).fill("界".repeat(8000)),
      }),
    /one MiB/,
  );
});

test("neutral comparison CSV preserves unavailable, zero, numeric negative deltas, unequal windows and both original boundaries", () => {
  const value = renderReportComparisonCsv(comparison);
  assert.ok(
    value.includes('"Retained defect count","Unavailable","2","Unavailable"'),
  );
  assert.ok(value.includes('"Recorded failed results","3","1","-2"'));
  assert.ok(!value.includes('"\'-2"'));
  assert.ok(value.includes('"Removed active identities in later capture","0"'));
  assert.ok(value.includes("Unequal execution windows"));
  assert.ok(
    value.includes("Baseline original evidence boundary") &&
      value.includes("Later original evidence boundary"),
  );
  assert.ok(
    !value.includes("raw-private-snapshot") &&
      !value.includes("raw-private-project"),
  );
});

test("comparison retained labels are protected and bounded while numeric deltas remain literal", () => {
  const value = renderReportComparisonCsv({
    ...comparison,
    baseline: { ...capture, title: "=1+1" },
    rows: [{ ...comparison.rows[1], label: "\t@command", note: "  +note" }],
  });
  assert.ok(value.includes('"Capture title","\'=1+1"'));
  assert.ok(value.includes('"\'\t@command"') && value.includes('"\'  +note"'));
  assert.throws(
    () =>
      renderReportComparisonCsv({
        ...comparison,
        rows: [{ ...comparison.rows[0], target: NaN }],
      }),
    /numeric/,
  );
});

test("native snapshot and comparison export actions require the exact reviewed current payload", () => {
  const ui = readFileSync(
    new URL("../components/FrozenReport.tsx", import.meta.url),
    "utf8",
  ).replace(/\s+/g, " ");
  assert.match(ui, /allowExport && report.state === "approved"/);
  assert.match(ui, /review\?\.report === report/);
  assert.match(
    ui,
    /review.projectId === projectId && review.snapshotId === snapshotId/,
  );
  assert.match(ui, /if \(!exportAllowed \|\| !reviewed\) return/);
  assert.match(ui, /Download aggregate CSV/);
  assert.match(ui, /No partial CSV was downloaded/);
  const compare = readFileSync(
    new URL("../components/ReportSnapshotComparison.tsx", import.meta.url),
    "utf8",
  ).replace(/\s+/g, " ");
  assert.match(compare, /reviewedData === data/);
  assert.match(compare, /if \(!data \|\| !reviewed\) return/);
  assert.match(compare, /!query.error && !query.isFetching && !query.isPaused/);
  assert.match(compare, /Download comparison CSV/);
});
