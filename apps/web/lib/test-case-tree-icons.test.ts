// Actual tree, shared Icon and IconButton declarations with synthetic folder
// metadata/events. No browser, native persistence or authorization acceptance.
import { readFileSync } from "node:fs";
import vm from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { expect, it } from "vitest";
import * as helpers from "./case-folder-tree";

type Element = React.ReactElement<Record<string, unknown>>;
type Control = React.ComponentType<Record<string, unknown>>;
function declarations(file: string, names: readonly string[]) {
  const source = readFileSync(new URL(file, import.meta.url), "utf8");
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  return ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text ?? ""))
    .map(node => ts.createPrinter().printNode(ts.EmitHint.Unspecified, node, ast).replace(/\bexport (?=function)/g, "")).join("\n");
}
function installIcons(scope: vm.Context) {
  for (const [file, name] of [["../components/ui/Workspace.tsx", "Icon"], ["../components/ui/IconButton.tsx", "IconButton"]] as const) {
    vm.runInContext(ts.transpileModule(declarations(file, [name]), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React },
    }).outputText, scope);
  }
  return (scope as unknown as { IconButton: Control }).IconButton;
}
const iconScope = vm.createContext({ React, useId: React.useId, useState: React.useState });
const IconButton = installIcons(iconScope);
function elements(value: unknown): Element[] {
  if (React.isValidElement(value)) {
    const element = value as Element;
    return [element, ...elements(element.props.children)];
  }
  return Array.isArray(value) ? value.flatMap(elements) : [];
}
const catalog: helpers.CaseFolderCatalog = {
  projectId: "synthetic-project", organizationId: "synthetic-org", clerkActorId: "synthetic-actor", canEdit: true,
  paths: ["Source", "Native", "Destination", "a//b", "__unassigned__"],
  folders: [{ id: "stable-native", path: "Native" }, { id: "stable-destination", path: "Destination" }],
};
function treeHarness(path = "Native", reader: helpers.CaseFolderCatalog | null = catalog, hasReview = true) {
  const states: unknown[] = [];
  let cursor = 0;
  const selections: unknown[] = [], reviews: unknown[] = [], moves: unknown[] = [], refusals: string[] = [], focused: string[] = [];
  const cases = [{ id: "stable-case", title: "Synthetic case", suitePath: path === "Native" ? path : null, sourceFilePath: path === "Native" ? null : path }];
  const props = {
    node: { name: path, path, children: new Map(), cases }, depth: 0, selectedPath: null,
    catalog: reader, metadata: helpers.caseFolderNodeCatalog(cases, reader),
    onSelect: (value: unknown) => selections.push(value),
    onFolderReview: hasReview ? (value: unknown) => reviews.push(value) : undefined,
    onDropCase: (id: string, suite: string | null) => moves.push([id, suite]),
    onDropRefused: (value: string) => refusals.push(value),
  };
  const scope = vm.createContext({
    React, IconButton, ...helpers, UNASSIGNED: "__unassigned__", useId: () => "synthetic-folder-tools",
    useState: (initial: unknown) => {
      const index = cursor++;
      if (!(index in states)) states[index] = initial;
      return [states[index], (next: unknown) => {
        states[index] = typeof next === "function" ? (next as (value: unknown) => unknown)(states[index]) : next;
      }];
    },
    document: { getElementById: (id: string) => ({ focus: () => focused.push(id) }) },
  });
  vm.runInContext(ts.transpileModule(declarations("../components/TestCaseTree.tsx", ["TreeNodeView", "countCases"]), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React },
  }).outputText, scope);
  function render() {
    cursor = 0;
    return (scope as unknown as { TreeNodeView(props: unknown): Element }).TreeNodeView(props);
  }
  function tool(label: string) {
    const found = elements(render()).find(node => node.type === IconButton && node.props.label === label);
    if (!found) throw Error("Actual folder icon absent: " + label);
    return found;
  }
  function row() {
    const found = elements(render()).find(node => node.props.role === "button");
    if (!found) throw Error("Actual selection/drop row absent");
    return found;
  }
  function group() {
    const found = elements(render()).find(node => node.props.role === "group");
    if (!found) throw Error("Actual folder tool group absent");
    return found;
  }
  function click(label: string) { (tool(label).props.onClick as () => void)(); }
  function event(type: string, raw = "stable-case") {
    const written: Array<[string, string]> = [];
    const value = { defaultPrevented: false, stopped: false, preventDefault() { value.defaultPrevented = true; }, stopPropagation() { value.stopped = true; },
      dataTransfer: { types: [type], dropEffect: "none", effectAllowed: "none", getData: () => raw, setData: (mime: string, body: string) => written.push([mime, body]) } };
    return { value, written };
  }
  return { props, render, tool, row, group, click, event, selections, reviews, moves, refusals, focused,
    html: () => renderToStaticMarkup(render()) };
}
function keyEvent(key = "Escape") {
  const event = { key, defaultPrevented: false, stopped: false, preventDefault() { event.defaultPrevented = true; }, stopPropagation() { event.stopped = true; } };
  return event;
}

