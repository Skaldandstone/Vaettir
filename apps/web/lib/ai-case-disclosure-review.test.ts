import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { describe, expect, it, vi } from "vitest";

const source = readFileSync(new URL("../components/AiCaseDisclosureReview.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("Review.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), printer = ts.createPrinter();
const declarations = ast.statements.filter(ts.isFunctionDeclaration).map(node => printer.printNode(ts.EmitHint.Unspecified, node, ast).replace(/\bexport\s+/, "")).join("\n");
const code = ts.transpileModule(declarations + "\nthis.actual=AiCaseDisclosureReview;", { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React } }).outputText;
type Element = React.ReactElement<{ children?: React.ReactNode; type?: string; onClick?: () => void; onChange?: (event: unknown) => void; disabled?: boolean }>;
function all(node: React.ReactNode): Element[] { return React.isValidElement<{ children?: React.ReactNode }>(node) ? [node as Element, ...React.Children.toArray(node.props.children).flatMap(all)] : []; }
function words(node: React.ReactNode): string { return React.isValidElement<{ children?: React.ReactNode }>(node) ? words(node.props.children) : Array.isArray(node) ? node.map(words).join("") : typeof node === "string" || typeof node === "number" ? String(node) : ""; }
function deferred<T>() { let resolve!: (v: T) => void, reject!: (v: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const choices = { organizationId: "org", projectId: "project", actorClerkUserId: "actor", cases: [{ id: "c1", title: "SYNTHETIC_CHOICE" }], more: false };
const preview = { ...choices, digest: "a".repeat(64), snapshot: { version: 1, organizationId: "org", projectId: "project", classificationVersion: 1, fields: ["title", "given", "when", "then"], cases: [{ id: "c1", title: "SYNTHETIC_PREVIEW", given: [], when: ["Open"], then: ["Appears"] }] } };
function harness() {
  const hooks: unknown[] = []; let cursor = 0, mounted = false; let cleanup: (() => void) | undefined;
  const choiceReply = deferred<typeof choices>(), previewReply = deferred<typeof preview>();
  const rpc = { caseChoices: { query: vi.fn(() => choiceReply.promise) }, previewCases: { query: vi.fn(() => previewReply.promise) } };
  const props = { projectId: "project", organizationId: "org", actorClerkUserId: "actor", policyVersion: 1, disabled: false, onApprove: vi.fn() };
  const context = vm.createContext({ React, fields: ["title", "given", "when", "then"], ActionButton: () => null,
    useEffect: (fn: () => () => void) => { if (!mounted) { mounted = true; cleanup = fn(); } },
    useState: (initial: unknown) => { const index = cursor++; if (!(index in hooks)) hooks[index] = typeof initial === "function" ? initial() : initial; return [hooks[index], (next: unknown) => { hooks[index] = typeof next === "function" ? next(hooks[index]) : next; }]; },
    useRef: (initial: unknown) => { const index = cursor++; return hooks[index] ??= { current: initial }; },
    trpcReact: { useUtils: () => ({ client: { aiDisclosure: rpc } }) }, crypto: { randomUUID: () => "10000000-0000-4000-8000-000000000001" },
  });
  vm.runInContext(code, context);
  const actual = (context as unknown as { actual(props: unknown): React.ReactNode }).actual;
  const render = () => { cursor = 0; return actual(props); };
  const button = (label: string) => { const value = all(render()).find(n => typeof n.type === "function" && words(n.props.children) === label); if (!value) throw Error("Missing button " + label); return value; };
  const checkbox = (label: string) => { const parent = all(render()).find(n => n.type === "label" && words(n.props.children).includes(label)); if (!parent) throw Error("Missing checkbox " + label); const value = all(parent).find(n => n.type === "input" && n.props.type === "checkbox"); if (!value) throw Error("Missing checkbox input"); return value; };
  const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
  async function ready() { button("Search").props.onClick!(); choiceReply.resolve(choices); await flush(); checkbox("SYNTHETIC_CHOICE").props.onChange!({ target: { checked: true } }); button("Preview").props.onClick!(); previewReply.resolve(preview); await flush(); }
  return { props, rpc, choiceReply, previewReply, render, button, checkbox, flush, ready, unmount: () => cleanup?.() };
}
describe("actual selected-case review handlers with synthetic RPC boundaries", () => {
  it("requires preview and attestation, then emits the exact approval only once", async () => {
    const h = harness(); await h.ready();
    expect(h.button("Approve").props.disabled).toBe(true);
    h.checkbox("I approve").props.onChange!({ target: { checked: true } });
    const approve = h.button("Approve"); expect(approve.props.disabled).toBe(false);
    approve.props.onClick!(); approve.props.onClick!();
    expect(h.props.onApprove).toHaveBeenCalledTimes(1);
    expect(h.props.onApprove).toHaveBeenCalledWith(expect.objectContaining({ projectId: "project", organizationId: "org", caseIds: ["c1"], previewDigest: preview.digest, lifetimeDays: 1, attestNoRegulatedData: true }));
    expect(words(h.render())).not.toContain("SYNTHETIC_PREVIEW");
  });
  it("changing fields invalidates the preview and prevents a stale approval handler", async () => {
    const h = harness(); await h.ready(); h.checkbox("I approve").props.onChange!({ target: { checked: true } });
    const stale = h.button("Approve"); h.checkbox("given").props.onChange!({ target: { checked: false } }); stale.props.onClick!();
    expect(h.props.onApprove).not.toHaveBeenCalled(); expect(words(h.render())).not.toContain("SYNTHETIC_PREVIEW");
  });
  it("discards responses after unmount or from another actor/workspace", async () => {
    const h = harness(); h.button("Search").props.onClick!(); h.unmount(); h.choiceReply.resolve(choices); await h.flush();
    expect(words(h.render())).not.toContain("SYNTHETIC_CHOICE");
    const other = harness(); other.button("Search").props.onClick!(); other.choiceReply.resolve({ ...choices, actorClerkUserId: "foreign" }); await other.flush();
    expect(words(other.render())).not.toContain("SYNTHETIC_CHOICE");
  });
  it("clears retained private choices on a refused preview", async () => {
    const h = harness(); h.button("Search").props.onClick!(); h.choiceReply.resolve(choices); await h.flush(); h.checkbox("SYNTHETIC_CHOICE").props.onChange!({ target: { checked: true } });
    h.button("Preview").props.onClick!(); h.previewReply.reject(Error("FORBIDDEN")); await h.flush();
    expect(words(h.render())).not.toContain("SYNTHETIC_CHOICE"); expect(words(h.render())).toContain("0 selected"); expect(h.props.onApprove).not.toHaveBeenCalled();
  });
});
