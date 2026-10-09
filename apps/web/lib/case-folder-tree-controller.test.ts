import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as helpers from "./case-folder-tree";
import { retainedTraceabilityReceipt } from "./traceability-receipt";
const iconScope = vm.createContext({React, useId: React.useId, useState: React.useState});
vm.runInContext(ts.transpileModule(declarations("../components/ui/Workspace.tsx", ["Icon"]), {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React}}).outputText, iconScope);
vm.runInContext(ts.transpileModule(declarations("../components/ui/IconButton.tsx", ["IconButton"]), {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React}}).outputText, iconScope);
const IconButton = iconScope.IconButton;
const catalog: helpers.CaseFolderCatalog = { projectId: "synthetic-project", organizationId: "synthetic-org", clerkActorId: "synthetic-actor", canEdit: true, paths: ["Source", "Native", "Destination", "Empty"], folders: [{ id: "stable-destination", path: "Destination" }, { id: "stable-empty", path: "Empty" }] };
const cases = [{ id: "source", title: "Synthetic source case", suitePath: null, sourceFilePath: "Source" }, { id: "native", title: "Synthetic native case", suitePath: "Native", sourceFilePath: "Original" }];
function declarations(file: string, names: string[]) {
  const source = readFileSync(new URL(file, import.meta.url), "utf8"), ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), printer = ts.createPrinter();
  return ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text ?? "")).map(node => printer.printNode(ts.EmitHint.Unspecified, node, ast).replace(/\bexport (?=function)/g, "")).join("\n");
}
function elements(node: React.ReactNode): React.ReactElement<Record<string, unknown>>[] { return !React.isValidElement<Record<string, unknown>>(node) ? [] : [node, ...React.Children.toArray(node.props.children as React.ReactNode).flatMap(elements)]; }
function treeHarness(scope: helpers.CaseFolderCatalog | null = catalog) {
  const intents: unknown[] = [], moves: unknown[] = [], refusals: string[] = [], selections: unknown[] = [];
  const h: Record<string, unknown> = { React, IconButton, ...helpers, UNASSIGNED: "__unassigned__", useId: () => "synthetic-folder-tools", useMemo: (factory: () => unknown) => factory(), useState: (value: unknown) => [value, () => undefined] };
  vm.createContext(h); vm.runInContext(ts.transpileModule(declarations("../components/TestCaseTree.tsx", ["effectiveLocation", "buildTree", "TreeNodeView", "countCases", "TestCaseTree", "filterCasesByPath"]), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React } }).outputText, h);
  const metadata = helpers.caseFolderNodeCatalog(cases, scope);
  function node(path: string) { return (h.TreeNodeView as (props: unknown) => React.ReactElement)({ node: { name: path, path, children: new Map(), cases: cases.filter(item => (item.suitePath || item.sourceFilePath) === path) }, depth: 0, selectedPath: null, catalog: scope, metadata, onSelect: (path: unknown) => selections.push(path), onDropCase: (...args: unknown[]) => moves.push(args), onFolderReview: (value: unknown) => intents.push(value), onDropRefused: (value: string) => refusals.push(value) }); }
  function event(type: string, payload: string) { return { preventDefault() {}, stopPropagation() {}, dataTransfer: { types: [type], getData: () => payload, dropEffect: "", setData() {}, effectAllowed: "" } }; }
  return { h, node, event, intents, moves, refusals, selections };
}
async function drain() { for (let i = 0; i < 10; i++) await Promise.resolve(); }
function foldersHarness(feedback = false) {
  const hooks: unknown[] = [], effects: Array<{ deps: unknown[]; cleanup?: () => void }> = [];
  let cursor = 0, dirty = false, reads = 0;
  const auth = { isLoaded: true, isSignedIn: true, userId: catalog.clerkActorId }, catalogUpdates: unknown[] = [], writes: unknown[] = [];
  const list = { data: { ...catalog, revision: 1 }, error: null, isError: false, isFetching: false, isPaused: false, isFetchedAfterMount: true, fetchStatus: "idle", refetch: () => { reads++; return Promise.resolve({ isError: false, data: list.data }); } };
  const project = { data: { id: catalog.projectId, organizationId: catalog.organizationId }, error: null, isFetching: false, isPaused: false, refetch: () => Promise.resolve({}) };
  const organizations = { data: [{ id: catalog.organizationId }], error: null, isFetching: false, isPaused: false, refetch: () => Promise.resolve({}) };
  const preview = { data: {} as Record<string, unknown>, isError: false, error: null, isFetchedAfterMount: true, fetchStatus: "idle", refetch: () => Promise.resolve({ isError: false, data: preview.data }) };
  let callbacks: { onError: (cause: unknown) => void };
  const mutation = { isPending: false, isError: false, reset() {}, mutate: (input: unknown) => { writes.push(input); mutation.isPending = true; } };
  function Modal(props: { open: boolean; children: React.ReactNode }) { return props.open ? React.createElement("div", { role: "dialog" }, props.children) : null; }
  let parentCatalog: unknown;
  const props = { projectId: catalog.projectId, selectedPath: "Source", onFolderPaths: () => undefined, onSaved: () => undefined, onFolderCatalog: (value: unknown) => { catalogUpdates.push(value); if (feedback && !Object.is(parentCatalog, value)) { parentCatalog = value; dirty = true; } }, requestedIntent: null as helpers.FolderReviewIntent | null };
  const h: Record<string, unknown> = { React, IconButton, ...helpers, retainedTraceabilityReceipt, control: { display: "block" }, useAuth: () => auth, Modal, TestCaseFolderRecovery: () => null, TestCaseFolderCopy: () => null, crypto: { randomUUID: () => "c0987e9a-50e2-4b54-93b1-6e6cf2822b53" },
    trpcReact: { project: { byId: { useQuery: () => project } }, organization: { mine: { useQuery: () => organizations } }, caseFolders: { list: { useQuery: () => list }, preview: { useQuery: (input: { action: string; fromPath?: string; toPath: string }) => { preview.data = { projectId: catalog.projectId, organizationId: catalog.organizationId, clerkActorId: catalog.clerkActorId, action: input.action, fromPath: input.fromPath ?? null, toPath: input.toPath, expectedHash: "a".repeat(64), caseCount: 851, archivedCaseCount: 2, descendantCount: 1, cases: [{ id: "source", displayId: "SYN-1", fromSuitePath: null, toSuitePath: input.toPath }] }; return preview; } }, write: { useMutation: (value: typeof callbacks) => { callbacks = value; return mutation; } } } },
    useState: (initial: unknown) => { const index = cursor++; if (!Object.hasOwn(hooks, index)) hooks[index] = initial; return [hooks[index], (next: unknown) => { if (!Object.is(hooks[index], next)) { hooks[index] = next; dirty = true; } }]; },
    useRef: (initial: unknown) => { const index = cursor++; return hooks[index] ??= { current: initial }; },
    useMemo: (factory: () => unknown, deps: unknown[]) => { const index = cursor++, old = hooks[index] as { value: unknown; deps: unknown[] } | undefined; if (!old || deps.some((value, i) => !Object.is(value, old.deps[i]))) hooks[index] = { value: factory(), deps }; return (hooks[index] as { value: unknown }).value; },
  };
  const effect = (callback: () => (() => void) | undefined, deps: unknown[]) => { const index = cursor++, old = effects[index]; if (!old || deps.some((value, i) => !Object.is(value, old.deps[i]))) { old?.cleanup?.(); effects[index] = { deps, cleanup: callback() }; } };
  h.useEffect = effect; h.useLayoutEffect = effect; vm.createContext(h); vm.runInContext(ts.transpileModule(declarations("../components/TestCaseFolders.tsx", ["TestCaseFolders"]), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React } }).outputText, h);
  function render() { for (let i = 0; i < 20; i++) { cursor = 0; dirty = false; if (feedback) list.data = structuredClone(list.data); const tree = (h.TestCaseFolders as (props: unknown) => React.ReactElement)(props); if (!dirty) return tree; } throw Error("Synthetic folders controller did not settle."); }
  function button(text: string) { const match = elements(render()).find(node => (node.type === "button" && React.Children.toArray(node.props.children as React.ReactNode).join("") === text) || (node.type === IconButton && node.props.label === text)); if (!match) throw Error(`Missing folder button ${text}`); return match.props; }
  const click = (text: string) => (button(text).onClick as () => unknown)();
  const html = () => renderToStaticMarkup(render());
  async function settled() { render(); await drain(); render(); await drain(); render(); }
  async function intent(id: string, path = "Source") { props.requestedIntent = { id, projectId: catalog.projectId, organizationId: catalog.organizationId, clerkActorId: catalog.clerkActorId, action: "MOVE", fromPath: path, destinationParent: "Destination" }; await settled(); }
  async function approveUnknown() {
    click("Review change"); await settled(); const nodes = elements(render());
    (nodes.find(node => node.type === "textarea")!.props.onChange as (event: unknown) => void)({ target: { value: "Synthetic complete subtree review" } });
    (nodes.find(node => node.type === "input" && node.props.type === "checkbox")!.props.onChange as (event: unknown) => void)({ target: { checked: true } }); render();
    click("Approve folder change"); mutation.isPending = false; callbacks.onError(Error("Synthetic response lost")); await settled();
  }
  return { props, auth, list, writes, catalogUpdates, render, click, button, html, settled, intent, approveUnknown, reads: () => reads };
}
describe("actual tree and folder controller source", () => {
  it("copy and recovery siblings have distinct stable project keys", async () => {
    const host = foldersHarness(); await host.settled();
    const children = (host.render().props as { children: React.ReactNode[] }).children;
    const keys = children.filter(React.isValidElement).map(child => child.key).filter(key => key !== null);
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);
    expect(keys).toEqual([`${catalog.projectId}:copy`, `${catalog.projectId}:recovery`]);
  });
  it("equal fresh query wrappers do not loop through parent catalog state; content and access changes still publish", async () => {
    const host = foldersHarness(true); await host.settled();
    const count = host.catalogUpdates.length; await host.settled();
    expect(host.catalogUpdates).toHaveLength(count);
    host.list.data = { ...host.list.data, canEdit: false }; await host.settled();
    expect((host.catalogUpdates.at(-1) as helpers.CaseFolderCatalog).canEdit).toBe(false);
    host.auth.userId = "other-actor"; await host.settled();
    expect(host.catalogUpdates.at(-1)).toBeNull();
    expect(host.writes).toHaveLength(0);
  });
  it("source-only case drops refuse silent materialization while native-suite case drops retain their existing route", () => {
    const host = treeHarness(); const source = elements(host.node("Source")).find(node => typeof node.props.onDrop === "function")!;
    (source.props.onDrop as (event: unknown) => void)(host.event("application/x-vaettir-test-case", "native"));
    expect(host.moves).toHaveLength(0); expect(host.refusals[0]).toContain("source-only");
    const native = elements(host.node("Native")).find(node => typeof node.props.onDrop === "function")!;
    (native.props.onDrop as (event: unknown) => void)(host.event("application/x-vaettir-test-case", "source")); expect(host.moves).toEqual([["source", "Native"]]);
  });
  it("folder-specific drops and accessible buttons emit review setup only, never a case move or write", () => {
    const host = treeHarness(); const target = elements(host.node("Destination")).find(node => typeof node.props.onDrop === "function")!;
    (target.props.onDrop as (event: unknown) => void)(host.event(helpers.FOLDER_DRAG_TYPE, helpers.encodeFolderDrag(catalog, "Source")));
    expect(host.intents).toEqual([helpers.reviewedFolderDrop(helpers.encodeFolderDrag(catalog, "Source"), catalog, "Destination")]); expect(host.moves).toHaveLength(0);
    const action = elements(host.node("Source")).find(node => node.type === IconButton && node.props.label === "Organize source group Source")!;
    (action.props.onClick as () => void)(); expect((host.intents[1] as helpers.FolderReviewIntent).action).toBe("MOVE"); expect(host.moves).toHaveLength(0);
  });
  it("read-only tree keeps keyboard browsing but has no draggable or mutation action controls", () => {
    const host = treeHarness({ ...catalog, canEdit: false }), tree = host.node("Source");
    expect(renderToStaticMarkup(tree)).not.toContain("draggable"); expect(elements(tree).some(node => node.type === "button")).toBe(false);
    const row = elements(tree).find(node => node.props.role === "button" && typeof node.props.onKeyDown === "function")!; (row.props.onKeyDown as (event: unknown) => void)({ key: "Enter", preventDefault() {} }); expect(host.selections).toEqual(["Source"]); expect(host.moves).toHaveLength(0);
  });
  it("unsupported raw tree paths remain exact flat groups with no normalization or editable gesture", () => {
    const host = treeHarness(), invalid = [{ id: "bad", title: "Synthetic raw case", suitePath: null, sourceFilePath: "a//b" }];
    const tree = (host.h.TestCaseTree as (props: unknown) => React.ReactElement)({ cases: invalid, selectedPath: null, onSelect() {}, folderCatalog: catalog });
    const html = renderToStaticMarkup(tree); expect(html).toContain("a//b"); expect(html).toContain("unsupported raw path"); expect(html).toContain("Raw path retained"); expect(html).not.toContain("Organize source group");
    const filtered = (host.h.filterCasesByPath as (cases: unknown, path: string) => unknown[])(invalid, "a//b"); expect(filtered).toHaveLength(1);
  });
  it("raw reserved-path groups do not collide with literal supported node names or silently select the Unassigned bucket", () => {
    const host = treeHarness(), retained = [{ id: "raw", title: "Synthetic raw", suitePath: null, sourceFilePath: "__unassigned__" }, { id: "literal", title: "Synthetic literal", suitePath: "unsupported:__unassigned__", sourceFilePath: null }];
    const built = (host.h.buildTree as (cases: unknown, paths: string[]) => { children: Map<string, unknown> })(retained, []);
    expect(built.children.size).toBe(2);
    const tree = (host.h.TestCaseTree as (props: unknown) => React.ReactElement)({ cases: retained, selectedPath: null, onSelect() {}, folderCatalog: catalog });
    const html = renderToStaticMarkup(tree); expect(html).toContain("View retained raw-path cases in All test cases"); expect(html).toContain("unsupported:__unassigned__");
  });
  it("a mismatched/incomplete classification snapshot remains an unverified display, not a crash or native case-drop grant", () => {
    const host = treeHarness(); const tree = (host.h.TestCaseTree as (props: unknown) => React.ReactElement)({ cases, classificationCases: [], selectedPath: null, onSelect() {}, folderCatalog: null });
    expect(renderToStaticMarkup(tree)).toContain("Folder status unavailable"); expect(host.moves).toHaveLength(0);
  });
  it("external folder gesture opens scoped unsaved setup and only explicit review requests complete impact", async () => {
    const host = foldersHarness(); await host.settled(); await host.intent("gesture-one");
    expect(host.html()).toContain("Destination parent folder"); expect(host.html()).toContain("Source files/provenance stay unchanged"); expect(host.writes).toHaveLength(0);
    host.click("Review change"); await host.settled(); expect(host.html()).toContain("851 cases (2"); expect(host.html()).toContain("Source-derived suite"); expect(host.html()).toContain("previous history and run evidence are not"); expect(host.writes).toHaveLength(0);
    expect(host.catalogUpdates.some(value => value && (value as helpers.CaseFolderCatalog).folders[0]!.id === "stable-destination")).toBe(true);
  });
  it("external intents cannot overwrite a closed editable draft; explicit discard permits a later gesture", async () => {
    const host = foldersHarness(); await host.settled(); await host.intent("one"); host.click("Close"); await host.settled(); await host.intent("two", "Native");
    expect(host.html()).toContain("Existing folder draft/request retained"); expect(host.writes).toHaveLength(0);
    host.click("Folders"); await host.settled(); expect(host.html()).toContain('value="Source" selected=""'); host.click("Discard editable folder draft"); await host.settled(); await host.intent("three", "Native");
    expect(host.html()).toContain('value="Native" selected=""'); expect(host.writes).toHaveLength(0);
  });
  it("an UNKNOWN approved request remains identical after another gesture; no automatic replacement write", async () => {
    const host = foldersHarness(); await host.settled(); await host.intent("one"); await host.approveUnknown(); const original = host.writes[0];
    host.click("Close"); await host.settled(); await host.intent("two", "Native"); expect(host.writes).toHaveLength(1);
    host.click("Folders"); await host.settled(); expect(host.html()).not.toContain("Discard editable folder draft"); host.click("Retry exact approved change"); expect(host.writes[1]).toBe(original);
  });
  it("catalog and gesture admission fail closed after actor change; no hidden draft transfer or write", async () => {
    const host = foldersHarness(); await host.settled(); await host.intent("one"); host.auth.userId = "other-actor"; await host.settled(); await host.intent("two", "Native");
    expect(host.catalogUpdates.at(-1)).toBeNull(); expect(host.html()).toContain("draft controls are hidden"); expect(host.writes).toHaveLength(0);
  });
});
