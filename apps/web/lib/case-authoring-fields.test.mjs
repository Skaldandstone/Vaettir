import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { appendCaseTag, initialCaseTags, initialCasePhaseRows, prepareCasePhaseForSave, prepareCaseStepsForSave, removeCaseTag, reopenLastCaseTag, technicalBehaviorLabel } from "./case-authoring-fields.ts";
import { moveListItem } from "./move-list-item.ts";
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
    const display = key === "action" ? "" : ' \\?\\? ""';
    assert.match(form, new RegExp(`<textarea\\s+value=\\{step\\.${key}${display}\\}`));
    assert.match(form, new RegExp(`updateStep\\(i, \\{ ${key}: e\\.target\\.value \\}\\)`));
  }
  assert.match(form, /moveListItem\(v\.steps, i, i - 1\)/);
  assert.match(form, /expectedCaseRevision: baseline\?\.caseRevision/);
  assert.match(form, /Parameter datasets are separate/);
});

test("unrelated edits serialize retained NULL, empty text, whitespace, multiline prose and media losslessly", () => {
  const rows = Object.freeze([
    Object.freeze({ action: "Click button\nConfirm details", expectedActionOrData: null, expectedResult: "", expectedResponse: " \n ", mediaAttachmentIds: Object.freeze(["media-one", "media-two"]) }),
    Object.freeze({ action: "Second action", expectedActionOrData: "", expectedResult: null, expectedResponse: "200\n{\"synthetic\": true}", mediaAttachmentIds: Object.freeze([]) }),
  ]);
  const prepared = prepareCaseStepsForSave(rows);
  assert.equal(prepared.ok, true);
  assert.deepEqual(prepared.steps, rows);
  assert.notEqual(prepared.steps[0].mediaAttachmentIds, rows[0].mediaAttachmentIds);
  const explicitClear = prepareCaseStepsForSave([{ ...rows[0], expectedActionOrData: "" }]);
  assert.equal(explicitClear.steps[0].expectedActionOrData, "");
  assert.equal(rows[0].expectedActionOrData, null);
});

test("only completely empty new placeholders may be omitted, not retained blank rows or whitespace", () => {
  const empty = { action: "", expectedActionOrData: null, expectedResult: null, expectedResponse: null, mediaAttachmentIds: [], editorPlaceholder: true };
  assert.deepEqual(prepareCaseStepsForSave([empty]), { ok: true, steps: [] });
  assert.deepEqual(prepareCaseStepsForSave([{ ...empty, expectedResult: "" }]), { ok: true, steps: [] });
  for (const changed of [{ editorPlaceholder: false }, { action: " " }, { expectedActionOrData: " " }]) {
    const prepared = prepareCaseStepsForSave([{ ...empty, ...changed }]);
    assert.equal(prepared.ok, false); assert.equal(prepared.stepNumber, 1);
  }
});

test("missing action with any supplied technical/result/response/media refuses the entire save at its original index", () => {
  const action = { action: "Valid action", expectedActionOrData: null, expectedResult: "", expectedResponse: null, mediaAttachmentIds: [] };
  const empty = { ...action, action: "", editorPlaceholder: true };
  for (const supplied of [{ expectedActionOrData: "GET /api/details" }, { expectedResult: "Visible details" }, { expectedResponse: "200" }, { mediaAttachmentIds: ["retained-media"] }]) {
    const prepared = prepareCaseStepsForSave([action, { ...empty, ...supplied }, action]);
    assert.equal(prepared.ok, false); assert.equal(prepared.stepNumber, 2);
    assert.match(prepared.error, /Step 2.*Nothing was saved/);
    assert.equal("steps" in prepared, false);
  }
});

test("valid rows preserve exact relative order and strip only editor-only metadata", () => {
  const action = { action: "One", expectedActionOrData: "", expectedResult: null, expectedResponse: null, mediaAttachmentIds: [], editorPlaceholder: false, editorKey: "one" };
  const empty = { ...action, action: "", expectedActionOrData: null, editorPlaceholder: true, editorKey: "new" };
  const prepared = prepareCaseStepsForSave([action, empty, { ...action, action: "Two", editorKey: "two" }]);
  assert.equal(prepared.ok, true);
  assert.deepEqual(prepared.steps.map(row => row.action), ["One", "Two"]);
  assert.equal(prepared.steps.some(row => "editorPlaceholder" in row || "editorKey" in row), false);
});

