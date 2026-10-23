// Genuine extracted review JSX, real shared StatusPill and genuine parent modal
// binding/confirm handler. Synthetic cases and callbacks only: never delete,
// call RPC or prove browser geometry/native outcomes.
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { expect, it, vi } from "vitest";

type Element = React.ReactElement<Record<string, unknown>>;
type Props = { kind: "delete" | "archive" | "restore"; ids: readonly string[]; cases: readonly { id: string; displayId: string; title: string }[]; busy: boolean; onCancel(): void; onConfirm(): void };
function elements(value: unknown, list: Element[] = []): Element[] {
  if (React.isValidElement(value)) { const element = value as Element; list.push(element); elements(element.props.children, list); }
  else if (Array.isArray(value)) value.forEach(item => elements(item, list));
  return list;
}
function text(value: unknown): string { return typeof value === "string" || typeof value === "number" ? String(value) : React.isValidElement(value) ? text((value as Element).props.children) : Array.isArray(value) ? value.map(text).join("") : ""; }
const workspace = readFileSync(new URL("../components/ui/Workspace.tsx", import.meta.url), "utf8");
const workspaceAst = ts.createSourceFile("Workspace.tsx", workspace, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const pill = workspaceAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "StatusPill");
if (!pill) throw Error("Actual shared StatusPill missing");
const StatusPill = new Function("React", ts.transpileModule(pill.getText(workspaceAst).replace(/^export /, ""), { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText + "\nreturn StatusPill;")(React) as React.ComponentType;
const source = readFileSync(new URL("../components/TestCaseBulkActionReview.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const exports: { TestCaseBulkActionReview?: (props: Props) => React.ReactNode } = {};
new Function("require", "exports", "React", compiled)((name: string) => {
  if (name !== "./ui/Workspace") throw Error("Unreviewed component dependency: " + name);
  return { StatusPill };
}, exports, React);
const Review = exports.TestCaseBulkActionReview!;
if (!Review) throw Error("Actual review export missing");
function fixture(count = 851, extra: Partial<Props> = {}) {
  const cases = Array.from({ length: count }, (_, position) => ({ id: `synthetic-id-${position}`, displayId: `CASE-${String(position + 1).padStart(2, "0")}`, title: `  Case ${position + 1}: long tester action ${"full detail ".repeat(20)}\nTechnical descriptor <literal> & λ  ` }));
  const props: Props = { kind: "delete", ids: cases.map(item => item.id), cases, busy: false, onCancel: vi.fn(), onConfirm: vi.fn(), ...extra };
  const tree = Review(props);
  return { props, tree, html: renderToStaticMarkup(tree), nodes: elements(tree), button: (label: string) => { const element = elements(tree).find(node => node.type === "button" && text(node.props.children) === label); if (!element) throw Error("Button missing: " + label); return element; } };
}
it("851-case review is structured, bounded and complete rather than a bullet wall", () => {
  const h = fixture();
  expect(h.html).toContain("851 cases selected"); expect(h.html).toContain("Ready for confirmation"); expect(h.html).toContain("5 sequential batches, 200 cases maximum each");
  expect(h.html).toContain("This cannot be undone."); expect(h.html).toContain("Selected scope only");
  expect(h.html).not.toContain("<ul"); expect(h.html).not.toContain("<li"); expect(h.html).not.toContain("role=\"progressbar\"");
  expect(h.nodes.filter(node => node.type === "tbody")).toHaveLength(1);
  expect(elements(h.nodes.find(node => node.type === "tbody")).filter(node => node.type === "tr")).toHaveLength(851);
  const region = h.nodes.find(node => node.props.role === "region")!;
  expect(region.props.tabIndex).toBe(0); expect(region.props["aria-label"]).toBe("Selected case references and titles");
  expect(region.props.style).toMatchObject({ maxHeight: "min(42vh, 360px)", overflow: "auto", minWidth: 0 });
  expect(h.nodes.find(node => node.type === "table")!.props.style).toMatchObject({ width: "100%", tableLayout: "fixed" });
  expect(h.nodes.find(node => node.type === "col")!.props.style).toEqual({ width: "28%" });
  expect(h.nodes.filter(node => node.type === "th").map(node => node.props.scope)).toEqual(["col", "col"]);
  expect(h.nodes.find(node => node.type === "th" && text(node.props.children) === "Reference")!.props.style).toMatchObject({ whiteSpace: "nowrap", letterSpacing: 0, fontSize: 12 });
  const first = h.nodes.find(node => node.type === "tbody")!.props.children as Element[];
  expect(text(first[0])).toContain(h.props.cases[0]!.title); expect(text(first[850])).toContain(h.props.cases[850]!.title);
  expect(h.html).toContain("&lt;literal&gt; &amp; λ"); expect(h.html).not.toContain("<literal>");
  expect(h.nodes.filter(node => node.type === "td").every(node => (node.props.style as React.CSSProperties).overflowWrap === "anywhere")).toBe(true);
  expect(h.props.onConfirm).not.toHaveBeenCalled(); expect(h.props.onCancel).not.toHaveBeenCalled();
});
it("ordered stable references and complete raw titles survive review without normalization, omission or truncation", () => {
  const cases = [{ id: "stable-A", displayId: "NEW-01", title: ' \n<not HTML> & "literal"\nraw prose  ' }, { id: "stable-B", displayId: "OLD-02", title: "" }, { id: "stable-C", displayId: "NEW-03", title: " \t " }];
  const before = structuredClone(cases), ids = ["stable-C", "stable-A", "stable-B"];
  const h = fixture(0, { cases, ids });
  const body = h.nodes.find(node => node.type === "tbody")!;
  const rows = body.props.children as Element[];
  expect(rows.map(row => row.key)).toEqual(ids);
  expect(rows.map(row => elements(row).find(node => node.type === "code")!.props.children)).toEqual(["NEW-03", "NEW-01", "OLD-02"]);
  expect(elements(rows[0]).filter(node => node.type === "td")[1]!.props.children).toBe(" \t ");
  expect(elements(rows[1]).filter(node => node.type === "td")[1]!.props.children).toBe(cases[0]!.title);
  expect(h.html).toContain("Empty title"); expect(h.html).toContain("&lt;not HTML&gt; &amp; &quot;literal&quot;");
  expect(cases).toEqual(before); expect(ids).toEqual(["stable-C", "stable-A", "stable-B"]);
});
it("missing current metadata retains immutable reviewed IDs without guessing a title/reference or altering selection", () => {
  const ids = ["long-immutable-id-".repeat(12)], h = fixture(0, { ids });
  expect(h.html).toContain("1 case is unavailable in the current list"); expect(h.html).toContain("Case details unavailable in the current list");
  expect(h.html).toContain("Immutable case ID; current display reference unavailable");
  expect(h.nodes.find(node => node.type === "code")!.props.children).toBe(ids[0]);
  expect(h.button("Delete 1 case").props.disabled).toBe(false); // unchanged parent review scope, native decides availability
  expect(h.props.ids).toBe(ids); expect(h.props.onConfirm).not.toHaveBeenCalled();
});
it.each(["delete", "archive", "restore"] as const)("%s pending state is useful and disables actions without inventing outcome/progress", kind => {
  const h = fixture(851, { kind, busy: true });
  expect((h.tree as Element).props["aria-busy"]).toBe(true);
  expect(h.html).toContain("status-warning"); expect(h.html).toContain(kind === "delete" ? "Deletion in progress" : kind === "archive" ? "Archiving in progress" : "Restoration in progress");
  expect(h.html).toContain("Waiting for the current request"); expect(h.html).toContain("Later batches stop on an unconfirmed result"); expect(h.html).toContain("Unconfirmed cases remain selected");
  expect(h.button("Applying…").props.disabled).toBe(true); expect(h.button("Cancel").props.disabled).toBe(true);
  expect(/\d+%|confirmed complete|deleted successfully/.test(text(h.tree))).toBe(false);
  expect(h.html.includes('role="progressbar"')).toBe(false);
  expect(h.props.onConfirm).not.toHaveBeenCalled(); expect(h.props.onCancel).not.toHaveBeenCalled();
});
it.each(["delete", "archive", "restore"] as const)("%s actual action and cancel callbacks keep their original identity and require a deliberate activation", kind => {
  const h = fixture(2, { kind }), action = kind === "delete" ? "Delete" : kind === "archive" ? "Archive" : "Restore";
  expect(h.button(`${action} 2 cases`).props.className).toBe(kind === "delete" ? "btn-danger" : "btn-primary");
  expect(h.button(`${action} 2 cases`).props.onClick).toBe(h.props.onConfirm);
  expect(h.button("Cancel").props.onClick).toBe(h.props.onCancel);
  (h.button(`${action} 2 cases`).props.onClick as () => void)(); expect(h.props.onConfirm).toHaveBeenCalledTimes(1);
  (h.button("Cancel").props.onClick as () => void)(); expect(h.props.onCancel).toHaveBeenCalledTimes(1);
});
it("empty selection cannot confirm and has no fabricated row or batch", () => {
  const h = fixture(0); expect(h.button("Delete 0 cases").props.disabled).toBe(true); expect(h.html).toContain("0 sequential batches"); expect(h.nodes.filter(node => node.type === "td")).toEqual([]);
});

const page = readFileSync(new URL("../app/projects/[projectId]/test-cases/page.tsx", import.meta.url), "utf8");
const pageAst = ts.createSourceFile("page.tsx", page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function find(node: ts.Node, match: (node: ts.Node) => boolean): ts.Node | undefined { if (match(node)) return node; let found: ts.Node | undefined; ts.forEachChild(node, child => { if (!found) found = find(child, match); }); return found; }
const modal = find(pageAst, node => ts.isJsxElement(node) && node.openingElement.tagName.getText(pageAst) === "Modal" && node.openingElement.attributes.properties.some(attribute => attribute.getText(pageAst) === "open={reviewAction !== null}"));
const parentConfirmation = find(pageAst, node => ts.isFunctionDeclaration(node) && node.name?.text === "confirmReviewedAction");
if (!modal || !parentConfirmation) throw Error("Actual parent review scope/handler missing");
type ReviewAction = { kind: Props["kind"]; ids: string[] };
function parent(action: ReviewAction, readOnly = false, busy = false) {
  const setReviewAction = vi.fn(), bulkDelete = vi.fn(async () => {}), bulkArchive = vi.fn(async () => {});
  const get = new Function("React", "Modal", "TestCaseBulkActionReview", "reviewAction", "cases", "bulkBusy", "readOnly", "setReviewAction", "bulkDelete", "bulkArchive",
    ts.transpileModule(`${parentConfirmation!.getText(pageAst)}\nreturn (${modal!.getText(pageAst)});`, { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText);
  const tree = get(React, () => null, Review, action, [], busy, readOnly, setReviewAction, bulkDelete, bulkArchive) as Element;
  const component = elements(tree).find(node => node.type === Review)!;
  return { tree, props: component.props as unknown as Props, setReviewAction, bulkDelete, bulkArchive };
}
it.each(["delete", "archive", "restore"] as const)("actual parent %s binding passes the exact frozen scope and existing reviewed callback", async kind => {
  const action = { kind, ids: ["stable-1", "stable-2"] }, h = parent(action);
  expect(h.props.ids).toBe(action.ids); expect(h.props.kind).toBe(kind); expect(h.tree.props.dismissible).toBe(true);
  h.props.onConfirm(); await new Promise<void>(resolve => setImmediate(resolve));
  if (kind === "delete") { expect(h.bulkDelete).toHaveBeenCalledWith(action.ids); expect(h.bulkArchive).not.toHaveBeenCalled(); }
  else { expect(h.bulkArchive).toHaveBeenCalledWith(kind === "archive", action.ids); expect(h.bulkDelete).not.toHaveBeenCalled(); }
  expect(h.setReviewAction).toHaveBeenCalledWith(null);
});
it.each(["readonly", "busy"])("actual parent %s refusal and busy modal dismissal remain unchanged", async condition => {
  const h = parent({ kind: "delete", ids: ["stable"] }, condition === "readonly", condition === "busy");
  h.props.onConfirm(); await new Promise<void>(resolve => setImmediate(resolve));
  expect(h.bulkDelete).not.toHaveBeenCalled(); expect(h.bulkArchive).not.toHaveBeenCalled(); expect(h.setReviewAction).not.toHaveBeenCalled();
  if (condition === "busy") expect(h.tree.props.dismissible).toBe(false);
  expect(page).toMatch(/!readOnly && \(\s*<Modal\s+open=\{reviewAction !== null\}/);
});