it("closed suite tools have an aligned named SVG toggle and no nested selection buttons or permanent text row", () => {
  const h = treeHarness(), html = h.html(), toggle = h.tool("Folder actions for Native");
  expect(toggle.props.icon).toBe("more");
  expect(toggle.props.className).toBe("tree-node-actions-toggle");
  expect(toggle.props["aria-expanded"]).toBe(false);
  expect(toggle.props["aria-controls"]).toBe(h.group().props.id);
  expect(h.group().props.hidden).toBe(true);
  expect(h.group().props.style).toMatchObject({ display: "none" });
  const shell = elements(h.render()).find(node => node.props.className === "tree-node-shell")!;
  expect(elements(shell).filter(node => node.type === IconButton)).toHaveLength(1);
  expect(elements(h.row()).some(node => node.type === "button" || node.type === IconButton)).toBe(false);
  expect(html.match(/<svg/g)).toHaveLength(4);
  expect(html).toContain('aria-label="Folder actions for Native"');
  expect(html).not.toContain("<summary");
  expect(html).not.toMatch(/>Folder actions<|>Move…<|>Rename…<|>⠿</);
  expect(h.selections).toEqual([]); expect(h.reviews).toEqual([]); expect(h.moves).toEqual([]);
});

it("deliberate toggle shows only SVG tools and does not select a suite or submit a review", () => {
  const h = treeHarness(); h.click("Folder actions for Native");
  expect(h.tool("Folder actions for Native").props["aria-expanded"]).toBe(true);
  expect(h.group().props.hidden).toBe(false);
  expect(h.group().props.style).toMatchObject({ display: "flex" });
  expect(elements(h.group()).filter(node => node.type === IconButton).map(node => node.props.icon)).toEqual(["drag", "arrow", "edit"]);
  expect(h.html()).toContain('aria-label="Drag Native to review a folder move"');
  expect(h.html()).toContain('aria-label="Move folder Native"');
  expect(h.html()).toContain('aria-label="Rename folder Native"');
  h.click("Folder actions for Native"); expect(h.group().props.hidden).toBe(true);
  expect(h.selections).toEqual([]); expect(h.reviews).toEqual([]); expect(h.moves).toEqual([]);
});

it.each(["Native", "Source"])("actual %s folder tools emit original scoped review intents, not mutation or selection", path => {
  const h = treeHarness(path); h.click(`Folder actions for ${path}`);
  h.click(path === "Source" ? "Organize source group Source" : "Move folder Native");
  h.click(`Rename folder ${path}`);
  expect(h.reviews).toEqual(["MOVE", "RENAME"].map(action => ({ projectId: catalog.projectId, organizationId: catalog.organizationId, clerkActorId: catalog.clerkActorId, action, fromPath: path })));
  expect(h.moves).toEqual([]); expect(h.selections).toEqual([]);
});

it("drag icon preserves exact folder MIME, native helper encoding and move effect", () => {
  const h = treeHarness(); h.click("Folder actions for Native");
  const { value, written } = h.event(helpers.FOLDER_DRAG_TYPE);
  expect(h.tool("Drag Native to review a folder move").props.draggable).toBe(true);
  (h.tool("Drag Native to review a folder move").props.onDragStart as (event: unknown) => void)(value);
  expect(written).toEqual([[helpers.FOLDER_DRAG_TYPE, helpers.encodeFolderDrag(catalog, "Native")]]);
  expect(value.dataTransfer.effectAllowed).toBe("move");
  expect(h.reviews).toEqual([]); expect(h.moves).toEqual([]); expect(h.selections).toEqual([]);
});

