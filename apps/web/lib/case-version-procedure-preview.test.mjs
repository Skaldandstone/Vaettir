import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { readComparedProcedureSteps } from "./compared-procedure-steps.ts";
import { inspectorLabel } from "./case-inspector.ts";

// Compile the actual current value renderer with its real pure dependencies.
// Inputs are synthetic serialized snapshots, not authenticated/native reads.
const text = readFileSync(new URL("../components/TestCaseVersionReview.tsx", import.meta.url), "utf8");
const file = ts.createSourceFile("TestCaseVersionReview.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declaration = file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "ComparisonValue");
assert.ok(declaration, "Inspect the actual ComparisonValue declaration");
const compiled = ts.transpileModule(`${declaration.getText(file)}\nexports.renderValue = ComparisonValue;`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
}).outputText;
const exports = {};
new Function("exports", "React", "inspectorLabel", "readComparedProcedureSteps", compiled)(exports, React, inspectorLabel, readComparedProcedureSteps);

function preview(value, field = "steps") {
  const element = exports.renderValue({ value, field });
  return { element, html: renderToStaticMarkup(element) };
}
function childrenOfType(element, type) {
  return React.Children.toArray(element.props.children).filter(child => React.isValidElement(child) && child.type === type);
}
const step = {
  order: 7,
  action: '  Click this button\n\tthen keep <script>alert("literal")</script> as prose  ',
  expectedActionOrData: "OnclickFunction triggers API GET\napiURL: /episodes\n  keep indentation",
  expectedResult: null,
  expectedResponse: "",
  mediaAttachmentIds: ["original,image-ref", 'original-"video"-ref'],
};

test("actual version preview retains paired multiline fields, stored order, NULL/empty distinctions and exact media IDs", () => {
  const rows = [step, { ...step, order: 11, action: "", expectedResult: "\n  visible result\n", expectedResponse: '{\n  "ok": true\n}', mediaAttachmentIds: [] }];
  const original = structuredClone(rows), value = JSON.stringify(rows, null, 2);
  const rendered = preview(value);
  assert.equal(rendered.element.type, "ol");
  const items = childrenOfType(rendered.element, "li");
  assert.equal(items.length, 2);
  assert.deepEqual(items.map(item => item.key), [".$7", ".$11"]);
  const [order, action] = childrenOfType(items[0], "p");
  assert.deepEqual(order.props.children, ["Stored step order: ", 7]);
  assert.equal(action.props.children, step.action);
  assert.equal(action.props.style.whiteSpace, "pre-wrap");
  const fields = childrenOfType(childrenOfType(items[0], "dl")[0], "div");
  assert.deepEqual(fields.map(item => childrenOfType(item, "dt")[0].props.children), ["Expected action / data", "Expected result", "Expected response"]);
  const values = fields.map(item => childrenOfType(item, "dd")[0]);
  assert.equal(values[0].props.children, step.expectedActionOrData);
  assert.equal(values[1].props.children, "Not recorded");
  assert.equal(childrenOfType(values[2], "em")[0].props.children, "Empty text");
  for (const cell of values) {
    assert.equal(cell.props.style.whiteSpace, "pre-wrap");
    assert.equal(cell.props.style.overflowWrap, "anywhere");
  }
  const media = childrenOfType(childrenOfType(items[0], "div")[0], "ul")[0];
  assert.deepEqual(childrenOfType(media, "li").map(item => item.props.children), step.mediaAttachmentIds);
  assert.equal(childrenOfType(childrenOfType(items[1], "p")[1], "em")[0].props.children, "Empty text");
  const secondValues = childrenOfType(childrenOfType(items[1], "dl")[0], "div").map(item => childrenOfType(item, "dd")[0].props.children);
  assert.deepEqual(secondValues, [step.expectedActionOrData, rows[1].expectedResult, rows[1].expectedResponse]);
  assert.match(rendered.html, /OnclickFunction triggers API GET\napiURL: \/episodes\n {2}keep indentation/);
  assert.match(rendered.html, /&lt;script&gt;alert\(&quot;literal&quot;\)&lt;\/script&gt;/);
  assert.doesNotMatch(rendered.html, /<script\b|Unsupported stored step format|<a\b|<button\b/);
  assert.deepEqual(rows, original);
  assert.equal(value, JSON.stringify(original, null, 2));
});

