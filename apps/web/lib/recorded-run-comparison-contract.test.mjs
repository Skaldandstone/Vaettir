// Authored source contracts. Real query-cache/mobile checks remain morning work.
import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
const source = readFileSync(
    new URL("../components/RecordedRunComparison.tsx", import.meta.url),
    "utf8",
  ),
  flat = source.replace(/\s+/g, " ");
test("scoped cached error fetching pause or wrong selected identities cannot expose comparison", () => {
  for (const guard of [
    "key={projectId}",
    "!catalog.error",
    "!catalog.isFetching",
    "!catalog.isPaused",
    "!query.error",
    "!query.isFetching",
    "!query.isPaused",
    "query.data.requestId === applied.requestId",
    "query.data.baseline.id === applied.baselineRunId",
    "query.data.candidate.id === applied.candidateRunId",
  ])
    assert.ok(flat.includes(guard), guard);
  assert.ok(flat.includes("Cached run choices and comparisons are withheld"));
});
test("neutral result and missing context labels never promise regression or retry classification", () => {
  for (const text of [
    "Comparable configuration/test-definition context unavailable",
    "No recorded result in this run",
    "FLAKY (reported)",
    "Recorded status counts differ",
    "No candidate mapped result",
    "No baseline mapped result",
    "Unavailable links",
    "Not comparable performance evidence",
  ])
    assert.ok(flat.includes(text), text);
  assert.ok(!source.includes("useMutation"));
});
test("native case and run chips and bounded scrolling remain accessible", () => {
  for (const text of [
    "test-cases/${encodeURIComponent(item.caseId)}",
    "test-runs#run-${encodeURIComponent(side.run.id)}",
    "item.displayId",
    "titleClipped",
    "tabIndex={0}",
    "Recorded case observations",
    "Older recorded runs",
    "Restart current run catalog",
  ])
    assert.ok(source.includes(text), text);
});
test("page reversal keeps pair fingerprint and changing selections cannot retain wrong results", () => {
  assert.ok(source.includes("expectedPairHash: result.pairHash"));
  assert.ok(source.includes("setApplied(null)"));
  assert.ok(source.includes("setHistory([])"));
  assert.ok(flat.includes("Retry same comparison page"));
  assert.ok(flat.includes("Restart selected comparison"));
});
test("fresh project member Clerk and original echo guard cached choices and results without identity-key remount", () => {
  for (const value of ["useAuth", "project.isFetchedAfterMount", "organizations.isFetchedAfterMount", "!project.isFetching", "!project.isPaused", "!organizations.isFetching", "!organizations.isPaused", "origin.clerkActorId !== userId", "origin.organizationId !== project.data?.organizationId", "enabled: ready", "catalog.data.organizationId === origin?.organizationId", "catalog.data.clerkActorId === userId", "query.data.organizationId === origin?.organizationId", "query.data.clerkActorId === userId", "originalOrganizationId: origin?.organizationId", "expectedClerkActorId: origin?.clerkActorId"])
    assert.ok(source.includes(value), value);
  assert.ok(!source.includes("key={userId}"));
  assert.ok(!source.includes("key={origin"));
});
test("identity or membership loss retains selected runs and paging rather than rebinding cached human choices", () => {
  assert.ok(flat.includes("Your baseline, candidate and page selections remain retained"));
  assert.ok(flat.includes("Recheck original comparison access"));
  const scopeEffect = source.slice(source.indexOf("useEffect(() =>"), source.indexOf("const identityChanged"));
  for (const destructive of ["setBaseline", "setCandidate", "setApplied", "setHistory", "setCatalogInput"])
    assert.ok(!scopeEffect.includes(destructive), destructive);
  assert.ok(source.includes("disabled={!ready}"));
});
