import { test } from "node:test";
import assert from "node:assert/strict";
import {
  requirementCoverageExportPlan,
  renderRequirementCoverageHtml,
} from "./requirement-coverage-export.ts";
import { renderBoundedSpreadsheetCsv } from "../../../packages/core/src/spreadsheetCsv.ts";

// SOURCE ONLY: authored 2026-10-04, NOT RUN. Pure fixtures do not prove API authorization or rendered downloads.
const counts = () => ({
  PASS: 1,
  FAIL: 1,
  FLAKY: 0,
  SKIP: 0,
  BLOCKED: 0,
  total: 2,
  state: "RECORDED_OUTCOMES",
});
const empty = () => ({
  PASS: 0,
  FAIL: 0,
  FLAKY: 0,
  SKIP: 0,
  BLOCKED: 0,
  total: 0,
  state: "NO_RECORDED_RESULT",
});
function sample() {
  const linked = (ordinal) => ({
    requirementOrdinal: ordinal,
    requirementTitle: `Synthetic requirement ${ordinal}`,
    titleIsExcerpt: false,
    case: {
      displayId: "SYN-01",
      title: "Synthetic case",
      titleIsExcerpt: false,
      archived: true,
    },
    outcomes: counts(),
    plannedWithoutResult: 2,
  });
  return {
    version: 1,
    projectId: "raw-project-private",
    organizationId: "raw-org-private",
    actorClerkUserId: "raw-actor-private",
    requested: "raw-request-private",
    observedAt: "2026-10-04T12:00:00.000Z",
    window: {
      start: "2026-10-01T00:00:00.000Z",
      end: "2026-10-04T12:00:00.000Z",
    },
    appliedScope: {
      platform: "Synthetic PC",
      planId: "raw-plan-private",
      runId: "raw-run-private",
    },
    searchPresence: true,
    selection: { mode: "SEARCH_OR_ALL", requirementCount: 3 },
    population: {
      requirements: 3,
      unlinkedRequirements: 1,
      directPairs: 2,
      distinctCases: 1,
      archivedCases: 1,
      distinctCaseResultRecords: 2,
      distinctCaseOutcomes: counts(),
    },
    rows: [
      linked(1),
      linked(2),
      {
        requirementOrdinal: 3,
        requirementTitle: "Synthetic unlinked",
        titleIsExcerpt: true,
        case: null,
        outcomes: empty(),
        plannedWithoutResult: 0,
      },
    ],
    limits: ["Synthetic source boundary, not requirement fulfilment"],
  };
}
test("complete matrix keeps repeated relationships separate from unique-case results and omits raw scope identity", () => {
  const value = sample(),
    plan = requirementCoverageExportPlan(value),
    csv = renderBoundedSpreadsheetCsv(plan.headers, plan.rows, 1100);
  assert.equal(
    plan.rows.filter((row) => row[0] === "Direct case relationship").length,
    2,
  );
  assert.equal(
    plan.rows.filter((row) => row[0] === "Unlinked requirement").length,
    1,
  );
  assert.ok(
    plan.rows.some(
      (row) =>
        row[0] === "Distinct population" &&
        row[1] === "distinctCaseResultRecords" &&
        row[2] === 2,
    ),
  );
  for (const token of [
    "raw-project-private",
    "raw-org-private",
    "raw-actor-private",
    "raw-request-private",
    "raw-plan-private",
    "raw-run-private",
  ])
    assert.ok(!csv.includes(token));
  assert.ok(csv.includes("SYN-01"));
  assert.ok(csv.includes("literal text omitted"));
  assert.ok(csv.includes("No direct links"));
  assert.ok(!Object.hasOwn(plan, "source"));
});
test("portable matrix escapes titles, denies assets/scripts and labels excerpt/zero/current boundaries", () => {
  const value = sample();
  value.rows[0].requirementTitle =
    '<script src="https://example.invalid/private">&';
  value.rows[0].case.title = '<img src="x" onerror="alert(1)">';
  value.rows[1].case.title = value.rows[0].case.title;
  const html = renderRequirementCoverageHtml(value);
  assert.ok(
    html.includes(
      "&lt;script src=&quot;https://example.invalid/private&quot;&gt;&amp;",
    ),
  );
  assert.ok(!/<script\b|<img\b|<a\b|<iframe\b|<link\b/i.test(html));
  assert.ok(html.includes("default-src 'none'"));
  assert.ok(html.includes("form-action 'none'"));
  assert.ok(html.includes("HTML v1"));
  assert.ok(!html.includes("CSV v1"));
  assert.ok(html.includes("Read-time export, not an approved frozen report"));
  assert.ok(html.includes("NO_RECORDED_RESULT"));
});
test("inconsistent counts, missing rows, duplicated pairs and conflicting repeated case metadata refuse whole export", () => {
  const edits = [
    (v) => v.rows.pop(),
    (v) => v.population.directPairs++,
    (v) => v.rows.push(structuredClone(v.rows[0])),
    (v) => v.population.distinctCaseOutcomes.PASS++,
    (v) => (v.rows[1].case.archived = false),
    (v) => v.rows[1].outcomes.total++,
    (v) => (v.rows[2].plannedWithoutResult = 1),
    (v) => (v.rows[2].requirementOrdinal = 9),
    (v) => (v.population.archivedCases = 0),
    (v) => (v.population.distinctCaseResultRecords = NaN),
    (v) => (v.rows[0].outcomes.BLOCKED = -1),
  ];
  for (const edit of edits) {
    const value = sample();
    edit(value);
    assert.throws(() => requirementCoverageExportPlan(value));
    assert.throws(() => renderRequirementCoverageHtml(value));
  }
});
test("empty selected population exports literal zeros without claiming coverage or PASS", () => {
  const value = sample();
  value.rows = [];
  value.selection.requirementCount = 0;
  value.population = {
    requirements: 0,
    unlinkedRequirements: 0,
    directPairs: 0,
    distinctCases: 0,
    archivedCases: 0,
    distinctCaseResultRecords: 0,
    distinctCaseOutcomes: empty(),
  };
  const html = renderRequirementCoverageHtml(value);
  assert.ok(html.includes("0 distinct-case recorded results"));
  assert.ok(
    html.includes(
      "No current requirements match this selection. This is not a finding of complete coverage.",
    ),
  );
});
test("unsafe Unicode, controls, scope, dates, ordinal identity and bounded population refuse", () => {
  const edits = [
    (v) => (v.rows[0].requirementTitle = "bad\u0000text"),
    (v) => (v.rows[0].case.title = "bad\uD800"),
    (v) => (v.appliedScope.environment = "x".repeat(2001)),
    (v) => (v.appliedScope.unknown = "bad"),
    (v) => (v.window.end = "2030-01-01T00:00:00.000Z"),
    (v) => (v.observedAt = "invalid"),
    (v) => (v.rows[1].requirementOrdinal = 1),
    (v) => (v.selection.requirementCount = 1001),
    (v) => (v.limits = Array(21).fill("synthetic")),
  ];
  for (const edit of edits) {
    const value = sample();
    edit(value);
    assert.throws(() => requirementCoverageExportPlan(value));
  }
});
test("literal title formula text is protected by shared CSV encoder without changing numeric recorded counts", () => {
  const value = sample();
  value.rows[0].requirementTitle = "=SYNTHETIC()";
  const plan = requirementCoverageExportPlan(value),
    csv = renderBoundedSpreadsheetCsv(plan.headers, plan.rows, 1100);
  assert.ok(csv.includes('"\'=SYNTHETIC()"'));
  assert.ok(csv.includes('"1","1","0","0","0","2","2"'));
});
