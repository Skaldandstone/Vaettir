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
  assert.match(csv, /'\=SUM\(A1\)/);
  assert.match(csv, /Baseline title is excerpt/);
  assert.match(csv, /,"true",/);
  assert.match(csv, /NOT_IN_SAVED_SCOPE/);
  assert.match(csv, /Current page: 1 of 851/);
  assert.match(csv, /Current case ID label \(not captured\)/);
  assert.doesNotMatch(csv, /PRIVATE-/);
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
