import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

// Exercise the actual source expressions/handler, not a duplicated UI model.
// This is local synthetic React/server-render proof, not authenticated browser proof.
const source = readFileSync(new URL("../components/ManualCaseResultHistory.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("ManualCaseResultHistory.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const printer = ts.createPrinter();
const print = node => printer.printNode(ts.EmitHint.Unspecified, node, ast);
const declaration = name => ast.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(value => value.name.getText(ast) === name));
const helper = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "ObservationContext");
const component = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "ManualCaseResultHistory");
const request = component.body.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "buildRequest");
const maps = new Map();
function collect(node) {
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "map") {
    const name = node.expression.expression.getText(ast);
    if (name === "contextFields" || name === "measurementFields") maps.set(name, node);
  }
  ts.forEachChild(node, collect);
}
collect(component);
assert.ok(helper && request && maps.size === 2, "actual scoped renderer and handler must exist");
const compiled = ts.transpileModule([
  ...["fullField", "contextFields", "measurementFields"].map(name => print(declaration(name))),
  print(helper), print(request),
  `function renderContextFields() { return ${print(maps.get("contextFields"))}; }`,
  `function renderMeasurementFields() { return ${print(maps.get("measurementFields"))}; }`,
].join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React } }).outputText;

function harness(locked = false) {
  const context = { specimen: "Synthetic | sample", hardwareRevision: "H1", firmwareVersion: "F2", environment: "Synthetic bench\nNo external system | local" };
  const sandbox = {
    React, locked, projectId: "synthetic-project", testRunId: "synthetic-run", testCaseId: "synthetic-case",
    origin: { projectId: "synthetic-project", organizationId: "synthetic-org", clerkActorId: "synthetic-actor" },
    draft: { context, status: "FAIL", note: "Literal | evidence\nsecond line", reason: "",
      baseline: { current: null, currentRevisionId: null, currentFingerprint: "synthetic-fingerprint" }, readings: [] },
    m: { name: "Voltage", unit: "V", value: "0", lowerLimit: "0", upperLimit: "5", instrument: "Synthetic | meter" }, i: 0,
    crypto: { randomUUID: () => "retained-synthetic-uuid" },
    // Deliberately identity parser: verifies actual UI construction only, not server validation.
    manualCaseResultWriteSchema: { parse: value => value }, parseStepMeasurements: value => value,
  };
  sandbox.draft.readings = [sandbox.m];
  sandbox.update = change => { sandbox.lastChange = change; };
  vm.createContext(sandbox);
  vm.runInContext(compiled, sandbox);
  return sandbox;
}
const children = element => React.Children.toArray(element.props.children);

test("context editor uses explicit human labels and only Environment is multiline", () => {
  const h = harness();
  const fields = h.renderContextFields();
  assert.deepEqual(Array.from(fields, field => children(field)[0]), ["Specimen", "Hardware revision", "Firmware version", "Environment"]);
  assert.deepEqual(Array.from(fields, field => children(field)[1].type), ["input", "input", "input", "textarea"]);
  const environment = children(fields[3])[1];
  assert.equal(environment.props.rows, 3);
  assert.equal(environment.props.value, h.draft.context.environment);
  const entered = "First | bench\nSecond line\nThird | line";
  environment.props.onChange({ target: { value: entered } });
  assert.equal(h.lastChange.context.environment, entered);
  assert.equal(h.lastChange.context.specimen, h.draft.context.specimen);
  for (const field of harness(true).renderContextFields()) assert.equal(children(field)[1].props.disabled, true);
});

test("measurement editor names every field explicitly and retains literal entered text", () => {
  const h = harness();
  const fields = h.renderMeasurementFields();
  assert.deepEqual(Array.from(fields, field => children(field)[0]), ["Name", "Unit", "Value", "Lower limit", "Upper limit", "Instrument"]);
  assert.equal(children(fields[2])[1].props.value, "0");
  children(fields[5])[1].props.onChange({ target: { value: "Meter | serial\nretained" } });
  assert.equal(h.lastChange.readings[0].instrument, "Meter | serial\nretained");
  assert.equal(h.lastChange.readings[0].value, "0");
});

test("actual evidence renderer keeps literal newlines and pipes with safe React escaping", () => {
  const h = harness();
  const value = { ...h.draft.context, specimen: "<script>synthetic</script> | sample" };
  const html = renderToStaticMarkup(React.createElement(h.ObservationContext, { value }));
  for (const label of ["Specimen", "Hardware revision", "Firmware version", "Environment"]) assert.ok(html.includes(`<dt>${label}</dt>`));
  assert.ok(html.includes("white-space:pre-wrap"));
  assert.ok(html.includes("Synthetic bench\nNo external system | local"));
  assert.ok(html.includes("&lt;script&gt;synthetic&lt;/script&gt; | sample"));
  assert.ok(!html.includes("<script>"));
  assert.equal(value.environment, h.draft.context.environment);
});

test("actual request construction retains environment, notes, scope and CAS identity", () => {
  const h = harness();
  const input = h.buildRequest();
  assert.equal(input.observations.environment, h.draft.context.environment);
  assert.equal(input.note, h.draft.note);
  assert.equal(input.expectedScope, h.origin);
  assert.equal(input.expectedRevisionId, null);
  assert.equal(input.expectedCurrentFingerprint, "synthetic-fingerprint");
  assert.equal(input.idempotencyKey, "retained-synthetic-uuid");
  assert.equal(input.observations.measurements, h.draft.readings);
});

test("history, retained legacy evidence and review add context without replacing exact JSON", () => {
  assert.equal((source.match(/<ObservationContext value=/g) ?? []).length, 3);
  assert.ok(source.includes("<ObservationContext value={r.result.observations}"));
  assert.ok(source.includes("<ObservationContext value={r.legacyPrior.captured.observations}"));
  assert.ok(source.includes("<ObservationContext value={draft.context}"));
  assert.ok(source.includes("JSON.stringify(r.result.observations, null, 2)"));
  assert.ok(source.includes("JSON.stringify(r.legacyPrior.captured.observations, null, 2)"));
  assert.ok(source.includes("JSON.stringify({ ...draft.context, measurements: draft.readings }, null, 2)"));
});