test("every unsupported historical step shape retains complete raw text rather than a supported prefix or fabricated missing value", () => {
  const { expectedResponse: _omittedResponse, ...missing } = step;
  const invalid = [
    null, false, 0, [], {}, missing,
    { ...step, extra: 'UNKNOWN_FIELD <img src=x onerror="literal">' },
    { ...step, action: null },
    ...[false, 0, [], { endpoint: "ORIGINAL_TECHNICAL_MARKER" }].map(value => ({ ...step, expectedActionOrData: value })),
    { ...step, expectedResult: { nested: "ORIGINAL_RESULT" } },
    { ...step, expectedResponse: ["ORIGINAL_RESPONSE"] },
    { ...step, mediaAttachmentIds: ["original-ref", 42] },
    { ...step, mediaAttachmentIds: ["same-ref", "same-ref"] },
    { ...step, order: -1 }, { ...step, order: 1.5 },
  ];
  for (const badRow of invalid) {
    const value = ` \n${JSON.stringify([step, badRow], null, 2)}\n\t `;
    const rendered = preview(value);
    assert.equal(rendered.element.type, "details");
    assert.equal(rendered.element.props.open, true, "Complete raw fallback is visible without opening another panel");
    const raw = childrenOfType(rendered.element, "pre")[0];
    assert.equal(raw.props.children, value);
    assert.equal(raw.props.style.whiteSpace, "pre-wrap");
    assert.equal(raw.props.style.overflowWrap, "anywhere");
    assert.match(rendered.html, /Unsupported stored step format/);
    assert.match(rendered.html, /No rows or fields were omitted/);
    assert.doesNotMatch(rendered.html, /<ol\b|<dl\b|<img\b|<script\b|<a\b|<button\b/);
  }
});

test("step scalar/array ambiguities, malformed JSON and unsupported order use only the original raw fallback", () => {
  const values = ["null", "false", "0", '"Retained scalar"', '["Retained string row"]', "[", '{"steps":[]}', JSON.stringify([step, { ...step, order: 7 }]), JSON.stringify([{ ...step, order: 11 }, step])];
  for (const value of values) {
    const rendered = preview(value);
    assert.equal(rendered.element.type, "details");
    assert.equal(childrenOfType(rendered.element, "pre")[0].props.children, value);
    assert.doesNotMatch(rendered.html, /<ol\b|<dl\b|Not recorded\./);
  }
  assert.equal(preview("[]").html, '<p class="muted">No entries recorded.</p>');
});

test("existing step-reader row and byte bounds refuse a structured prefix without truncating fallback text", () => {
  const values = [JSON.stringify(Array.from({ length: 501 }, (_, order) => ({ ...step, order }))), JSON.stringify([{ ...step, action: "x".repeat(100001) }]), " ".repeat(2 * 1024 * 1024 + 1)];
  for (const value of values) {
    const rendered = preview(value);
    assert.equal(rendered.element.type, "details");
    assert.equal(childrenOfType(rendered.element, "pre")[0].props.children, value);
    assert.doesNotMatch(rendered.html, /<ol\b/);
  }
});

test("non-step scalar, phase/prose arrays and profile rendering retain their existing behavior", () => {
  assert.equal(preview("null", "background").html, '<p class="muted">Not recorded.</p>');
  assert.equal(preview('""', "background").html, '<p style="white-space:pre-wrap;overflow-wrap:anywhere">Empty text</p>');
  assert.equal(preview('"HIGH"', "priority").element.props.children, inspectorLabel("HIGH"));
  const phases = ["Given first\n  second line", "", "<svg onload=literal>"];
  const rendered = preview(JSON.stringify(phases), "given");
  assert.deepEqual(childrenOfType(rendered.element, "li").map(item => item.props.children), [phases[0], "Empty text", phases[2]]);
  assert.match(rendered.html, /&lt;svg onload=literal&gt;/);
  assert.doesNotMatch(rendered.html, /<svg\b/);
  assert.equal(preview("[]", "then").html, '<p class="muted">No entries recorded.</p>');
  const profile = preview(JSON.stringify({ setup: "  setup\nkept", safety: "" }), "verificationProfile");
  assert.equal(profile.element.type, "dl");
  assert.deepEqual(childrenOfType(profile.element, "div").map(item => childrenOfType(item, "dd")[0].props.children), ["  setup\nkept", "Empty text"]);
});

test("procedure preview remains presentation-only and both comparison views retain their actual renderer wiring", () => {
  const presentation = declaration.getText(file);
  assert.ok(presentation.indexOf('field === "steps"') < presentation.indexOf("JSON.parse(value)"));
  assert.match(presentation, /readComparedProcedureSteps\(value\)/);
  assert.doesNotMatch(presentation, /fetch\(|mutate|dangerouslySetInnerHTML|\.filter\(|\.sort\(/);
  assert.match(text, /<ComparisonValue value=\{field.from\} field=\{field.key\}/);
  assert.match(text, /<ComparisonValue value=\{field.to\} field=\{field.key\}/);
  assert.match(text, /<ComparisonValue\s+value=\{field.current\}\s+field=\{field.key\}/);
  assert.match(text, /<ComparisonValue value=\{field.saved\} field=\{field.key\}/);
});
