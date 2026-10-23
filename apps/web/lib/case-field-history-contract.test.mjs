// Authored source contracts only; morning acceptance must use real TanStack cache/browser behavior.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (name) => readFileSync(new URL(name, import.meta.url), "utf8");
test("metadata history is scoped, lazy, paged and clear about legacy/current-profile provenance", () => {
  const source = read("../components/CaseFieldHistory.tsx");
  assert.match(source, /key=\{`\$\{projectId\}:\$\{caseId\}`\}/);
  assert.match(source, /enabled:\s*expanded/);
  assert.match(source, /take:\s*10/);
  assert.match(source, /Older metadata records/);
  assert.match(source, /Newest metadata records/);
  assert.match(source, /current profile/);
  assert.match(source, /Older procedure\s+snapshots cannot reconstruct/);
  assert.match(
    read("../components/CaseCustomFields.tsx"),
    /<CaseFieldHistory projectId=\{projectId\} caseId=\{caseId\}/,
  );
});
test("restore comparison rejects cached error fetching or paused state and requires fresh exact selection", () => {
  const source = read("../components/CaseFieldHistory.tsx");
  assert.match(
    source,
    /!query\.error\s*&&\s*!query\.isFetching\s*&&\s*!query\.isPaused/,
  );
  assert.match(source, /query\.data\.auditId === selection\.auditId/);
  assert.match(source, /query\.data\.side === selection\.side/);
  assert.match(source, /refetchOnMount:\s*"always"/);
  assert.match(
    source,
    /baseline\.expectedSourceHash !== fresh\.expectedSourceHash/,
  );
  assert.match(source, /fresh\.canRestore/);
  assert.match(source, /Cached values cannot authorize a\s+restore/);
  assert.match(source, /!ready \|\| !confirmed \|\| !reason\.trim\(\)/);
});
test("exact uncertain restore survives close and preserves separate captured current proposed values", () => {
  const source = read("../components/CaseFieldHistory.tsx");
  assert.match(source, /pending \?\? \{/);
  assert.match(source, /retainedCaseFieldReceipt\(attempt, error\)/);
  assert.match(source, /restore\.mutateAsync\(attempt\.input\)/);
  assert.match(source, /Closing this\s+dialog\s+does not discard it/);
  assert.match(source, /Retry exact metadata restore/);
  assert.match(source, /expectedSourceHash: baseline\.expectedSourceHash/);
  for (const label of [
    "Recorded value",
    "Current value",
    "Proposed value",
    "Treatment",
  ])
    assert.ok(source.includes(`<th>${label}</th>`));
  assert.match(source, /overflowX:\s*"auto"/);
  assert.match(source, /row\.treatment/);
});
