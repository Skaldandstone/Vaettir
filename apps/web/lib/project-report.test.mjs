import { test } from "node:test";
import assert from "node:assert/strict";
import { outcomePassShare, renderProjectReportMarkdown, renderProjectReportCsv, DEFAULT_REPORT_CASE_FILTERS } from "./project-report.ts";

const fixture = {
  asOf: "2026-09-30T07:00:00.000Z", windowStart: "2026-09-23T07:00:00.000Z",
  inventory: { active: 2, archived: 1, withSource: 1, riskAssessed: 0, flaky: 0,
    byType: [{ key: "FUNCTIONAL", count: 2 }], byPriority: [{ key: "HIGH", count: 2 }], byReview: [{ key: "APPROVED", count: 2 }] },
  requirements: { total: 1, withCriteria: 1, linkedCriteria: 1, criteria: [{ key: "MET", count: 1 }] },
  execution: { runs: 1, byRunStatus: [{ key: "PARTIAL", count: 1 }], results: 4, matchedResults: 2,
    byResultStatus: [{ key: "PASS", count: 1 }, { key: "FAIL", count: 1 }, { key: "SKIP", count: 1 }, { key: "BLOCKED", count: 1 }] },
  recentRuns: [{ id: "run-1", ciProvider: "synthetic", status: "PARTIAL", startedAt: "2026-09-30T06:00:00.000Z", branch: "main", commitSha: "abc", resultCount: 4 }],
  caseQuery: null,
};

test("pass share uses executed verdicts, excludes skipped and blocked", () => {
  assert.equal(outcomePassShare(fixture), 50);
  assert.equal(outcomePassShare({ ...fixture, execution: { ...fixture.execution, byResultStatus: [{ key: "SKIP", count: 5 }] } }), null);
});

test("generated report states source, window and boundaries without overstating readiness", () => {
  const markdown = renderProjectReportMarkdown("Demo", fixture);
  assert.match(markdown, /Generated: 2026-09-30T07:00:00.000Z/);
  assert.match(markdown, /2026-09-23T07:00:00.000Z to 2026-09-30T07:00:00.000Z/);
  assert.match(markdown, /Outcome pass share.*50%/);
  assert.match(markdown, /not a release-readiness or deployed-code claim/);
  assert.match(markdown, /Active cases: 2/);
  assert.match(markdown, /Results linked to a case: 2/);
});

test("untrusted project/provider text cannot inject Markdown sections or links", () => {
  const markdown = renderProjectReportMarkdown("Bad](/evil)\n# Surprise", { ...fixture,
    recentRuns: [{ ...fixture.recentRuns[0], ciProvider: "[provider](https://evil.example)" }] });
  assert.doesNotMatch(markdown, /^# Surprise/m);
  assert.doesNotMatch(markdown, /\[provider\]\(https:\/\/evil.example\)/);
  assert.match(markdown, /Bad\\\]\\\(\/evil\\\)/);
});

test("manual runs do not present their placeholder branch and commit as source evidence", () => {
  const markdown = renderProjectReportMarkdown("Demo", { ...fixture,
    recentRuns: [{ ...fixture.recentRuns[0], ciProvider: "manual", branch: "manual", commitSha: "manual" }] });
  assert.match(markdown, /manual execution \(no commit reference\)/);
  assert.doesNotMatch(markdown, /manual · manual · ID/);
});

test("saved case query is explicitly scoped and generated output preserves project-wide boundary", () => {
  const scoped = { ...fixture, caseQuery: {
    source: "saved", name: "High priority", filters: { ...DEFAULT_REPORT_CASE_FILTERS, priority: "HIGH" },
    total: 1, active: 1, archived: 0, withSource: 1, riskAssessed: 0, flaky: 0,
    byType: [{ key: "FUNCTIONAL", count: 1 }], byPriority: [{ key: "HIGH", count: 1 }], byReview: [],
    sample: [{ id: "case-1", title: "Payment", testType: "FUNCTIONAL", priority: "HIGH", archived: false }],
  } };
  const markdown = renderProjectReportMarkdown("Demo", scoped);
  const csv = renderProjectReportCsv("Demo", scoped);
  assert.match(markdown, /Case query \(current inventory only\)/);
  assert.match(markdown, /Execution and requirement sections below remain project-wide/);
  assert.match(markdown, /Matching cases: 1/);
  assert.match(csv, /"case_query","total","1"/);
  assert.match(csv, /"project_case_inventory","active","2"/);
  assert.match(csv, /"project_requirements","total","1"/);
});

test("CSV quotes user content and neutralizes spreadsheet formulas", () => {
  const csv = renderProjectReportCsv("=HYPERLINK(\"https://evil.example\")", {
    ...fixture, caseQuery: { source: "preview", name: null,
      filters: { ...DEFAULT_REPORT_CASE_FILTERS, search: "\t+SUM(1,1)" },
      total: 0, active: 0, archived: 0, withSource: 0, riskAssessed: 0, flaky: 0,
      byType: [], byPriority: [], byReview: [], sample: [] },
  });
  assert.match(csv, /"'=HYPERLINK\(""https:\/\/evil\.example""\)"/);
  assert.match(csv, /"'\t\+SUM\(1,1\)"/);
  assert.match(csv, /"as_of_utc"/);
});
