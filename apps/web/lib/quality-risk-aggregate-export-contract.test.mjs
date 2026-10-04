import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = readFileSync(
  new URL("../components/QualityRiskAggregateExport.tsx", import.meta.url),
  "utf8",
);
const overview = readFileSync(
  new URL("../components/QualityRiskOverview.tsx", import.meta.url),
  "utf8",
);
// SOURCE ONLY: authored, not executed. Does not prove real QueryClient/browser behavior.
test("aggregate export binds exact response, scope and availability epoch before using bounded encoder", () => {
  assert.match(
    source,
    /available && Number.isFinite\(revision\) && revision > 0/,
  );
  assert.match(source, /previous.current.revision !== revision/);
  assert.match(source, /reviewed === active/);
  assert.match(source, /reviewedScope === scopeKey/);
  assert.match(source, /JSON.stringify\({ filters, format }\)/);
  assert.match(source, /reviewedEpoch === epoch.current/);
  assert.match(source, /live.current.active !== active/);
  assert.match(source, /live.current.epoch !== reviewedEpoch/);
  assert.match(
    source,
    /renderBoundedSpreadsheetCsv\(plan.headers, plan.rows\)/,
  );
  assert.match(source, /active: null/);
  assert.match(source, /anchor.remove\(\)/);
  assert.match(source, /URL.revokeObjectURL\(url\)/);
});
test("portable format choice cancels exact scope review and uses local text-only download", () => {
  assert.match(source, /renderQualityRiskAggregateHtml\(plan\)/);
  assert.match(source, /File format/);
  assert.match(source, /No approved snapshot, PDF or\s+delivery is created/);
  assert.match(source, /text\/html;charset=utf-8/);
});
test("read-time aggregate dialog discloses whole-population and search omission without an external permission claim", () => {
  assert.match(source, /not just the visible twenty-row page/);
  assert.match(source, /literal search text is exported/);
  assert.match(source, /no external access was granted/);
  assert.match(source, /disabled={!canExport}/);
  assert.match(source, /riskAggregateBoundaries.map/);
  for (const forbidden of [
    "mutateAsync",
    "fetch(",
    "clipboard.writeText",
    "window.open",
    "localStorage",
  ])
    assert.ok(!source.includes(forbidden), forbidden);
});
test("overview mounts aggregate export with exact verified response and freshness revision", () => {
  assert.match(
    overview,
    /QualityRiskAggregateExport current={current} filters={filter}/,
  );
  assert.match(
    overview,
    /available={!!current && ready && !denied && !paused}/,
  );
  assert.match(overview, /revision={summary.dataUpdatedAt}/);
});
