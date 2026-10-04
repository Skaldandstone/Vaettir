// Authored only; real QueryClient cached/refetch/mobile acceptance remains pending.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const read = (name) =>
  readFileSync(
    new URL(`../components/${name}.tsx`, import.meta.url),
    "utf8",
  ).replace(/\s+/g, " ");
const catalog = read("ReportSnapshotCatalog"),
  comparison = read("ReportSnapshotComparison");
test("both report readers withhold cached bodies across every current access failure state", () => {
  for (const source of [catalog, comparison])
    for (const guard of [
      "!project.error",
      "!project.isFetching",
      "!project.isPaused",
      "project.data?.id === projectId",
      "!organizations.error",
      "!organizations.isFetching",
      "!organizations.isPaused",
      "org.id === organizationId",
      "accessReady && !query.error",
      "!query.isFetching",
      "!query.isPaused",
      "query.data.organizationId === organizationId",
      "staleTime: 0",
      "missingMembership",
      "wrongIdentity",
    ])
      assert.ok(source.includes(guard), guard);
});
test("org transition resets selection and review and refetches access without deleting captures", () => {
  for (const source of [catalog, comparison]) {
    assert.ok(
      source.includes("previousOrganization.current !== organizationId"),
    );
    assert.ok(
      source.includes(
        "if (organizationId) previousOrganization.current = organizationId",
      ),
    );
    assert.ok(source.includes("void query.refetch()"));
    assert.ok(!source.includes("removeQueries"));
    assert.ok(!source.includes("useMutation"));
  }
  assert.ok(catalog.includes("setSelected([])"));
  assert.ok(catalog.includes("setCompareOpen(false)"));
  assert.ok(comparison.includes("setReviewedData(null)"));
});
test("selection retains pages but never exposes the prior organization's titles", () => {
  assert.ok(
    catalog.includes(
      "selectionOrganization === organizationId ? selected : []",
    ),
  );
  assert.ok(catalog.includes("currentSelected.map"));
  assert.ok(catalog.includes("...currentSelected"));
  assert.ok(catalog.includes("Selection stays across catalog pages"));
  assert.ok(catalog.includes("selected={currentSelected}"));
  // Do not tie modal mounting to catalog fetch readiness: its own fresh gates
  // withhold content without a staleTime=0 mount/refetch/unmount loop.
  assert.ok(!catalog.includes("{data && compareOpen"));
});
test("exact reviewed comparison identity and both safe exporters remain required", () => {
  for (const guard of [
    "key={`${projectId}:${pairKey}`}",
    "enabled: ordered.length === 2 && accessReady",
    "query.data.baseline.id === baselineId",
    "query.data.target.id === targetId",
    "reviewedData === data",
    "if (!data || !reviewed) return",
    "renderReportComparisonCsv(data)",
    "renderReportComparisonHtml(data)",
    "No partial CSV was substituted",
    "original evidence boundaries",
  ])
    assert.ok(comparison.includes(guard), guard);
});
test("retry refreshes all current access evidence rather than trusting retained local state", () => {
  for (const source of [catalog, comparison])
    for (const guard of [
      "project.refetch()",
      "organizations.refetch()",
      "query.refetch()",
      "onClick={() => void refresh()}",
      "Retry",
    ])
      assert.ok(source.includes(guard), guard);
});