test("step save wiring refuses before mutation and nullable editor/caller values do not collapse empty text", () => {
  const form = file("../components/TestCaseForm.tsx"), caller = file("../app/projects/[projectId]/test-cases/[id]/edit/page.tsx");
  assert.match(form, /prepareCaseStepsForSave\(value\.sharedStepGroupId \? \[\] : value\.steps\)/);
  assert.match(form, /if \(!preparedSteps\.ok\) \{ setError\(preparedSteps\.error\); return; \}/);
  assert.match(form, /steps: preparedSteps\.steps/);
  assert.doesNotMatch(form, /\.filter\(\(s\) => s\.action\.trim\(\)\)/);
  assert.doesNotMatch(form, /s\.(?:expectedActionOrData|expectedResult|expectedResponse) \|\| null/);
  assert.match(form, /editorPlaceholder: true,\s*action: "",\s*expectedActionOrData: null,\s*expectedResult: null,\s*expectedResponse: null/);
  for (const key of ["expectedActionOrData", "expectedResult", "expectedResponse"]) {
    assert.match(caller, new RegExp(`${key}: s\\.${key},`));
    assert.doesNotMatch(caller, new RegExp(`${key}: s\\.${key} \\?\\? ""`));
  }
});

test("all retained phase entries preserve empty, whitespace, duplicates and multiline raw text on unrelated edits", () => {
  const source = Object.freeze(["", "  ", "Duplicate", "Duplicate", "Given setup\nwith a second line", "λ 🎮"]);
  for (const phase of ["Given", "When", "Then"]) {
    const rows = initialCasePhaseRows(source, `synthetic-${phase}`);
    assert.equal(rows.every(row => row.editorPlaceholder === false), true);
    assert.equal(new Set(rows.map(row => row.editorKey)).size, source.length);
    assert.deepEqual(prepareCasePhaseForSave(phase, rows), { ok: true, values: source });
  }
});

test("phase serialization omits only literal empty new placeholders and retains new whitespace/prose", () => {
  const retained = initialCasePhaseRows(["", "Existing"], "retained");
  const placeholder = { text: "", editorKey: "new-empty", editorPlaceholder: true };
  const whitespace = { text: " \n ", editorKey: "new-whitespace", editorPlaceholder: true };
  const authored = { text: "New precondition", editorKey: "new-authored", editorPlaceholder: true };
  assert.deepEqual(prepareCasePhaseForSave("Given", [retained[0], placeholder, whitespace, retained[1], authored]), { ok: true, values: ["", " \n ", "Existing", "New precondition"] });
  assert.equal(placeholder.text, "");
});

test("phase reordering moves exact identity/origin with raw text; explicit removal removes only one row", () => {
  const rows = initialCasePhaseRows(["", "One", "One"], "retained");
  const placeholder = { text: "", editorKey: "new", editorPlaceholder: true };
  const moved = moveListItem([...rows, placeholder], 0, 2);
  assert.equal(moved[2], rows[0]);
  assert.deepEqual(prepareCasePhaseForSave("Then", moved), { ok: true, values: ["One", "One", ""] });
  const removed = moved.filter((_, index) => index !== 0);
  assert.deepEqual(prepareCasePhaseForSave("Then", removed), { ok: true, values: ["One", ""] });
  assert.equal(rows[0].editorPlaceholder, false);
});

test("explicit clearing of a retained phase keeps empty text while a cleared new placeholder may be omitted", () => {
  const existing = { ...initialCasePhaseRows(["Retained setup"], "existing")[0], text: "" };
  const draft = { text: "", editorKey: "new", editorPlaceholder: true };
  assert.deepEqual(prepareCasePhaseForSave("When", [existing, draft]), { ok: true, values: [""] });
});

test("unsupported phase text/origin refuses the complete save at its original phase and item index", () => {
  const valid = initialCasePhaseRows(["One"], "valid")[0];
  for (const invalid of [{ ...valid, text: null }, { ...valid, text: 1 }, { ...valid, text: false }, { text: "Raw text", editorKey: "missing-origin" }, null]) {
    const prepared = prepareCasePhaseForSave("Then", [valid, invalid, valid]);
    assert.equal(prepared.ok, false); assert.equal(prepared.itemNumber, 2);
    assert.match(prepared.error, /Then item 2.*no value was coerced.*nothing was saved/);
    assert.equal("values" in prepared, false);
  }
});

test("phase form wiring preserves stable row origin and full raw API arrays, with no trim-based deletion", () => {
  const form = file("../components/TestCaseForm.tsx");
  for (const [lower, phase] of [["given", "Given"], ["when", "When"], ["then", "Then"]]) {
    assert.match(form, new RegExp(`${lower}: initialCasePhaseRows\\(initial\\?\\.${lower} \\?\\? \\[\\],`));
    assert.match(form, new RegExp(`prepareCasePhaseForSave\\("${phase}", value\\.${lower}\\)`));
    assert.match(form, new RegExp(`${lower}: prepared${phase}\\.values`));
    assert.doesNotMatch(form, new RegExp(`value\\.${lower}\\.filter`));
  }
  assert.match(form, /key=\{item\.editorKey\}/);
  assert.match(form, /value=\{item\.text\}/);
  assert.match(form, /editorKey: key, editorPlaceholder: true/);
  assert.match(form, /moveListItem\(items, from, to\)/);
  assert.match(form, /Retained empty entry/);
  const api = file("../../api/src/routers/testCases.ts");
  assert.match(api, /given: z\.array\(z\.string\(\)\)\.default\(\[\]\)/);
  assert.match(api, /given: input\.given/);
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
