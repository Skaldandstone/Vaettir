import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { appendCaseTag, initialCaseTags, removeCaseTag, reopenLastCaseTag, technicalBehaviorLabel } from "./case-authoring-fields.ts";
const file = name => readFileSync(new URL(name, import.meta.url), "utf8");

test("only the legacy technical descriptor label is normalized, not custom labels or stored keys", () => {
  assert.equal(technicalBehaviorLabel(), "Technical behavior / data");
  assert.equal(technicalBehaviorLabel("Expected Action / Data"), "Technical behavior / data");
  for (const custom of ["Expected data", "Instrumentation stimulus", "API contract", "", "Expected Action / Data "]) {
    assert.equal(technicalBehaviorLabel(custom), custom);
  }
});

test("existing array tags retain exact punctuation, whitespace, duplicates, unicode and order", () => {
  const original = Object.freeze(["API, backend", "  preserved  ", "α / 🎮", "same", "same", ""]);
  const tags = initialCaseTags(original);
  assert.deepEqual(tags, original);
  assert.notEqual(tags, original);
  assert.deepEqual(appendCaseTag(tags, "").tags, original);
  assert.deepEqual(appendCaseTag(tags, "same").tags, original);
  assert.deepEqual(initialCaseTags(), []);
  // Compatibility applies only to legacy new-draft text, not saved arrays.
  assert.deepEqual(initialCaseTags("one, two, ,three"), ["one", "two", "three"]);
});

test("new tag entry is explicit, trims only the new tag and never splits literal pasted punctuation", () => {
  const tags = ["API, backend", "  preserved  "];
  assert.deepEqual(appendCaseTag(tags, "  release, candidate  "), { tags: [...tags, "release, candidate"], status: "added", tag: "release, candidate" });
  assert.equal(appendCaseTag(tags, "API, backend").status, "duplicate");
  assert.equal(appendCaseTag(tags, " \n ").status, "empty");
  assert.deepEqual(appendCaseTag(tags, "API").tags, [...tags, "API"]);
  assert.deepEqual(tags, ["API, backend", "  preserved  "]);
});

test("removal targets one exact chip and empty-input backspace retains the last tag as draft", () => {
  const tags = ["same", "same", "API, backend"];
  assert.deepEqual(removeCaseTag(tags, 0), ["same", "API, backend"]);
  for (const index of [-1, 4, 0.5, NaN]) assert.deepEqual(removeCaseTag(tags, index), tags);
  const reopened = reopenLastCaseTag(tags, "");
  assert.deepEqual(reopened, { tags: ["same", "same"], draft: "API, backend" });
  // Saving an uncommitted chip draft reattaches its literal original value.
  assert.deepEqual(appendCaseTag(reopened.tags, reopened.draft).tags, tags);
  for (const literal of ["  preserved  ", "same", ""]) {
    const originals = ["same", literal];
    const edit = reopenLastCaseTag(originals, "");
    assert.deepEqual(appendCaseTag(edit.tags, edit.draft, literal).tags, originals);
  }
  assert.deepEqual(reopenLastCaseTag(tags, "new"), { tags, draft: "new" });
  assert.deepEqual(reopenLastCaseTag([], ""), { tags: [], draft: "" });
});

test("case form and both saved-array callers preserve exact tag API payloads", () => {
  const form = file("../components/TestCaseForm.tsx");
  assert.match(form, /tags: initialCaseTags\(initial\?\.tags\)/);
  assert.match(form, /tags: appendCaseTag\(value\.tags, tagDraft, reopenedTag\)\.tags/);
  assert.doesNotMatch(form, /value\.tags\s*\.split/);
  assert.match(file("../app/projects/[projectId]/test-cases/[id]/edit/page.tsx"), /tags: tc\.tags,/);
  assert.match(file("../components/CaseAuthoringPresets.tsx"), /tags: draft\.value\.value\.definition\.tags,/);
});

test("tag chips provide literal links, keyboard entry, composition safety and scoped removal", () => {
  const editor = file("../components/CaseTagEditor.tsx");
  assert.match(editor, /aria-label="Case tag chips"/);
  assert.match(editor, /encodeURIComponent\(projectId\)/);
  assert.match(editor, /encodeURIComponent\(tag\)/);
  assert.match(editor, /target="_blank" rel="noopener noreferrer"/);
  assert.match(editor, /event\.nativeEvent\.isComposing/);
  assert.match(editor, /event\.key === "Enter" \|\| event\.key === ","/);
  assert.match(editor, /event\.key === "Backspace" && draft === ""/);
  assert.match(editor, /removeCaseTag\(tags, index\)/);
  assert.match(editor, /role="status"/);
});

test("all four structured fields are multiline controls, with unchanged stored keys and order", () => {
  const form = file("../components/TestCaseForm.tsx");
  for (const key of ["action", "expectedActionOrData", "expectedResult", "expectedResponse"]) {
    assert.match(form, new RegExp(`<textarea\\s+value=\\{step\\.${key}\\}`));
    assert.match(form, new RegExp(`updateStep\\(i, \\{ ${key}: e\\.target\\.value \\}\\)`));
  }
  assert.match(form, /moveListItem\(v\.steps, i, i - 1\)/);
  assert.match(form, /expectedCaseRevision: baseline\?\.caseRevision/);
  assert.match(form, /Parameter datasets are separate/);
});

test("execution dialog displays frozen expected response and preserves multiline technical descriptors", () => {
  const execution = file("../components/StepExecutionPanel.tsx");
  assert.match(execution, /aria-label="Frozen step definition"/);
  assert.match(execution, /selectedStep\.expectedResponse != null/);
  assert.match(execution, /stepFieldLabels\.expectedResponse \?\? "Expected response"/);
  assert.match(execution, /technicalBehaviorLabel\(stepFieldLabels\.expectedActionOrData\)/);
  assert.match(execution, /whiteSpace: "pre-wrap"/);
  assert.match(execution, /selectedStep\.expectedResponse \|\| <em>Empty text<\/em>/);
  assert.match(file("../components/CaseProcedureColumns.tsx"), /technicalBehaviorLabel\(labels\?\.expectedActionOrData\)/);
});
