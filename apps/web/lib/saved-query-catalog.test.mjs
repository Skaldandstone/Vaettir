// SOURCE ONLY, authored NOT RUN; real Clerk/QueryClient rendering still needed.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  savedQueryCatalogEchoMatches,
  reachableSavedQueryPage,
} from "./saved-query-catalog.ts";
const scope = {
  projectId: "project",
  organizationId: "org",
  clerkActorId: "actor",
};
const filters = { search: "%_", collection: "MINE", sort: "UPDATED_DESC" };
const key = JSON.stringify([filters.search, filters.collection, filters.sort]);
const data = { ...scope, offset: 0, catalogKey: key, catalog: filters };
test("catalog rejects wrong actor/org/project/page/key/filter even with retained data", () => {
  assert.equal(
    savedQueryCatalogEchoMatches(data, scope, 0, filters, key),
    true,
  );
  for (const bad of [
    { ...data, projectId: "other" },
    { ...data, organizationId: "other" },
    { ...data, clerkActorId: "other" },
    { ...data, offset: 50 },
    { ...data, catalogKey: "old-key" },
    { ...data, catalog: { ...filters, search: "_" } },
    { ...data, catalog: { ...filters, collection: "SHARED" } },
    { ...data, catalog: { ...filters, sort: "NAME_ASC" } },
    { ...data, catalog: undefined },
    undefined,
  ])
    assert.equal(
      savedQueryCatalogEchoMatches(bad, scope, 0, filters, key),
      false,
    );
  assert.equal(
    savedQueryCatalogEchoMatches(data, null, 0, filters, key),
    false,
  );
});
test("next-page helper refuses fractional, unreachable, mismatched and legacy-absent destinations", () => {
  assert.equal(reachableSavedQueryPage(150, 100), true);
  for (const value of [undefined, null, "150", 150.5, 200, 50])
    assert.equal(reachableSavedQueryPage(value, 150), false);
});
const ui = readFileSync(
  new URL("../components/SavedCaseQueries.tsx", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
test("native catalog search/filter controls gate exact read scope, preserve draft/UUID and disclose cap", () => {
  for (const s of [
    "Query name contains (literal, case-insensitive)",
    "Search saved queries",
    "Created by me (personal or shared)",
    "Recently edited",
    "catalog: catalogFilters",
    "expectedScope:",
    "savedQueryCatalogEchoMatches",
    "reachableSavedQueryPage(readyCatalog.nextOffset, offset)",
    "catalogTruncated",
    "scopeReady && !catalog.error && !catalog.isFetching && !catalog.isPaused",
    "pendingRequest ?? structuredClone(input)",
    "accepted change was not retried",
  ])
    assert.ok(ui.includes(s), s);
  const navigation = ui.slice(
    ui.indexOf("function applyCatalog"),
    ui.indexOf("function clearSelection"),
  );
  assert.ok(navigation.includes("setOffset(0)"));
  assert.doesNotMatch(
    navigation,
    /setName|setBaseline|setSelected|setPendingRequest|setVisibility/,
  );
});
test("catalog SQL projects metadata only, literal searches, fixed sort and original privacy predicate", () => {
  const service = readFileSync(
    new URL("../../api/src/services/savedCaseQueries.ts", import.meta.url),
    "utf8",
  );
  const list = service.slice(
    service.indexOf("export async function listSavedCaseQueries"),
    service.indexOf("export async function getSavedCaseQuery"),
  );
  assert.match(list, /SELECT q\.id, CASE WHEN octet_length\(q.name\)<=320/);
  assert.match(
    list,
    /strpos\(lower\(q.name\),lower\(\$\{filters.search\}\)\)>0/,
  );
  assert.match(
    list,
    /q.visibility='SHARED' OR q\."createdById"=\$\{access.actorId\}/,
  );
  assert.doesNotMatch(
    list,
    /SELECT \*|q.definition|q.columns|savedTypedCaseQuery\.findMany/,
  );
  assert.match(service, /FROM "User" WHERE id=\$\{actorId\} FOR SHARE/);
  assert.match(service, /actor.clerkUserId !== transportClerkActorId/);
});
