// Authored source contracts only. Not executed or rendered overnight.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const folder = read("../components/TestCaseFolderCopy.tsx");
const clone = read("../components/TestCaseClone.tsx");
const columns = read("../components/CaseProcedureColumns.tsx");

test("complete folder procedure review uses the ordered expected-field table without truthy-field omissions", () => {
  assert.ok(
    folder.includes("<CaseProcedureColumns steps={c.definition.steps} />"),
  );
  for (const field of [
    "expectedActionOrData",
    "expectedResult",
    "expectedResponse",
  ]) {
    assert.ok(!folder.includes(`step.${field} &&`));
    assert.ok(columns.includes(`"${field}"`));
  }
  assert.ok(columns.includes('whiteSpace: "pre-wrap"'));
  assert.ok(columns.includes("step[field] == null"));
  assert.ok(columns.includes('step[field] === ""'));
  assert.ok(columns.includes('<em>Empty text</em>'));
  assert.ok(!columns.includes('step[field] == null || step[field] === ""'));
  assert.ok(columns.includes("{index + 1}"));
});

test("folder setup, authored Given When Then and reviewed source access remain separate from ordered steps", () => {
  assert.ok(folder.includes("c.definition.background"));
  assert.ok(folder.includes('["given", "when", "then"] as const'));
  assert.ok(folder.includes("c.definition[phase].map"));
  assert.ok(folder.includes("scope.matches(review.data)"));
  assert.ok(folder.includes('review.fetchStatus === "idle"'));
  assert.ok(folder.includes("reviewed.internalPrerequisites.map"));
  assert.ok(!columns.includes("background"));
  assert.ok(!columns.includes("prerequisites"));
});

test("standalone duplication reviews the same ordered columns without conflating procedure preview with copied execution evidence", () => {
  assert.ok(
    clone.includes(
      "<CaseProcedureColumns steps={baseline.definition.steps} />",
    ),
  );
  assert.ok(clone.includes("baseline.definition.background"));
  assert.ok(clone.includes('["given", "when", "then"] as const'));
  assert.ok(clone.includes("baseline.definition[phase].map"));
  assert.ok(clone.includes("baseline.warnings.map"));
  assert.ok(clone.includes("Historical copied dataset mapping"));
  assert.ok(clone.includes("scope.matches(previewScope)"));
});
