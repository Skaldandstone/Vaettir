import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { FOLDER_DRAG_TYPE, supportedCaseFolderPath } from "./case-folder-tree";
import { rowDropTarget } from "./case-repository";

const page = readFileSync(new URL("../app/projects/[projectId]/test-cases/page.tsx", import.meta.url), "utf8");
const tree = readFileSync(new URL("../components/TestCaseTree.tsx", import.meta.url), "utf8");
const pageAst = ts.createSourceFile("page.tsx", page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const treeAst = ts.createSourceFile("tree.tsx", tree, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function find(node: ts.Node, match: (node: ts.Node) => boolean): ts.Node | undefined {
  if (match(node)) return node;
  let result: ts.Node | undefined; ts.forEachChild(node, child => { if (!result) result = find(child, match); }); return result;
}
function descendants(node: unknown): React.ReactElement[] {
  if (Array.isArray(node)) return node.flatMap(descendants);
  if (!React.isValidElement(node)) return [];
  return [node, ...descendants((node.props as { children?: unknown }).children)];
}
const handle = find(pageAst, node => ts.isJsxElement(node) && node.openingElement.tagName.getText(pageAst) === "button" &&
  node.openingElement.attributes.properties.some(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(pageAst) === "draggable"))!;
const handleCode = ts.transpileModule(`function render(){return ${handle.getText(pageAst)};}this.render=render;`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React } }).outputText;
type HandleProps = { "aria-label": string; title: string; onClick(): void; onDragStart(event: unknown): void; disabled: boolean };
function caseHandle(suite: string | null, catalog: string[] = [], baseline = suite) {
  const setSortBy = vi.fn(), setSelectedPath = vi.fn();
  const context = vm.createContext({ React, tc: { id: "stable-native-id", displayId: "TC-851", title: "Exact case", suitePath: suite },
    moveMutation: { isPending: false }, setSortBy, setSelectedPath, currentFolderCatalog: { paths: catalog },
    placements: new Map([["stable-native-id", { suitePath: baseline }]]), supportedCaseFolderPath });
  vm.runInContext(handleCode, context);
  return { button: (context as unknown as { render(): React.ReactElement<HandleProps> }).render(), setSortBy, setSelectedPath };
}
it("actual case handle supports native button keyboard/click activation as a view-only transition into verified persisted suite ordering", () => {
  const h = caseHandle("Release/Smoke", ["Release/Smoke"]);
  expect(renderToStaticMarkup(h.button)).toContain("TC-851"); expect(h.button.props["aria-label"]).toContain("activate to view manual ordering");
  expect(h.button.props.title).toContain("Enter/Space"); h.button.props.onClick();
  expect(h.setSortBy).toHaveBeenCalledWith("manual"); expect(h.setSelectedPath).toHaveBeenCalledWith("Release/Smoke");
  const callback = find(handle, node => ts.isJsxAttribute(node) && node.name.getText(pageAst) === "onClick")!.getText(pageAst);
  expect(callback).not.toMatch(/mutate|moveCase|setSuite|setFolderReview|\.trim\(|sourceFilePath/);
});
it.each([[null, ["tests/source"], null], ["Release/Smoke", [], "Release/Smoke"], [" unsupported/", [" unsupported/"], " unsupported/"], ["Release/Smoke", ["Release/Smoke"], "different"]] as const)("source/unassigned/unverified/stale/unsupported suite %j only switches the view without materializing a folder", (suite, catalog, baseline) => {
  const h = caseHandle(suite, [...catalog], baseline); h.button.props.onClick();
  expect(h.setSortBy).toHaveBeenCalledWith("manual"); expect(h.setSelectedPath).not.toHaveBeenCalled();
});
it("actual case drag payload remains the stable native ID and legacy drop/CAS/success/failure behavior is preserved", () => {
  const h = caseHandle("Release", ["Release"]), setData = vi.fn(), dataTransfer = { setData, effectAllowed: "" };
  h.button.props.onDragStart({ dataTransfer }); expect(setData).toHaveBeenCalledWith("application/x-vaettir-test-case", "stable-native-id"); expect(dataTransfer.effectAllowed).toBe("move");
  const move = find(pageAst, node => ts.isFunctionDeclaration(node) && node.name?.text === "moveCase")!.getText(pageAst);
  for (const text of ["expectedSuitePath: placement.suitePath", "expectedSortPosition: placement.sortPosition", "targetSuitePath", "beforeCaseId", "reload()", 'setSortBy("manual")', "structureQuery.refetch()", "casesQuery.refetch()"]) expect(move).toContain(text);
  expect(move).not.toMatch(/requestId|idempotency|casePlacementReviewed/); // no invented new native safety/receipt
  expect(page).toContain("rowDropTarget(moving, tc)"); expect(page).toContain('sortBy === "manual"');
  expect(page).toContain("tc.suitePath === selectedPath"); expect(page).toContain("sameSuiteAfterAnchor(");
});
it("actual manual-view guidance is discoverable without claiming a move or enabling keyboard arrows in source/All views", () => {
  const scope = find(pageAst, node => ts.isJsxElement(node) && node.openingElement.tagName.getText(pageAst) === "div" && node.openingElement.attributes.properties.some(attribute => attribute.getText(pageAst) === "className={styles.scope}"))!;
  const code = ts.transpileModule(`function render(){return ${scope.getText(pageAst)};}this.render=render;`, { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.None } }).outputText;
  const setSortBy = vi.fn(), context = vm.createContext({ React, styles: { scope: "scope" }, visibleCases: [], selectedPath: null, UNASSIGNED: "__unassigned__", sortBy: "updated", readOnly: false, setSortBy });
  vm.runInContext(code, context); const rendered = (context as unknown as { render(): React.ReactElement }).render();
  expect(renderToStaticMarkup(rendered)).toContain("View manual order");
  const button = descendants(rendered).find(node => node.type === "button") as React.ReactElement<{ onClick(): void }>;
  button.props.onClick(); expect(setSortBy).toHaveBeenCalledWith("manual");
  for (const text of ["In All suites, source groups or Unassigned", "select a persisted case suite first", "Viewing an order does not move cases or create folders"]) expect(page).toContain(text);
});

