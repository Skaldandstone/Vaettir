import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const read = (path) =>
  readFileSync(new URL(path, import.meta.url), "utf8").replace(/\s+/g, " ");
const guide = read("../components/CaseDesignGuide.tsx");
const columns = read("../components/CaseProcedureColumns.tsx");
const form = read("../components/TestCaseForm.tsx");
const presets = read("../components/CaseAuthoringPresets.tsx");
// Static source contracts are not rendered browser/accessibility acceptance.
test("advisory checklist uses native selects and local marks without case mutation or network", () => {
  assert.ok(guide.includes("Choose a workflow"));
  assert.ok(guide.includes("caseDesignStages.map"));
  assert.ok(guide.includes('type="checkbox"'));
  assert.ok(guide.includes("local, not saved evidence"));
  assert.ok(guide.includes("No readiness score"));
  for (const forbidden of [
    "trpcReact",
    "fetch(",
    "localStorage",
    "onChangeDefinition",
    "dangerouslySetInnerHTML",
  ])
    assert.ok(!guide.includes(forbidden));
  assert.ok(form.includes("{active && <CaseDesignGuide />}"));
  assert.ok(presets.includes("<CaseDesignGuide />"));
});
test("ordered procedure preview retains all expected columns, native labels and unavailable media distinctions", () => {
  assert.ok(
    columns.includes(
      'aria-label="Ordered procedure action and expected columns" tabIndex={0}',
    ),
  );
  for (const field of [
    "action",
    "expectedActionOrData",
    "expectedResult",
    "expectedResponse",
  ])
    assert.ok(columns.includes(`labels?.${field}`));
  assert.ok(columns.includes("step[field] == null"));
  assert.ok(columns.includes('step[field] === ""'));
  assert.ok(columns.includes('<em>Empty text</em>'));
  assert.ok(!columns.includes('step[field] == null || step[field] === ""'));
  assert.ok(columns.includes('whiteSpace: "pre-wrap"'));
  assert.ok(columns.includes("this preview does not fetch or verify media"));
  assert.ok(columns.includes("{index + 1}"));
  assert.ok(!columns.includes("background"));
  assert.ok(form.includes("steps={selectedGroup.steps} labels={labels}"));
  assert.ok(form.includes("sharedGroupsQuery.isFetchedAfterMount"));
  assert.ok(form.includes("!sharedGroupsQuery.error"));
  assert.ok(form.includes("!sharedGroupsQuery.isFetching"));
  assert.ok(form.includes("!sharedGroupsQuery.isPaused"));
  assert.ok(form.includes("value.sharedStepGroupId && !selectedGroup"));
  assert.ok(
    form.includes(
      "Its reference is retained; no empty or action-only replacement is shown.",
    ),
  );
  assert.ok(presets.includes("steps={definition.steps}"));
});
