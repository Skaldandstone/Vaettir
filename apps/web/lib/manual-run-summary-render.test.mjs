import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as helpers from "./manual-run-summary.ts";
import { summaryFixture } from "./manual-run-summary.fixture.mjs";
const elements = element => !React.isValidElement(element) ? [] : [element, ...React.Children.toArray(element.props.children).flatMap(elements)];
function declarations(path, names) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8"), ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), printer = ts.createPrinter();
  return ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text)).map(node => printer.printNode(ts.EmitHint.Unspecified, node, ast).replace(/\bexport (?=function)/g, "")).join("\n");
}
const visual = declarations("../components/ManualRunSummaryVisual.tsx", ["ManualRunSummaryVisual"]), distribution = declarations("../components/MetricVisuals.tsx", ["DistributionBar"]);
test("actual manual summary visual exposes trusted counts, partial work, all verdicts/exclusions and exact read scope", () => {
  const compiled = ts.transpileModule(`${distribution}\n${visual}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React } }).outputText;
  const h = { React, ...helpers }; vm.createContext(h); vm.runInContext(compiled, h);
  const { value } = summaryFixture(); value.scope.build = "<script>synthetic</script>";
  const html = renderToStaticMarkup(React.createElement(h.ManualRunSummaryVisual, { value }));
  for (const text of ["1702", "1699", "Partial steps", "Recorded tests", "Remaining tests", "Excluded runs", "0.18% recorded (3 of 1702 planned tests)", "1 included run is", "Blocked", "Skipped", "same case in two runs counts twice", "not release readiness", "2026-01-01", "2026-01-02", value.asOf, "Unsupported saved scope", "Ambiguous or duplicate", "Untracked legacy", "Current head/status"]) assert.ok(html.toLowerCase().includes(text.toLowerCase()), text);
  assert.ok(html.includes("&lt;script&gt;synthetic&lt;/script&gt;")); assert.ok(!html.includes("<script>"));
  assert.match(html, /overflow-x:auto/); assert.match(html, /max="1702" value="3"/);
});
const wrapperSource = readFileSync(new URL("../components/ManualRunDashboardSummary.tsx", import.meta.url), "utf8");
test("mounted wrapper queries only explicit active original scope and rejects cached/mismatched reads", () => {
  for (const content of ["enabled: ready", "currentActor && originalSession === auth.sessionId", "manual-case-heads:${recordedExecutionTrendKey(input)}", "!query.error && !query.isFetching && !query.isPaused && query.isFetchedAfterMount", "manualSummaryScopeMatches(query.data, scope, clerkActorId, expectedKey)", "return () => { latest.current = { ready: false, value: null", "if (!active || !scope) return null"]) assert.ok(wrapperSource.includes(content), content);
  assert.ok(!wrapperSource.includes(".useMutation("));
});
function exportHarness() {
  const ast = ts.createSourceFile("wrapper.tsx", wrapperSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), printer = ts.createPrinter();
  const component = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "ManualRunDashboardSummary");
  const handlers = component.body.statements.filter(node => ts.isFunctionDeclaration(node) && ["reviewCsv", "exportCsv"].includes(node.name?.text)).map(node => printer.printNode(ts.EmitHint.Unspecified, node, ast)).join("\n");
  const compiled = ts.transpileModule(handlers, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const { value } = summaryFixture(), downloads = [];
  const h = { ...helpers, latest: { current: { ready: true, value, epoch: 2, revision: 10 } }, reviewed: null, message: "", setMessage: value => { h.message = value; }, setReviewed: value => { h.reviewed = value; }, downloadFile: (...args) => downloads.push(args) };
  vm.createContext(h); vm.runInContext(compiled, h); return { h, downloads };
}
test("actual reviewed CSV handler requires explicit review and rechecks access after construction", () => {
  const { h, downloads } = exportHarness();
  h.exportCsv(); assert.equal(downloads.length, 0); assert.match(h.message, /Review the exact fresh/);
  h.reviewCsv(); h.exportCsv(); assert.equal(downloads.length, 1); assert.equal(downloads[0][2], "text/csv");
  assert.ok(downloads[0][1].includes("1702"));
  h.renderManualRunSummaryCsv = value => { const csv = helpers.renderManualRunSummaryCsv(value); h.latest.current = { ...h.latest.current, ready: false }; return csv; };
  h.exportCsv(); assert.equal(downloads.length, 1); assert.match(h.message, /Nothing was exported/);
});
test("actual retained wrapper hides cached counts on reopen and session loss/recovery until native refresh", () => {
  const { value, input } = summaryFixture(), hooks = [], effects = [];
  const auth = { isLoaded: true, isSignedIn: true, userId: "synthetic-actor", sessionId: "synthetic-session" };
  let cursor = 0, dirty = false, reads = 0;
  const query = { data: value, dataUpdatedAt: 100, error: null, isFetching: false, isPaused: false, isFetchedAfterMount: true, refetch: () => { reads++; return Promise.resolve({ data: query.data }); } };
  const h = { React, ...helpers, useAuth: () => auth, ManualRunSummaryVisual: function FixtureVisual() { return null; }, downloadFile: () => assert.fail("render must not download"),
    recordedExecutionTrendKey: scope => JSON.stringify(scope),
    trpcReact: { recordedExecutionTrends: { manualSummary: { useQuery: (_input, options) => { h.enabled = options.enabled; return query; } } } },
    useState: initial => { const index = cursor++; if (!Object.hasOwn(hooks, index)) hooks[index] = typeof initial === "function" ? initial() : initial; return [hooks[index], next => { if (!Object.is(hooks[index], next)) { hooks[index] = next; dirty = true; } }]; },
    useRef: initial => { const index = cursor++; return hooks[index] ??= { current: initial }; },
  };
  const effect = (callback, deps) => { const index = cursor++, previous = effects[index]; if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) { previous?.cleanup?.(); effects[index] = { deps, cleanup: callback() }; } };
  h.useEffect = effect; h.useLayoutEffect = effect;
  vm.createContext(h);
  const compiled = ts.transpileModule(declarations("../components/ManualRunDashboardSummary.tsx", ["ManualRunDashboardSummary"]), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React } }).outputText;
  vm.runInContext(compiled, h);
  const props = { active: true, scope: input, clerkActorId: "synthetic-actor" };
  function render() { let tree; for (let attempt = 0; attempt < 12; attempt++) { dirty = false; cursor = 0; tree = h.ManualRunDashboardSummary(props); if (!dirty) return tree; } throw Error("Synthetic hook host did not settle"); }
  const visible = tree => elements(tree).some(node => node.type === h.ManualRunSummaryVisual);
  assert.equal(visible(render()), false, "first activation must not show cached success"); assert.equal(reads, 1);
  query.dataUpdatedAt = 101; assert.equal(visible(render()), true);
  props.active = false; assert.equal(render(), null); assert.equal(h.enabled, false);
  props.active = true; assert.equal(visible(render()), false, "reopen cannot reauthorize cached counts"); assert.equal(reads, 2);
  query.dataUpdatedAt = 102; assert.equal(visible(render()), true);
  auth.isSignedIn = false; assert.equal(visible(render()), false); assert.equal(h.enabled, false);
  auth.isSignedIn = true; assert.equal(visible(render()), false, "same session recovery needs a newer native revision"); assert.equal(reads, 3);
  query.dataUpdatedAt = 103; assert.equal(visible(render()), true);
  query.error = Error("Synthetic read failure"); assert.equal(visible(render()), false, "error must not look empty or retain cached success");
});