function treeNode(receives: boolean, supported = true) {
  const functions = treeAst.statements.filter(ts.isFunctionDeclaration).map(node => ts.createPrinter().printNode(ts.EmitHint.Unspecified, node, treeAst).replace(/\bexport\s+/, "")).join("\n");
  const code = ts.transpileModule(functions + "\nthis.render=TreeNodeView;", { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React } }).outputText;
  const states: unknown[] = [], onDropCase = vi.fn(), onFolderReview = vi.fn(), onDropRefused = vi.fn();
  const context = vm.createContext({ React, FOLDER_DRAG_TYPE, UNASSIGNED: "__unassigned__", useState: (initial: unknown) => [initial, (next: unknown) => states.push(next)], caseFolderKindLabel: () => receives ? "Case suite" : "Source group" });
  vm.runInContext(code, context);
  const props = { node: { path: "tests/source", name: "source", cases: [], children: new Map() }, depth: 0, selectedPath: null, onSelect: vi.fn(), onDropCase, onFolderReview, onDropRefused,
    catalog: { paths: ["tests/source"], canEdit: true }, metadata: new Map([["tests/source", { supported, canReceiveCase: receives, canOrganize: supported, kind: "SOURCE_GROUP" }]]) };
  const root = (context as unknown as { render(props: unknown): React.ReactElement }).render(props);
  const row = descendants(root).find(node => (node.props as { role?: string }).role === "button") as React.ReactElement<{ onDragOver(event: unknown): void }>;
  return { row, states, onDropCase, onFolderReview, onDropRefused };
}
it.each([true, false])("actual source-only/unsupported tree target supported=%s never advertises a valid case drop or writes", supported => {
  const h = treeNode(false, supported), preventDefault = vi.fn(), stopPropagation = vi.fn(), dataTransfer = { types: ["application/x-vaettir-test-case"], dropEffect: "none" };
  h.row.props.onDragOver({ preventDefault, stopPropagation, dataTransfer }); expect(preventDefault).not.toHaveBeenCalled(); expect(h.states).toEqual([]); expect(dataTransfer.dropEffect).toBe("none");
  expect(h.onDropCase).not.toHaveBeenCalled(); expect(h.onFolderReview).not.toHaveBeenCalled();
});
it("actual native suite case hover and reviewed folder hover preserve existing valid gestures without writing on hover", () => {
  for (const [receives, type] of [[true, "application/x-vaettir-test-case"], [false, FOLDER_DRAG_TYPE]] as const) {
    const h = treeNode(receives), preventDefault = vi.fn(), stopPropagation = vi.fn(), dataTransfer = { types: [type], dropEffect: "none" };
    h.row.props.onDragOver({ preventDefault, stopPropagation, dataTransfer }); expect(preventDefault).toHaveBeenCalledOnce(); expect(stopPropagation).toHaveBeenCalledOnce();
    expect(h.states).toContain(true); expect(dataTransfer.dropEffect).toBe("move"); expect(h.onDropCase).not.toHaveBeenCalled(); expect(h.onFolderReview).not.toHaveBeenCalled();
  }
});

