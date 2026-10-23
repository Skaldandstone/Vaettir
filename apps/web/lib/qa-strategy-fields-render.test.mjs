import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as helpers from "./qa-strategy-fields.ts";
import { describeRetainedPlanValue } from "./plan-custom-fields.ts";
const source = readFileSync(new URL("../components/TestPlanDetailContent.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("TestPlanDetailContent.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const printer = ts.createPrinter(), names = ["StringListField", "SuggestRiskAreasButton", "QaStrategyForm"];
const declarations = ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text)).map(node => printer.printNode(ts.EmitHint.Unspecified, node, ast));
const compiled = ts.transpileModule(declarations.join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React } }).outputText;
const elements = element => !React.isValidElement(element) ? [] : [element, ...React.Children.toArray(element.props.children).flatMap(elements)];
function harness() {
  const hooks = [], cleanups = [];
  let cursor = 0;
  const pendingRequests = [];
  const auth = { isLoaded: true, isSignedIn: true, userId: "synthetic-actor", sessionId: "synthetic-session" };
  const sandbox = { React, ...helpers, describeRetainedPlanValue, useId: () => "synthetic-opaque", useAuth: () => auth,
    useRef: value => { const index = cursor++; return hooks[index] ??= { current: value }; },
    useState: initial => { const index = cursor++; if (!Object.hasOwn(hooks, index)) hooks[index] = typeof initial === "function" ? initial() : initial; return [hooks[index], value => { hooks[index] = value; }]; },
    useLayoutEffect: callback => { const index = cursor++; cleanups[index]?.(); cleanups[index] = callback(); },
    trpcReact: { useUtils: () => ({ testPlans: { suggestRiskAreas: { fetch: () => new Promise(resolve => pendingRequests.push(resolve)) } } }) },
  };
  vm.createContext(sandbox); vm.runInContext(compiled, sandbox);
  return { sandbox, auth, hooks, render(name, props) { cursor = 0; return sandbox[name](props); }, resolve(value, index = 0) { pendingRequests[index](value); }, unmount() { cleanups.forEach(cleanup => cleanup?.()); } };
}
test("actual mounted QA row keys survive selected removal and preserve multiline values", () => {
  const h = harness(); let values = ["same", "same", ""], next;
  const props = () => ({ label: "Risk areas", hint: "Synthetic", placeholder: "", values, onChange: value => { next = value; } });
  const first = elements(h.render("StringListField", props()));
  const rowKeys = first.filter(node => node.type === "div" && String(node.key).includes("synthetic-opaque")).map(node => node.key);
  first.find(node => node.type === "button" && node.props["aria-label"] === "Remove Risk areas row 1").props.onClick(); values = Array.from(next);
  const second = elements(h.render("StringListField", props()));
  const surviving = second.filter(node => node.type === "div" && String(node.key).includes("synthetic-opaque")).map(node => node.key);
  assert.equal(surviving.length, 2); assert.deepEqual(surviving, rowKeys.slice(1));
  second.find(node => node.type === "textarea").props.onChange({ target: { value: " retain,exact\ntext " } });
  assert.deepEqual(Array.from(next), [" retain,exact\ntext ", ""]);
});
test("actual strategy form retains unsupported raw values and does not mount add/suggestion controls for that field", () => {
  const h = harness(), raw = ["keep", 3, null, "<script>synthetic</script>"];
  const tree = h.render("QaStrategyForm", { projectId: "synthetic-project", values: { riskAreas: raw }, onChange: () => assert.fail("render must not write") });
  const sections = elements(tree).filter(node => node.type === "section");
  const risk = sections[0];
  assert.ok(!elements(risk).some(node => typeof node.type === "function"));
  const html = renderToStaticMarkup(risk);
  assert.match(html, /no items were filtered or replaced/); assert.match(html, /3/); assert.match(html, /null/);
  assert.match(html, /&lt;script&gt;synthetic&lt;\/script&gt;/);
  assert.doesNotMatch(source, /asStringArray/);
});
test("actual delayed suggestion handler refuses newer exact field/sibling/session changes and unmount", async () => {
  for (const change of ["list", "sibling", "session", "unmount", "temporary-readiness-loss"]) {
    const h = harness(), original = { riskAreas: ["old"], other: [null, 3] }, writes = [];
    const props = values => ({ projectId: "synthetic-project", existing: values.riskAreas, fingerprint: helpers.qaStrategyFingerprint("synthetic-project", values), onAdd: value => writes.push(value) });
    const button = elements(h.render("SuggestRiskAreasButton", props(original))).find(node => node.type === "button");
    const waiting = button.props.onClick();
    if (change === "unmount") h.unmount(); else {
      if (change === "temporary-readiness-loss") { h.auth.isSignedIn = false; h.render("SuggestRiskAreasButton", props(original)); h.auth.isSignedIn = true; }
      if (change === "session") h.auth.sessionId = "other-session";
      h.render("SuggestRiskAreasButton", props(change === "list" ? { ...original, riskAreas: ["new"] } : change === "sibling" ? { ...original, other: [null, 4] } : original));
    }
    h.resolve([{ area: "synthetic suggestion" }]); await waiting;
    assert.deepEqual(writes, [], change);
  }
});
test("actual same-current suggestion appends only via the latest callback and preserves existing duplicate/blank entries", async () => {
  const h = harness(), values = { riskAreas: ["", "same", "same"], unknown: { retain: true } }, writes = [];
  const form = h.render("QaStrategyForm", { projectId: "synthetic-project", values, onChange: value => writes.push(value) });
  const suggestion = elements(form).find(node => typeof node.type === "function" && node.type.name === "SuggestRiskAreasButton");
  const waiting = elements(h.render("SuggestRiskAreasButton", suggestion.props)).find(node => node.type === "button").props.onClick();
  h.resolve([{ area: "same" }, { area: "new, exact\narea" }]); await waiting;
  assert.deepEqual(Array.from(writes[0].riskAreas), ["", "same", "same", "new, exact\narea"]);
  assert.equal(writes[0].unknown, values.unknown);
});
test("actual older deferred success cannot replace a newer generation's notice or loading state", async () => {
  const h = harness(), writes = [];
  const props = text => ({ projectId: "synthetic-project", existing: [text], fingerprint: helpers.qaStrategyFingerprint("synthetic-project", { riskAreas: [text] }), onAdd: value => writes.push(value) });
  const first = elements(h.render("SuggestRiskAreasButton", props("old"))).find(node => node.type === "button").props.onClick();
  const second = elements(h.render("SuggestRiskAreasButton", props("new"))).find(node => node.type === "button").props.onClick();
  assert.equal(h.hooks[0], true);
  h.resolve([{ area: "old late suggestion" }]); await first;
  assert.equal(h.hooks[0], true, "older finally must not clear newer pending state");
  h.resolve([], 1); await second;
  assert.match(h.hooks[1], /No open risk flags/);
  assert.deepEqual(writes, []);
  // Also prove the newer notice survives when it arrives before old success.
  const r = harness();
  const pendingOld = elements(r.render("SuggestRiskAreasButton", props("old"))).find(node => node.type === "button").props.onClick();
  const pendingNew = elements(r.render("SuggestRiskAreasButton", props("new"))).find(node => node.type === "button").props.onClick();
  r.resolve([], 1); await pendingNew;
  const newNotice = r.hooks[1]; r.resolve([{ area: "old late suggestion" }]); await pendingOld;
  assert.equal(r.hooks[1], newNotice);
});
