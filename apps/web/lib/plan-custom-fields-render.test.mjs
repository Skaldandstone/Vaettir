import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as helpers from "./plan-custom-fields.ts";
// Execute and render the actual component source with synthetic inputs. This
// does not prove browser interaction, current native data, or authentication.
const source = readFileSync(new URL("../components/PlanCustomFieldsForm.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("PlanCustomFieldsForm.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const printer = ts.createPrinter();
const declarations = ast.statements.filter(node => ts.isFunctionDeclaration(node)).map(node => printer.printNode(ts.EmitHint.Unspecified, node, ast).replace(/^export /, ""));
const compiled = ts.transpileModule(declarations.join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React } }).outputText;
function harness() {
  const sandbox = { React, useState: React.useState, useEffect: React.useEffect, ...helpers };
  vm.createContext(sandbox); vm.runInContext(compiled, sandbox); return sandbox;
}
function elements(element) {
  if (!React.isValidElement(element)) return [];
  return [element, ...React.Children.toArray(element.props.children).flatMap(elements)];
}
test("actual repeatable-row handlers preserve exact multiline text and only remove the chosen duplicate", () => {
  const h = harness(), values = ["", " a,b ", "same", "same", "line\nnext"], changes = [];
  const nodes = elements(h.PlanStringListField({ label: "Areas", hint: "Synthetic", values, onChange: value => changes.push(value) }));
  const rows = nodes.filter(node => node.type === "textarea");
  assert.deepEqual(rows.map(row => row.props.value), values);
  rows[1].props.onChange({ target: { value: " retained\ncomma,exact " } });
  assert.deepEqual(changes.pop(), ["", " retained\ncomma,exact ", "same", "same", "line\nnext"]);
  nodes.find(node => node.type === "button" && node.props["aria-label"] === "Remove Areas row 3").props.onClick();
  assert.deepEqual(changes.pop(), ["", " a,b ", "same", "line\nnext"]);
  nodes.find(node => node.type === "button" && !node.props["aria-label"]).props.onClick();
  assert.deepEqual(Array.from(changes.pop()), [...values, ""]);
});
test("actual boolean/text handlers preserve native types and unknown siblings", () => {
  const h = harness(), values = { enabled: false, notes: " original\ntext, ", legacy: { retain: [null, 3] } }, changes = [];
  const props = { schema: { properties: { enabled: { type: "boolean" }, notes: { type: "string" } } }, values, onChange: value => changes.push(value) };
  const nodes = elements(h.PlanCustomFieldsForm(props));
  const checkbox = nodes.find(node => node.type === "input" && node.props.type === "checkbox");
  assert.equal(checkbox.props.checked, false); checkbox.props.onChange({ target: { checked: true } });
  assert.deepEqual(changes.pop(), { ...values, enabled: true });
  const textarea = nodes.find(node => node.type === "textarea");
  textarea.props.onChange({ target: { value: "" } });
  assert.deepEqual(changes.pop(), { ...values, notes: "" });
  assert.ok(nodes.some(node => node.type === "pre" && node.props.children.includes('"retain"')));
});
test("actual missing/invalid fields render explicit retention and safely escape saved text", () => {
  const h = harness();
  const html = renderToStaticMarkup(React.createElement(h.PlanCustomFieldsForm, { schema: { properties: { enabled: { type: "boolean" }, areas: { type: "array", items: { type: "string" } }, n: { type: "number" } } }, values: { areas: ["<script>synthetic</script>", 3], n: null }, onChange: () => assert.fail("render must not write") }));
  assert.match(html, /Set false explicitly/); assert.match(html, /Not set/);
  assert.match(html, /stored native value does not match/);
  assert.match(html, /&lt;script&gt;synthetic&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>|value="\[object Object\]"/);
});
test("actual finite-number input applies only finite values and keeps invalid drafts unapplied", () => {
  const h = harness(), applied = [];
  // Synthetic hook host evaluates the actual handler without a browser DOM.
  h.useState = value => [value, () => {}]; h.useEffect = () => {};
  const nodes = elements(h.FiniteNumberField({ label: "Budget", value: 12, onChange: value => applied.push(value) }));
  const input = nodes.find(node => node.type === "input");
  for (const value of ["", "NaN", "Infinity", "1e309", "-"]) input.props.onChange({ target: { value } });
  assert.deepEqual(applied, []);
  input.props.onChange({ target: { value: "0" } }); input.props.onChange({ target: { value: "-4.5" } });
  assert.deepEqual(applied, [0, -4.5]);
});
