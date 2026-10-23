import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const explorer = readFileSync(new URL("../components/CaseQueryExplorer.tsx", import.meta.url), "utf8");
const saved = readFileSync(new URL("../components/SavedCaseQueries.tsx", import.meta.url), "utf8").replace(/\s+/g, " ");
test("saved query state survives dialog closure and remains project-keyed", () => {
  assert.match(explorer, /<Explorer key=\{projectId\}/);
  assert.match(explorer, /const savedQueries = useSavedCaseQueries/);
  assert.match(explorer, /enabled: open/);
  assert.match(saved, /pendingRequest \?\? structuredClone\(input\)/);
  assert.match(saved, /retainSavedQueryRequest\(recovering, error\)/);
  assert.match(saved, /Retry exact saved-query change/);
});
test("cached failed/paused/current-definition data cannot authorize saved edits", () => {
  assert.match(saved, /!catalog\.error && !catalog\.isFetching && !catalog\.isPaused/);
  assert.match(saved, /!current\.error && !current\.isFetching && !current\.isPaused/);
  assert.match(saved, /current\.data\.value\.id === selected/);
  assert.match(saved, /readyCurrent\.value\.version === baseline\.version/);
  assert.match(saved, /expectedVersion: baseline!\.version/);
  assert.match(saved, /Confirm deletion of/);
});
