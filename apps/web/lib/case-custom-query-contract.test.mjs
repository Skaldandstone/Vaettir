// Authored source contracts only; actual TanStack cache/mobile checks deferred.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (name) => readFileSync(new URL(name, import.meta.url), "utf8");
test("custom rules use fresh project definitions and explicit repair without discarding saved criteria", () => {
  const source = read("../components/CaseQueryExplorer.tsx");
  for (const text of [
    "!definitions.error",
    "!definitions.isFetching",
    "!definitions.isPaused",
    "customBindingProblems",
    "Existing custom conditions are retained for repair",
    "CaseCustomQueryCondition",
    "unavailable; repair or remove",
    "Cached custom values are withheld",
  ])
    assert.ok(source.replace(/\s+/g, " ").includes(text), text);
  assert.match(source, /\|\|\s*!!freshDefinitions/);
});
test("native typed controls distinguish all unset states and do not coerce false or zero", () => {
  const source = read("../components/CaseCustomQueryCondition.tsx");
  for (const text of [
    "Key absent (never set)",
    "Explicitly not set (null)",
    "Empty text",
    "No (false)",
    "Yes (true)",
    "old ?? defaultValue",
    "Before date",
    "Contains literal text",
  ])
    assert.ok(source.includes(text), text);
});
test("custom optional columns remain bounded with native case IDs and explicit rerun", () => {
  const source = read("../components/CaseQueryExplorer.tsx");
  for (const text of [
    "columns.length >= 8",
    "customColumns?.length ?? 0) >= 6",
    "Run current criteria with selected columns",
    "Absent (never set)",
    "Not set (null)",
    "Invalid stored value; repair in case",
    "row.displayId",
    "test-cases/${encodeURIComponent(row.id)}",
  ])
    assert.ok(source.replace(/\s+/g, " ").includes(text), text);
});
