import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import React from "react";
import ts from "typescript";
const source = readFileSync(new URL("../components/CaseCustomFields.tsx", import.meta.url), "utf8");
const start = source.indexOf("function ValueInputs("), end = source.indexOf("function clientProblems(", start);
assert.ok(start >= 0 && end > start);
const compiled = ts.transpileModule(source.slice(start, end), { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const render = runInNewContext(`${compiled}; ValueInputs`, { React });
function elements(node, type) {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(value => elements(value, type));
  return [...(node.type === type ? [node] : []), ...elements(node.props?.children, type)];
}
const definition = { key: "technical_notes", label: "Technical notes", type: "TEXT", required: false, retired: false, options: [] };
test("actual native TEXT editor renders retained multiline prose without single-line normalization", () => {
  const values = { technical_notes: "first line\n  retained, second line\nλ 🎮", unknown: "literal, retained" };
  const output = render({ fields: [definition], values, disabled: false, onChange: () => assert.fail("render must not publish a mutation") });
  const controls = elements(output, "textarea");
  assert.equal(controls.length, 1);
  assert.equal(controls[0].props.value, values.technical_notes);
  assert.equal(controls[0].props.rows, 4);
  assert.equal(controls[0].props.maxLength, 2000);
  assert.equal(elements(output, "input").length, 0);
});
test("multiline TEXT edits preserve exact supplied text and all unedited siblings", () => {
  const values = Object.freeze({ technical_notes: "Original\ntext", flag: false, count: 0, retired: "", unknown: "literal, retained" }), changes = [];
  const control = elements(render({ fields: [definition], values, disabled: false, onChange: value => changes.push(value) }), "textarea")[0];
  control.props.onChange({ target: { value: "Updated\n  comma, value\n" } });
  assert.equal(changes[0].technical_notes, "Updated\n  comma, value\n");
  for (const key of ["flag", "count", "retired", "unknown"]) assert.equal(changes[0][key], values[key]);
  assert.equal(values.technical_notes, "Original\ntext");
});
test("nullable clearing and read-only required flags retain the existing value contract", () => {
  const changes = [], control = elements(render({ fields: [{ ...definition, required: true }], values: { technical_notes: null }, disabled: true, onChange: value => changes.push(value) }), "textarea")[0];
  assert.equal(control.props.disabled, true);
  assert.equal(control.props.required, true);
  assert.equal(control.props.value, "");
  control.props.onChange({ target: { value: "" } });
  assert.equal(changes[0].technical_notes, null);
});
test("non-TEXT native types retain dropdown/date/number controls without changing schema types", () => {
  const fields = ["BOOLEAN", "CHOICE", "DATE", "NUMBER"].map((type, index) => ({ ...definition, type, key: `field_${index}`, options: type === "CHOICE" ? ["One", "Two"] : [] }));
  const output = render({ fields, values: { field_0: false, field_1: "Two", field_2: "2026-10-05", field_3: 0 }, disabled: false, onChange: () => {} });
  assert.equal(elements(output, "textarea").length, 0);
  assert.equal(elements(output, "select").length, 2);
  assert.deepEqual(elements(output, "input").map(control => control.props.type), ["date", "number"]);
  assert.equal(elements(output, "select")[0].props.value, "false");
  assert.equal(elements(output, "input")[1].props.value, "0");
  assert.match(source, /expectedValueHash: draft!\.expectedCustomFieldRevision/);
  assert.match(source, /retainedCaseFieldReceipt\(attempt,\s*error\)/);
});
