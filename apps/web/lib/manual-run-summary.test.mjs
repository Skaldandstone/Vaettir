import assert from "node:assert/strict";
import test from "node:test";
import { manualSummaryReadActivation, manualSummaryScopeMatches, renderManualRunSummaryCsv, sameManualSummaryExport, validateManualRunSummary } from "./manual-run-summary.ts";
import { summaryFixture } from "./manual-run-summary.fixture.mjs";
test("complete manual totals count per-run instances and keep blocked/skip/partial/excluded separate", () => {
  const { value } = summaryFixture(); assert.equal(validateManualRunSummary(value), value);
  assert.equal(value.totals.plannedInstances, 1702); assert.equal(value.totals.recordedInstances, 3);
  assert.equal(value.totals.partialStepInstances, 1); assert.equal(value.totals.remainingInstances, 1699);
  const empty = structuredClone(value); for (const counts of [empty.totals, ...empty.days]) { for (const key of Object.keys(counts)) if (typeof counts[key] === "number") counts[key] = 0; for (const key of Object.keys(counts.outcomes)) counts.outcomes[key] = 0; for (const key of Object.keys(counts.exclusions)) counts.exclusions[key] = 0; }
  assert.equal(validateManualRunSummary(empty), empty);
});
test("missing/reordered days and inconsistent/unsupported counts refuse instead of zero/cohort substitution", () => {
  for (const mutation of [value => value.days.pop(), value => value.days.reverse(), value => value.totals.recordedInstances++, value => value.days[0].partialStepInstances = 849, value => value.totals.plannedInstances = NaN, value => value.scope.start = "2026-02-30", value => value.asOf = "invalid"]) {
    const { value } = summaryFixture(); mutation(value); assert.throws(() => validateManualRunSummary(value)); assert.throws(() => renderManualRunSummaryCsv(value));
  }
});
test("fresh echo requires exact original actor/project/org, prefixed request key and recorded filters", () => {
  const { value, input, requestKey } = summaryFixture();
  assert.equal(manualSummaryScopeMatches(value, input, "synthetic-actor", requestKey), true);
  for (const patch of [{ projectId: "other" }, { organizationId: "other" }, { clerkActorId: "other" }, { requestKey: requestKey.slice(18) }, { scope: { ...value.scope, environment: "Changed bench" } }, { scope: { ...value.scope, end: "2026-01-01" } }]) assert.equal(manualSummaryScopeMatches({ ...value, ...patch }, input, "synthetic-actor", requestKey), false);
});
test("reviewed metadata CSV preserves complete dates/counts/exclusions/filters and excludes incidental raw/private fields", () => {
  const { value } = summaryFixture(), csv = renderManualRunSummaryCsv({ ...value, notes: "PRIVATE-NOTE", cases: [{ title: "PRIVATE-CASE" }], clerkActorId: "PRIVATE-ACTOR", totals: { ...value.totals, note: "PRIVATE-TOTAL" } });
  for (const text of ["2026-01-01 through 2026-01-02", value.asOf, "1702", "1699", "Partial-step instances", "Blocked", "Unsupported saved scope", "Excluded runs", "No raw cases", "No release readiness", "2026-01-01", "2026-01-02"]) assert.ok(csv.toLowerCase().includes(text.toLowerCase()), text);
  assert.match(csv, /'=SUM\(A1\)/); assert.doesNotMatch(csv, /PRIVATE-/);
  const excessive = { ...value, limitations: ["x".repeat(4001)] }; assert.throws(() => renderManualRunSummaryCsv(excessive), /No text was truncated/);
});
test("export review is revoked by data refresh, scope/access epoch, unmount and revision changes", () => {
  const { value } = summaryFixture(), reviewed = { ready: true, value, epoch: 2, revision: 10 };
  assert.equal(sameManualSummaryExport(reviewed, { ...reviewed }), true);
  for (const current of [{ ...reviewed, ready: false }, { ...reviewed, value: null }, { ...reviewed, value: structuredClone(value) }, { ...reviewed, epoch: 3 }, { ...reviewed, revision: 11 }]) assert.equal(sameManualSummaryExport(reviewed, current), false);
  assert.equal(sameManualSummaryExport(null, reviewed), false);
});
test("actual read activation controller hides cached counts on reopen/scope/session recovery until a later read revision", () => {
  let state = { ready: false, key: "key", sessionId: "session", baseline: 100, epoch: 1 };
  const current = { ready: true, key: "key", sessionId: "session", revision: 100 };
  let result = manualSummaryReadActivation(state, current); assert.equal(result.fresh, false); state = result.state;
  assert.equal(manualSummaryReadActivation(state, current).fresh, false);
  assert.equal(manualSummaryReadActivation(state, { ...current, revision: 101 }).fresh, true);
  state = manualSummaryReadActivation(state, { ...current, ready: false, revision: 101 }).state;
  state = manualSummaryReadActivation(state, { ...current, revision: 101 }).state;
  assert.equal(manualSummaryReadActivation(state, { ...current, revision: 101 }).fresh, false);
  assert.equal(manualSummaryReadActivation(state, { ...current, revision: 102 }).fresh, true);
  assert.equal(manualSummaryReadActivation(state, { ...current, key: "different applied scope", revision: 102 }).fresh, false);
  assert.equal(manualSummaryReadActivation(state, { ...current, sessionId: "other session", revision: 102 }).fresh, false);
});
