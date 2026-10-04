// Authored source contracts, not mounted browser acceptance. Do not run tonight.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (name) => readFileSync(new URL(name, import.meta.url), "utf8");
test("review is keyed to exact applied definition columns project request and fresh access", () => {
  const source = read("../components/CaseQueryExport.tsx").replace(/\s+/g, " ");
  for (const text of [
    "!approval.error",
    "!review.error",
    "!review.isFetching",
    "!review.isPaused",
    "!approval.isPaused",
    "review.data?.projectId === projectId",
    "review.data.organizationId === organizationId",
    "review.data.requestId === requestId",
    "JSON.stringify(review.data.columns) === JSON.stringify(columns)",
    "confirmed: true",
    "result.organizationId !== organizationId",
  ])
    assert.ok(source.includes(text), text);
  assert.match(
    source,
    /key=\{JSON\.stringify\(\[\s*organizationId,\s*projectId,\s*query,\s*columns,\s*requestKey,?\s*\]\)\}/,
  );
});
test("late confirms or closed dialogs cannot substitute downloads and renewed scope requires review", () => {
  const source = read("../components/CaseQueryExport.tsx").replace(/\s+/g, " ");
  for (const text of [
    "live.current.epoch !== launch.epoch",
    "live.current.scope !== launch.scope",
    "live.current.data !== launch.data",
    "result.requestId !== requestId",
    "result.fingerprint !== fresh.fingerprint",
    "result.organizationId !== organizationId",
    "URL.revokeObjectURL",
    "setRequestId(null)",
    "setCheckedReview(null)",
    "Review current whole query again",
    "not a full-fidelity backup",
    "50-row page",
  ])
    assert.ok(source.includes(text), text);
});

test("checked review is bound to exact data identity and availability epoch, never a reusable boolean", () => {
  const source = read("../components/CaseQueryExport.tsx").replace(/\s+/g, " ");
  for (const text of [
    "checkedReview.data === fresh",
    "checkedReview.epoch === epoch",
    "data: fresh, epoch: live.current.epoch",
    "previous.data !== fresh",
    "setInvalidation((value) => value + 1)",
    "live.current = null",
  ])
    assert.ok(source.includes(text), text);
  assert.ok(!source.includes("setConfirmed"));
  assert.match(source, /\[previous, setPrevious\] = useState/);
  assert.match(
    source,
    /if \(changed\) setPrevious\(\{ scope, data: fresh, invalidation, epoch \}\)/,
  );
  assert.doesNotMatch(source, /previous\.current|epoch\.current/);
  assert.match(
    source,
    /useLayoutEffect\(\(\) => \{ live.current = fresh \? \{ scope, epoch, data: fresh \} : null; return \(\) => \{ live.current = null; \}; \}, \[fresh, scope, epoch\]\)/,
  );
});
test("server loops exact maintained page compiler in one bounded access transaction and never accepts partial results", () => {
  const source = read("../../api/src/services/caseQueryExport.ts").replace(
    /\s+/g,
    " ",
  );
  for (const text of [
    "pageIndex < 20",
    "page.total > LIMIT",
    "rows.length !== total",
    'isolationLevel: "RepeatableRead"',
    "timeout: 20000",
    "FOR UPDATE",
    "row.titleClipped",
    "row.suiteClipped",
    "fresh.fingerprint !== input.expectedFingerprint",
    "renderBoundedSpreadsheetCsv",
    'cell.state !== "VALUE"',
  ])
    assert.ok(source.includes(text), text);
  assert.match(source, /queryCasePage\(\s*tx,/);
  assert.ok(
    !source.includes("customQueryWhereSql"),
    "does not fork maintained query predicates",
  );
});
