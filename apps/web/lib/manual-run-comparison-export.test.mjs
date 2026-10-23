import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { renderManualRunComparisonCsv, renderManualRunComparisonJson } from "./manual-run-comparison-export.ts";
const hash = "a".repeat(64);
const run = { id: "synthetic-run", status: "PARTIAL", startedAt: "2026-01-01T00:00:00.000Z", finishedAt: null, plannedCases: 851, scopeUnsupported: false, versionOneSnapshotPresent: true };
const summary = { pass: 1, fail: 0, blocked: 0, skip: 0, flaky: 0, total: 851, recorded: 1, remaining: 850, percentComplete: 0.12, ignoredOutsideScopeResults: 1 };
const side = { title: "=SUM(A1)", titleClipped: true, definitionHash: hash, outcome: "PASS" };
const value = { projectId: "synthetic-project", organizationId: "synthetic-org", clerkActorId: "PRIVATE-ACTOR", requestId: "PRIVATE-REQUEST", requestKey: "PRIVATE-AUTH-ECHO", pairHash: hash, baseline: run, candidate: { ...run, id: "candidate" }, baselineSummary: summary, candidateSummary: summary, configuration: { baselineHash: hash, candidateHash: hash, sameRecordedConfiguration: true }, unionCaseCount: 851, items: [{ caseId: "case-1", currentCaseIdLabel: "TC-1", baseline: side, candidate: null, definitionState: "BASELINE_ONLY" }], nextCursor: { caseId: "case-1", expectedPairHash: hash }, limitations: ["Current recorded comparison, not verified recovery; not full history/media"] };
test("CSV exports only this page, neutralizes formulas, marks clipped titles and preserves absent-scope distinction", () => {
  const csv = renderManualRunComparisonCsv(value);
  assert.match(csv, /'=SUM\(A1\)/);
  assert.match(csv, /Baseline title is excerpt/);
  assert.match(csv, /,"true",/);
  assert.match(csv, /NOT_IN_SAVED_SCOPE/);
  assert.match(csv, /Current page: 1 of 851/);
  assert.match(csv, /Current case ID label \(not captured\)/);
  assert.doesNotMatch(csv, /PRIVATE-/);
  assert.match(csv, /COMPARISON_PAGE_METADATA/);
  assert.match(csv, /CASE_COMPARISON/);
  assert.match(csv, /851 planned, 1 recorded, 850 without a verdict/);
});
test("empty comparison CSV retains both exact runs and page context without fabricated cases or percent completion", () => {
  const emptySummary = { ...summary, total: 0, recorded: 0, remaining: 0, pass: 0, percentComplete: 0, ignoredOutsideScopeResults: 0 };
  const empty = { ...value, baseline: { ...run, plannedCases: 0 }, candidate: { ...run, id: "candidate-empty", plannedCases: 0 }, baselineSummary: emptySummary, candidateSummary: emptySummary, unionCaseCount: 0, items: [], nextCursor: null, private: "PRIVATE-INCIDENTAL" };
  const csv = renderManualRunComparisonCsv(empty);
  const rows = csv.slice(1).trimEnd().split("\r\n");
  assert.equal(rows.length, 2, "header plus one report-context row, not a synthetic case");
  assert.match(rows[1], /"synthetic-project","synthetic-run","candidate-empty","2026-01-01T00:00:00.000Z","2026-01-01T00:00:00.000Z"/);
  assert.ok(rows[1].includes(`"${hash}"`));
  assert.match(csv, /Current page: 0 of 0 union cases/);
  assert.match(csv, /Baseline: PARTIAL; finished not recorded; 0 planned, 0 recorded, 0 without a verdict/);
  assert.match(csv, /Candidate: PARTIAL; finished not recorded; 0 planned, 0 recorded, 0 without a verdict/);
  assert.match(csv, /Recorded is not passed or release readiness/);
  assert.ok(rows[1].includes(`"${hash}",${Array(11).fill('""').join(",")},"Current page:`));
  assert.doesNotMatch(csv, /CASE_COMPARISON|NOT_IN_SAVED_SCOPE|\b(?:0|100)%|PRIVATE-/);
});
test("full fifty-case page retains all original cases plus one bounded metadata row", () => {
  const items = Array.from({ length: 50 }, (_, i) => ({ ...value.items[0], caseId: `case-${i}` }));
  const csv = renderManualRunComparisonCsv({ ...value, items });
  assert.equal(csv.match(/"COMPARISON_PAGE_METADATA"/g)?.length, 1);
  assert.equal(csv.match(/"CASE_COMPARISON"/g)?.length, 50);
  for (const item of items) assert.ok(csv.includes(`"${item.caseId}"`));
  assert.match(csv, /Current page: 50 of 851 union cases/);
});
test("JSON whitelists recorded report metadata and omits incidental actor/private content at every level", () => {
  const injected = { ...value, note: "PRIVATE-TOP", baseline: { ...run, note: "PRIVATE-RUN" }, items: [{ ...value.items[0], note: "PRIVATE-ROW", baseline: { ...side, error: "PRIVATE-CASE", source: "PRIVATE-SOURCE" } }] };
  const content = renderManualRunComparisonJson(injected), json = JSON.parse(content);
  assert.equal(json.kind, "current_manual_run_comparison_page");
  assert.equal(json.items[0].baseline.title, "=SUM(A1)");
  assert.equal(json.items[0].baseline.titleClipped, true);
  assert.equal(json.items[0].candidate, null);
  assert.equal(json.unionCaseCount, 851);
  assert.equal(json.baseline.startedAt, run.startedAt);
  assert.match(json.exportScope, /not all pages or full procedures\/notes\/history\/media/);
  assert.doesNotMatch(content, /PRIVATE-/);
});
test("overscope and repeated comparison rows refuse without slicing", () => {
  for (const render of [renderManualRunComparisonCsv, renderManualRunComparisonJson]) {
    assert.throws(() => render({ ...value, items: [value.items[0], value.items[0]] }), /ambiguous/);
    assert.throws(() => render({ ...value, items: Array.from({ length: 51 }, (_, i) => ({ ...value.items[0], caseId: `case-${i}` })) }), /Unsupported/);
  }
  assert.throws(() => renderManualRunComparisonJson({ ...value, limitations: ["x".repeat(16 * 1024 * 1024)] }), /16 MiB/);
});
test("mounted comparison gates exact echoes, revokes exports on unmount and only downloads the already-present page", () => {
  const source = readFileSync(new URL("../components/ManualRunComparison.tsx", import.meta.url), "utf8");
  assert.match(source, /return \(\) => \{ current\.current = \{ ready: false, value: null \}; \}/);
  assert.match(source, /comparison\.data\?\.requestKey === manualRunComparisonRequestKey\(comparisonInput\)/);
  assert.match(source, /current\.current\.value\?\.requestKey !== original\.value\.requestKey/);
  assert.match(source, /current\.current\.value\.pairHash !== original\.value\.pairHash/);
  assert.match(source, /setExpectedPairHash\(value\.pairHash\)/);
  assert.doesNotMatch(source, /\.useMutation\(|\bfetch\(|\.executionContext/);
});
