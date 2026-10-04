import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
const component = readFileSync(
  new URL("../components/CaseQueryExplorer.tsx", import.meta.url),
  "utf8",
);
test("typed query explorer rejects stale/failed/paused cache and binds visible request identity", () => {
  for (const guard of [
    "!query.error",
    "!query.isFetching",
    "!query.isPaused",
    "query.data?.requestId === applied.requestId",
    "query.data.projectId === projectId",
    "query.data.organizationId === organizationId",
    "accessReady &&",
    "!project.error",
    "!project.isFetching",
    "!organizations.error",
    "!organizations.isPaused",
    "key={projectId}",
  ])
    assert.ok(component.includes(guard), guard);
});
test("query scope/columns are disclosed separate from saved views, selection, bulk actions and exports", () => {
  for (const text of [
    "Save personal or shared criteria",
    "existing table views and selections stay unchanged",
    "Existing saved views, selected cases, bulk",
    "caseQuerySchema.safeParse",
    "crypto.randomUUID()",
    "Query cases",
  ])
    assert.ok(component.replace(/\s+/g, " ").includes(text), text);
  assert.ok(component.includes("All groups must match (AND)"));
  assert.ok(component.includes("Any group may match (OR)"));
  assert.ok(component.includes("All conditions (AND)"));
  assert.ok(component.includes("Any condition (OR)"));
});
test("query metadata links native cases and retains explicit null-risk/clipping/limits", () => {
  for (const text of [
    "test-cases/${encodeURIComponent(row.id)}",
    "encodeURIComponent(projectId)",
    "Not assessed",
    "titleClipped",
    "suiteClipped",
    "limitations",
  ])
    assert.ok(component.includes(text), text);
  assert.ok(!component.includes("useMutation"));
});

// Source contracts only. Real mounted cache/download acceptance is deferred.
test("whole-query export mounts applied criteria and current compatible columns, not the draft", () => {
  const normalized = component.replace(/\s+/g, " ");
  for (const source of [
    "query={applied.query}",
    "organizationId={organizationId}",
    "requestKey={applied.requestId}",
    "columns={columns}",
    "projectionMatches",
    "appliedBindingProblems.length === 0",
    "definitions.data.organizationId === organizationId",
  ])
    assert.ok(normalized.includes(source), source);
  assert.ok(!normalized.includes("query={draft}"));
});
