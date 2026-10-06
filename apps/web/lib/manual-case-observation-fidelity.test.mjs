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
const draftSource = readFileSync(new URL("./whole-case-reviewed-draft.ts", import.meta.url), "utf8");
const draftAst = ts.createSourceFile("whole-case-reviewed-draft.ts", draftSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const requestFunctions = ["decimalKey", "parseWholeCaseNumber", "wholeCaseRequest"].map(name => draftAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name));
const maps = new Map();
function collect(node) {
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "map") {
    const name = node.expression.expression.getText(ast);
    if (name === "contextFields" || name === "measurementFields") maps.set(name, node);
  }
  ts.forEachChild(node, collect);
}
collect(component);
assert.ok(helper && requestFunctions.every(Boolean) && maps.size === 2, "actual scoped renderer and reviewed request construction must exist");
const compiled = ts.transpileModule([
  ...["fullField", "contextFields", "measurementFields"].map(name => print(declaration(name))),
  print(helper), ...requestFunctions.map(node => printer.printNode(ts.EmitHint.Unspecified, node, draftAst).replace(/\bexport function /g, "function ")),
  `function renderContextFields() { return ${print(maps.get("contextFields"))}; }`,
  `function renderMeasurementFields() { return ${print(maps.get("measurementFields"))}; }`,
].join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React } }).outputText;

function harness(locked = false) {
  const context = { specimen: "Synthetic | sample", hardwareRevision: "H1", firmwareVersion: "F2", environment: "Synthetic bench\nNo external system | local" };
  const sandbox = {
    React, locked, projectId: "synthetic-project", testRunId: "synthetic-run", testCaseId: "synthetic-case",
    origin: { projectId: "synthetic-project", testRunId: "synthetic-run", testCaseId: "synthetic-case", organizationId: "synthetic-org", clerkActorId: "synthetic-actor", nativeActorId: "synthetic-native", sessionId: "synthetic-session" },
    draft: { context, status: "FAIL", note: "Literal | evidence\nsecond line", reason: "",
      baseline: { canWrite: true, frozenEvidenceHash: "synthetic-frozen-hash", current: null, currentRevisionId: null, currentFingerprint: "synthetic-fingerprint" }, readings: [], measurementsPresent: true },
    reading: { name: "Voltage", unit: "V", value: "0", lowerLimit: "0", upperLimit: "5", instrument: "Synthetic | meter" }, index: 0,
    crypto: { randomUUID: () => "retained-synthetic-uuid" },
    // Deliberately identity parser: verifies actual UI construction only, not server validation.
    manualCaseReviewedExactWriteSchema: { parse: value => value },
  };
  sandbox.draft.readings = [sandbox.reading];
  sandbox.update = change => { sandbox.lastChange = change; };
  vm.createContext(sandbox);
  vm.runInContext(compiled, sandbox);
  return sandbox;
}
const children = element => React.Children.toArray(element.props.children);
const fieldLabel = wrapper => children(wrapper).find(node => node.type === "label");
const fieldControl = wrapper => children(fieldLabel(wrapper)).find(node => node.type === "input" || node.type === "textarea");

test("context editor uses explicit labels and exact raw text; Environment has a larger prose area", () => {
  const h = harness();
  const fields = h.renderContextFields();
  assert.deepEqual(Array.from(fields, field => children(fieldLabel(field))[0]), ["Specimen", "Hardware revision", "Firmware version", "Environment"]);
  assert.deepEqual(Array.from(fields, field => fieldControl(field).type), ["textarea", "textarea", "textarea", "textarea"]);
  assert.deepEqual(Array.from(fields, field => fieldControl(field).props.rows), [1, 1, 1, 3]);
  const environment = fieldControl(fields[3]);
  assert.equal(environment.props.rows, 3);
  assert.equal(environment.props.value, h.draft.context.environment);
  const entered = "First | bench\nSecond line\nThird | line";
  environment.props.onChange({ target: { value: entered } });
  assert.equal(h.lastChange.context.environment, entered);
  assert.equal(h.lastChange.context.specimen, h.draft.context.specimen);
  for (const field of harness(true).renderContextFields()) assert.equal(fieldControl(field).props.disabled, true);
});

test("measurement editor names every field explicitly and retains literal entered text", () => {
  const h = harness();
  const fields = h.renderMeasurementFields();
  assert.deepEqual(Array.from(fields, field => children(fieldLabel(field))[0]), ["Name", "Unit", "Value", "Lower limit", "Upper limit", "Instrument"]);
  assert.equal(fieldControl(fields[2]).props.value, "0");
  fieldControl(fields[5]).props.onChange({ target: { value: "Meter | serial\nretained" } });
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
  const input = h.wholeCaseRequest(h.draft, h.origin, "retained-synthetic-uuid");
  assert.equal(input.observations.environment, h.draft.context.environment);
  assert.equal(input.note, h.draft.note);
  assert.equal(input.expectedScope.projectId, h.origin.projectId);
  assert.equal(input.expectedScope.organizationId, h.origin.organizationId);
  assert.equal(input.expectedScope.clerkActorId, h.origin.clerkActorId);
  assert.equal(input.mode, "EXACT"); assert.equal(input.expectedNativeActorId, h.origin.nativeActorId);
  assert.equal(input.expectedFrozenEvidenceHash, "synthetic-frozen-hash");
  assert.equal(input.expectedRevisionId, null);
  assert.equal(input.expectedCurrentFingerprint, "synthetic-fingerprint");
  assert.equal(input.idempotencyKey, "retained-synthetic-uuid");
  assert.equal(input.observations.measurements[0].value, 0);
  assert.equal(input.observations.measurements[0].lowerLimit, 0);
  assert.equal(input.observations.measurements[0].upperLimit, 5);
  assert.equal(input.observations.measurements[0].instrument, h.draft.readings[0].instrument);
});

test("history, retained legacy evidence and review add context without replacing exact JSON", () => {
  assert.equal((source.match(/<ObservationContext\s+value=/g) ?? []).length, 3);
  assert.ok(source.includes("<ObservationContext value={r.result.observations}"));
  assert.match(source, /<ObservationContext\s+value=\{[\s\S]*?r.legacyPrior.captured.observations/);
  assert.ok(source.includes("<ObservationContext value={draft.context}"));
  assert.ok(source.includes("JSON.stringify(r.result.observations, null, 2)"));
  assert.ok(source.includes("JSON.stringify(r.legacyPrior, null, 2)"));
  assert.ok(source.includes("JSON.stringify(draft.baseline.frozenEvidence, null, 2)"));
});