it("selection and original native/source-only drop behavior remain distinct from icon actions", () => {
  const native = treeHarness(); (native.row().props.onClick as () => void)(); expect(native.selections).toEqual(["Native"]);
  const nativeDrop = native.event("application/x-vaettir-test-case");
  (native.row().props.onDrop as (event: unknown) => void)(nativeDrop.value);
  expect(native.moves).toEqual([["stable-case", "Native"]]);
  const source = treeHarness("Source"), refused = source.event("application/x-vaettir-test-case");
  (source.row().props.onDrop as (event: unknown) => void)(refused.value);
  expect(source.moves).toEqual([]); expect(source.refusals[0]).toContain("source-only");
  const reviewed = source.event(helpers.FOLDER_DRAG_TYPE, helpers.encodeFolderDrag(catalog, "Native"));
  (source.row().props.onDrop as (event: unknown) => void)(reviewed.value);
  expect(source.reviews).toEqual([helpers.reviewedFolderDrop(helpers.encodeFolderDrag(catalog, "Native"), catalog, "Source")]);
});

it.each([null, { ...catalog, canEdit: false }])("unverified/read-only scope %j keeps browsing but no mutation tools", reader => {
  const h = treeHarness("Native", reader);
  expect(elements(h.render()).some(node => node.type === IconButton)).toBe(false);
  expect(h.html()).not.toContain("draggable");
  (h.row().props.onKeyDown as (event: unknown) => void)(keyEvent("Enter"));
  expect(h.selections).toEqual(["Native"]); expect(h.reviews).toEqual([]); expect(h.moves).toEqual([]);
});

it.each(["a//b", "__unassigned__"])("unsupported raw %s remains literal without tools or path normalization", path => {
  const h = treeHarness(path), html = h.html();
  expect(elements(h.render()).some(node => node.type === IconButton)).toBe(false);
  expect(html).toContain(path); expect(html).toContain("Raw path retained");
  expect(html).not.toContain("draggable");
  expect(h.reviews).toEqual([]); expect(h.moves).toEqual([]);
});

it("missing review capability withholds folder tools without removing selection", () => {
  const h = treeHarness("Native", catalog, false);
  expect(elements(h.render()).some(node => node.type === IconButton)).toBe(false);
  (h.row().props.onClick as () => void)(); expect(h.selections).toEqual(["Native"]);
});

it("actual shared tooltip dismisses before a later Escape collapses the folder group and restores toggle focus", () => {
  const h = treeHarness(); h.click("Folder actions for Native");
  const slots: unknown[] = []; let cursor = 0;
  const scope = vm.createContext({ React, useId: () => "synthetic-tooltip", useState: (initial: unknown) => {
    const index = cursor++; if (!(index in slots)) slots[index] = initial;
    return [slots[index], (value: unknown) => { slots[index] = value; }];
  } });
  const TooltipControl = installIcons(scope);
  function render() { cursor = 0; return (TooltipControl as (props: unknown) => Element)(h.tool("Rename folder Native").props); }
  let node = render();
  const button = (node.props.children as Element[])[0]!;
  (button.props.onFocus as (event: unknown) => void)({}); node = render();
  expect(renderToStaticMarkup(node)).toContain('role="tooltip"');
  expect(renderToStaticMarkup(node)).toContain("Rename folder Native");
  const first = keyEvent();
  ((node.props.children as Element[])[0]!.props.onKeyDown as (event: unknown) => void)(first);
  (h.group().props.onKeyDown as (event: unknown) => void)(first);
  expect(first.defaultPrevented).toBe(true); expect(first.stopped).toBe(true);
  expect(h.group().props.hidden).toBe(false); expect(h.focused).toEqual([]);
  expect(renderToStaticMarkup(render())).not.toContain('role="tooltip"');
  const second = keyEvent();
  ((render().props.children as Element[])[0]!.props.onKeyDown as (event: unknown) => void)(second);
  (h.group().props.onKeyDown as (event: unknown) => void)(second);
  expect(h.group().props.hidden).toBe(true);
  expect(h.focused).toEqual(["synthetic-folder-tools-toggle"]);
  expect(h.reviews).toEqual([]); expect(h.moves).toEqual([]); expect(h.selections).toEqual([]);
});
