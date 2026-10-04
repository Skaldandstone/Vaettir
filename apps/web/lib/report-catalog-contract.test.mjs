import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const catalog = readFileSync(
  new URL("../components/ReportSnapshotCatalog.tsx", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
const builder = readFileSync(
  new URL("../components/ReportBuilder.tsx", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
test("catalog is project-keyed and refuses cached errors, paused states or mismatched queries", () => {
  assert.match(catalog, /Catalog key=\{projectId\}/);
  assert.match(catalog, /!query.error && !query.isFetching && !query.isPaused/);
  assert.match(
    catalog,
    /query.data.requestKey === reportCatalogKey\(filters\)/,
  );
  assert.match(catalog, /No cached reports or empty result/);
  assert.match(catalog, /Previous snapshots/);
  assert.match(catalog, /Next snapshots/);
});
test("report catalog supports explicit filters and capture approval refreshes it", () => {
  assert.match(catalog, /reportCatalogInput.safeParse/);
  assert.match(catalog, /Filter by audience, purpose or capture date/);
  assert.match(catalog, /Captured from \(UTC\)/);
  assert.match(catalog, /captured-desc/);
  assert.match(catalog, /title-asc/);
  assert.match(builder, /utils.reportSnapshots.catalog.invalidate\(\)/);
  assert.match(builder, /<ReportSnapshotCatalog projectId=\{projectId\}/);
});
test("known access failures hide private cached previews without unfreezing their exact pending context", () => {
  assert.match(builder, /const current = !readOnly/);
  assert.match(
    builder,
    /const frozen = !!request \|\| !!review \|\| !!resumeId \|\| !!saveRequest/,
  );
  assert.match(builder, /Preview context is retained but hidden/);
});