type RowEvent = { preventDefault(): void; dataTransfer: { types: string[]; dropEffect: string; getData(type: string): string } };
// Actual UI callbacks and target helper; transport/cursor events are synthetic.
// No native drag geometry, persisted move or authorization acceptance is claimed.
function caseRow(options: { pending?: boolean; readOnly?: boolean; archived?: boolean; foreignPayload?: boolean } = {}) {
  const row = find(pageAst, node => ts.isJsxElement(node) && node.openingElement.tagName.getText(pageAst) === "tr" &&
    node.openingElement.attributes.properties.some(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(pageAst) === "onDragOver"));
  if (!row || !ts.isJsxElement(row)) throw Error("Actual repository drop row missing");
  const handler = (name: string) => {
    const attribute = row.openingElement.attributes.properties.find(value => ts.isJsxAttribute(value) && value.name.getText(pageAst) === name);
    if (!attribute || !ts.isJsxAttribute(attribute) || !attribute.initializer || !ts.isJsxExpression(attribute.initializer) || !attribute.initializer.expression) throw Error("Actual row handler missing: " + name);
    return attribute.initializer.expression.getText(pageAst);
  };
  const code = ts.transpileModule(`this.hover=(${handler("onDragOver")});this.drop=(${handler("onDrop")});`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const moving = { id: "stable-moving-case", suitePath: "Release/Smoke", sourceFilePath: null };
  const tc = { id: "stable-target-case", suitePath: "Target/Suite", sourceFilePath: null, archived: options.archived ?? false };
  const moveMutation = { isPending: options.pending ?? false }, moveCase = vi.fn(), setError = vi.fn();
  const context = vm.createContext({ tc, cases: [moving, tc], readOnly: options.readOnly ?? false, moveMutation, moveCase, setError, rowDropTarget });
  vm.runInContext(code, context);
  const callbacks = context as unknown as { hover(event: RowEvent): void; drop(event: RowEvent): void };
  const type = "application/x-vaettir-test-case", types = options.foreignPayload ? ["text/plain"] : [type];
  const getData = vi.fn((requested: string) => types.includes(requested) ? moving.id : "");
  const preventDefault = vi.fn(), event = { preventDefault, dataTransfer: { types, dropEffect: "none", getData } };
  return { ...callbacks, event, preventDefault, getData, moveMutation, moveCase, setError };
}
it.each([{ pending: true }, { readOnly: true }, { archived: true }, { foreignPayload: true }])("actual repository row refuses hover/drop admission %j without a move or protected hover-payload read", options => {
  const h = caseRow(options);
  h.hover(h.event);
  expect(h.preventDefault).not.toHaveBeenCalled();
  expect(h.event.dataTransfer.dropEffect).toBe("none");
  expect(h.getData).not.toHaveBeenCalled();
  expect(h.moveCase).not.toHaveBeenCalled();
  h.drop(h.event);
  expect(h.preventDefault).not.toHaveBeenCalled();
  expect(h.moveCase).not.toHaveBeenCalled();
  expect(h.setError).not.toHaveBeenCalled();
  if (!options.foreignPayload) expect(h.getData).not.toHaveBeenCalled();
});
it("actual enabled repository row retains move feedback and exact stable-ID/suite/before-target drop", () => {
  const h = caseRow();
  h.hover(h.event);
  expect(h.preventDefault).toHaveBeenCalledOnce();
  expect(h.event.dataTransfer.dropEffect).toBe("move");
  expect(h.getData).not.toHaveBeenCalled();
  expect(h.moveCase).not.toHaveBeenCalled();
  h.drop(h.event);
  expect(h.preventDefault).toHaveBeenCalledTimes(2);
  expect(h.getData).toHaveBeenCalledWith("application/x-vaettir-test-case");
  expect(h.moveCase).toHaveBeenCalledExactlyOnceWith("stable-moving-case", "Target/Suite", "stable-target-case");
  expect(h.setError).not.toHaveBeenCalled();
});
it("a move becoming pending after allowed hover still refuses the actual drop without another write", () => {
  const h = caseRow();
  h.hover(h.event); h.moveMutation.isPending = true; h.drop(h.event);
  expect(h.preventDefault).toHaveBeenCalledOnce();
  expect(h.getData).not.toHaveBeenCalled();
  expect(h.moveCase).not.toHaveBeenCalled();
});
