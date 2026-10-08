import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const source = readFileSync(
  new URL("../app/projects/[projectId]/test-cases/page.tsx", import.meta.url),
  "utf8",
);
const ast = ts.createSourceFile(
  "page.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
function section(label) {
  let found;
  function visit(node) {
    if (
      ts.isJsxElement(node) &&
      node.openingElement.attributes.properties.some(
        (attribute) =>
          ts.isJsxAttribute(attribute) &&
          attribute.name.getText(ast) === "aria-label" &&
          attribute.initializer?.text === label,
      )
    )
      found = node;
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(found, label);
  return found.getText(ast);
}
function fixture(readOnly = false) {
  const events = [],
    analyses = [];
  const sandbox = {
    React,
    styles: {},
    readOnly,
    projectId: "synthetic-project",
    project: { organizationId: "synthetic-org" },
    search: "",
    filters: [],
    activeViewId: "",
    viewsQuery: { isLoading: false, data: [] },
    visibleCases: [{ id: "case-a" }],
    cases: [
      { id: "case-a", archived: false, reviewStatus: "APPROVED" },
      { id: "archived", archived: true, reviewStatus: "APPROVED" },
      { id: "pending", archived: false, reviewStatus: "PENDING_REVIEW" },
    ],
    selected: new Set(["case-a"]),
    reload: () => events.push("reload"),
    setSearch: (value) => events.push(value),
    applyView: (value) => events.push(value),
    setFiltersOpen: (value) => events.push(["filters", value]),
    setAddOpen: (value) => events.push(["add", value]),
    setMoreOpen: (value) => events.push(["more", value]),
    CaseQueryExplorer: () =>
      React.createElement("button", null, "Advanced query"),
    NewCaseFromAuthoringPreset: () =>
      React.createElement("button", null, "Add from preset"),
    DurableCaseAnalysis: (props) => {
      analyses.push(props);
      return React.createElement("button", null, props.buttonLabel);
    },
    BulkCaseAnalysis: (props) => {
      analyses.push(props);
      return React.createElement("button", null, "Analyze selected cases");
    },
  };
  vm.createContext(sandbox);
  const render = (label) => {
    const compiled = ts.transpileModule(
      `function renderSection(){return (${section(label)});}`,
      {
        compilerOptions: {
          jsx: ts.JsxEmit.React,
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.None,
        },
      },
    ).outputText;
    vm.runInContext(compiled, sandbox);
    return sandbox.renderSection();
  };
  return { render, events, analyses };
}
test("actual primary toolbar renders search, views and three actions without advanced controls", () => {
  const h = fixture(),
    element = h.render("Case library tools");
  const html = renderToStaticMarkup(element);
  assert.match(html, /Search test cases/);
  assert.match(html, /Saved view/);
  assert.equal((html.match(/<button/g) ?? []).length, 3);
  assert.doesNotMatch(html, /Analyze|Advanced query|Add from preset/);
  const buttons = React.Children.toArray(element.props.children).filter(
    (child) => child.type === "button",
  );
  buttons.forEach((button) => button.props.onClick());
  assert.deepEqual(h.events, [
    ["filters", true],
    ["add", true],
    ["more", true],
  ]);
  assert.doesNotMatch(
    renderToStaticMarkup(fixture(true).render("Case library tools")),
    />Add case</,
  );
});
test("actual closed disclosure retains explicit analysis scopes and existing reviewed callers", () => {
  const h = fixture(),
    element = h.render("Advanced case library tools");
  assert.equal(element.type, "details");
  assert.equal(element.props.open, undefined);
  const html = renderToStaticMarkup(element);
  assert.match(html, /Advanced query, presets &amp; risk analysis/);
  assert.match(html, /Analyze filtered suite \(1\)/);
  assert.match(html, /Analyze all loaded approved cases \(1\)/);
  assert.match(html, /Analyze selected cases/);
  assert.match(html, /Add from preset/);
  assert.deepEqual(
    h.analyses.map((props) => Array.from(props.selectedIds)),
    [["case-a"], ["case-a"], ["case-a"]],
  );
  assert.ok(
    h.analyses.every(
      (props) =>
        props.projectId === "synthetic-project" &&
        typeof props.onCompleted === "function",
    ),
  );
});
test("help folds guidance only; immediate scope and uncertain-state notices remain", () => {
  assert.match(source, /<summary>Help: keyboard ordering<\/summary>/);
  assert.match(source, /<summary>Manage case authoring presets<\/summary>/);
  assert.match(
    source,
    /Saved views could not be loaded\. Current filters are retained/,
  );
  assert.match(
    source,
    /Read-only library\. Select cases to preview analysis costs/,
  );
  assert.match(source, /Unsaved changes to/);
  assert.match(source, /key=\{`\$\{projectId\}:folders`\}/);
  assert.match(source, /key=\{`\$\{projectId\}:run-configuration`\}/);
  assert.doesNotMatch(source, /onFolderCatalog=/);
});
