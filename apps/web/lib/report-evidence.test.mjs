import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const src = readFileSync(
  new URL("../components/ReportSnapshotEvidence.tsx", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
test("captured evidence gates fresh authorized responses and immutable native navigation", () => {
  assert.match(
    src,
    /open && !query.error && !query.isFetching && !query.isPaused/,
  );
  assert.match(src, /query.data\?\.kind === kind && query.data.page === page/);
  assert.match(src, /staleTime: 0/);
  assert.match(src, /key=\{`\$\{props.projectId\}:\$\{props.snapshotId\}`\}/);
  assert.match(src, /Current record unavailable/);
  assert.match(src, /Retry captured evidence/);
  assert.match(src, /test-cases\//);
  assert.match(src, /test-runs#run-/);
  assert.match(
    src,
    /This older snapshot did not capture per-entity execution facts/,
  );
  assert.match(src, /Missing records stay in captured denominators/);
});
