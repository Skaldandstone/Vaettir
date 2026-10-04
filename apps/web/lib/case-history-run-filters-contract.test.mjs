// SOURCE ONLY: authored NOT RUN. Not rendered/Clerk/QueryClient acceptance.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = readFileSync(new URL("../components/TestCaseExecutionHistory.tsx", import.meta.url), "utf8");

test("recorded source and overall run dropdowns are reviewed drafts, not case outcome classifiers", () => {
  for (const value of ["Recorded source", "Overall run status", "All recorded sources", "All run statuses",
    "Overall run status is not this case's outcome", "do not by themselves verify automation", "recordedSources.find", "overallStatuses.find",
    "applied.recordedSource", "applied.runStatus", "filterDraft.recordedSource", "filterDraft.runStatus"])
    assert.ok(source.includes(value), value);
  assert.ok(source.includes("setApplied(filterDraft); setAnchors([undefined])"));
  assert.ok(!source.includes("setSelectedRetest(null); setApplied"));
});
test("date conveniences change explicit draft dates only behind fresh access and preserve selected retest workflow", () => {
  const chooser = source.slice(source.indexOf("function chooseDateShortcut()"), source.indexOf("  return (", source.indexOf("function chooseDateShortcut()")));
  assert.ok(chooser.includes("!ready || denied || paused || !filtersOpen || !dateShortcut"));
  assert.ok(chooser.includes("resolveExecutionDatePreset(dateShortcut)"));
  assert.ok(chooser.includes("setFilterDraft(current => ({ ...current, ...dates }))"));
  assert.ok(!chooser.includes("setApplied"));
  assert.ok(!chooser.includes("setAnchors"));
  assert.ok(!chooser.includes("setSelectedRetest"));
  assert.ok(source.includes("This combined scope will have no matching runs"));
});
test("server-key/original actor guards still withhold unmatched cached pages and pending retest stays mounted", () => {
  for (const value of ["history.data.requested === caseHistoryRequestKey(input)", "history.data.actorClerkUserId === userId",
    "history.data.organizationId === originalOrganizationId", "!history.error && !history.isFetching && !history.isPaused",
    "{selectedRetest && <section", "active={!!page}", "onRetainedRequestChange={setRetainedRetest}"])
    assert.ok(source.includes(value), value);
  assert.ok(!source.includes("useMutation"));
});
test("native configuration labels preserve literal text and distinguish known empty from unavailable metadata", () => {
  const service = readFileSync(new URL("../../api/src/services/caseExecutionHistory.ts", import.meta.url), "utf8");
  for (const key of ["platform", "build", "environment"]) {
    assert.ok(service.includes(`${key}: frozen?.${key} ?? null`));
    assert.ok(!service.includes(`frozen?.${key}.trim()`));
  }
  for (const label of ["Platform not recorded", "Platform left blank", "Build left blank", "Environment left blank", 'whiteSpace: "pre-wrap"', "item.environment !== null"])
    assert.ok(source.includes(label), label);
});
