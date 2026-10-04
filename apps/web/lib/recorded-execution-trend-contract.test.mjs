// SOURCE ONLY, unexecuted; these assertions do not establish rendering/cache proof.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
const source = readFileSync(
  new URL("../components/RecordedExecutionTrend.tsx", import.meta.url),
  "utf8",
);
test("current project/member/actor and original-org echoes gate all cached evidence", () => {
  for (const expression of [
    /useAuth/,
    /!project.error/,
    /!organizations.error/,
    /origin\?\.actorId\s*===\s*userId/,
    /!query.error/,
    /!query.isFetching/,
    /!query.isPaused/,
    /query.data.clerkActorId\s*===\s*userId/,
    /recordedExecutionTrendKey\(applied\)/,
  ])
    assert.match(source, expression);
  assert.match(source, /No empty or\s+zero-count report is\s+substituted/);
});
test("date and exact-filter drafts apply explicitly; exports require exact current reviewed object", () => {
  assert.match(source, /recordedExecutionTrendInput.safeParse/);
  assert.match(source, /setApplied\(parsed.data\)/);
  assert.match(source, /reviewed\s*!==\s*data/);
  assert.match(source, /latest.current.data\s*!==\s*data/);
  assert.match(source, /not an immutable approved stakeholder\s+snapshot/);
  assert.match(source, /Check your browser downloads/);
});
test("accessible numeric outcomes and same-scope current run pages are not an inferred quality verdict", () => {
  assert.match(
    source,
    /Bar lengths share the largest displayed\s+period result\s+count/,
  );
  assert.match(source, /aria-hidden="true"/);
  assert.match(source, /day.outcomes\[status\]/);
  assert.match(
    source,
    /query.data.day\s*===\s*day\s*&&\s*query.data.page\s*===\s*page/,
  );
  assert.match(source, /test-runs#run-/);
  assert.match(
    source,
    /not unique attempts, a\s+flake rate or a release verdict/,
  );
});

test("grouping and included partial dates bind the exact export review and preserve day drilldown", () => {
  assert.match(source, /UTC weeks \(Monday start\)/);
  assert.match(source, /reviewedGrouping\s*!==\s*grouping/);
  assert.match(source, /latest.current.grouping\s*!==\s*grouping/);
  assert.match(source, /setReviewedGrouping\(null\)/);
  assert.match(
    source,
    /renderRecordedExecutionTrendCsv\(\s*data,\s*grouping,\s*includeRecordedDuration,?\s*\)/,
  );
  assert.match(source, /day.partialWeek/);
  assert.match(source, /setSelectedDay\(recordedDay.day\)/);
  assert.match(source, /Incomplete evidence is not displayed or\s+exported/);
});

test("duration evidence is explicit and optional columns cannot reuse a different export review", () => {
  assert.match(source, /Recorded duration and completion evidence/);
  assert.match(source, /Unknown duration is not zero/);
  assert.match(source, /period.missingDurations/);
  assert.match(source, /period.invalidDurations/);
  assert.match(source, /period.completionUnavailableRuns/);
  assert.match(source, /reviewedDuration\s*!==\s*includeRecordedDuration/);
  assert.match(
    source,
    /latest.current.includeRecordedDuration\s*!==\s*includeRecordedDuration/,
  );
  assert.match(source, /setReviewedDuration\(null\)/);
  assert.match(source, /seven\s+additional columns/);
});

test("date shortcuts require a separate action and never apply or replace the recorded scope implicitly", () => {
  assert.match(source, /Date shortcuts \(optional\)/);
  assert.match(source, /<select[\s\S]*value={datePreset}/);
  assert.match(source, /Use shortcut dates/);
  assert.match(source, /Date edits have not been applied/);
  const actionStart = source.indexOf("function useDateShortcut()");
  const actionEnd = source.indexOf("function applyScope", actionStart);
  assert.ok(actionStart >= 0 && actionEnd > actionStart);
  const action = source.slice(actionStart, actionEnd);
  assert.match(action, /if \(!sameOrigin\) return/);
  assert.match(action, /resolveExecutionDatePreset\(datePreset\)/);
  assert.match(action, /setDates\(next\)/);
  for (const forbidden of [
    "setApplied(",
    "refetch(",
    "mutate(",
    "setFilters(",
    "setReviewed(",
  ])
    assert.ok(!action.includes(forbidden), forbidden);
});
test("portable HTML format and fresh response revision invalidate exact export review synchronously", () => {
  assert.match(
    source,
    /renderRecordedExecutionTrendHtml\(\s*data,\s*grouping,\s*includeRecordedDuration,?\s*\)/,
  );
  assert.match(
    source,
    /previousExport.current.exportRevision !== exportRevision/,
  );
  assert.match(source, /reviewedEpoch !== exportEpoch.current/);
  assert.match(source, /latest.current.epoch !== reviewedEpoch/);
  assert.match(source, /reviewedFormat !== exportFormat/);
  assert.match(source, /latest.current.exportFormat !== exportFormat/);
  assert.match(source, /setReviewedFormat\(null\)/);
  assert.match(source, /epoch: -1/);
  assert.match(source, /File format/);
  assert.match(source, /does not generate or deliver a PDF/);
  assert.match(source, /finally\s*{\s*anchor.remove\(\)/);
});
