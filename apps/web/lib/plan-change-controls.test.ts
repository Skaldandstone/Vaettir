import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { expect, it } from "vitest";
import * as fields from "./plan-change-draft";
import * as values from "./plan-custom-fields";
import * as rows from "./qa-strategy-fields";
import type { PlanCustomFieldsEditor } from "../components/PlanCustomFieldsEditor";
type Renderer = NonNullable<React.ComponentProps<typeof PlanCustomFieldsEditor>["renderFields"]>;
// Only host props and handlers traversed by this synthetic element harness.
type ElementProps = { children?: React.ReactNode; inputMode?: string; style?: React.CSSProperties; value?: unknown; "aria-invalid"?: boolean; "aria-label"?: string; hidden?: boolean; disabled?: boolean; onChange?: (event: { target: { value: string } }) => void; onClick?: () => void };
type Element = React.ReactElement<ElementProps>;
type SyntheticDraft = { baseline: ReturnType<typeof base>; origin: ReturnType<typeof base>["origin"]; values: fields.PlanMetadataDraft; reason: string; confirmed: boolean };
type SyntheticEditor = { open: boolean; busy: boolean; readable: boolean; pending: { input: { requestId: string } } | null; notice: string; problem: string | null; canSave: boolean; draft: SyntheticDraft; draftRef: { current: SyntheticDraft | null }; reads: { fresh: ReturnType<typeof base> }; canHandleDraft: () => boolean; show: () => void; close: () => void; review: () => void; commit: () => void; change: (patch: Partial<Pick<SyntheticDraft, "values" | "reason" | "confirmed">>) => void };
const source = readFileSync(new URL("../components/PlanCustomFieldsEditor.tsx", import.meta.url), "utf8"), ast = ts.createSourceFile("controls.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = ast.statements.filter(node => ts.isFunctionDeclaration(node) || ts.isVariableStatement(node) && node.declarationList.declarations.every(declaration => ts.isIdentifier(declaration.name) && ["fieldLabel", "fieldControl"].includes(declaration.name.text))).map(node => ts.createPrinter().printNode(ts.EmitHint.Unspecified, node, ast).replace(/\bexport\s+/, ""));
const compiled = ts.transpileModule(`${declarations.join("\n")}\nthis.meta=PlanCustomFieldsEditor;this.rows=MetadataStringRows;`, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, module: ts.ModuleKind.None } }).outputText;
function elements(node: React.ReactNode): Element[] { return !React.isValidElement<ElementProps>(node) ? [] : [node, ...React.Children.toArray(node.props.children).flatMap(elements)]; }
function base() { return { origin: { projectId: "original-project", organizationId: "org", clerkActorId: "clerk", caseId: null }, snapshot: { id: "original-plan", customFields: { notes: "", n: 12, enabled: false, areas: ["", "same", "same"], nullText: null, unknown: { retain: [null, 0] } } }, metadataSchema: { supported: true, canEdit: true, fieldSchemaHash: "b".repeat(64), blockedReason: null, fieldSchema: { properties: { notes: { type: "string" }, n: { type: "number" }, enabled: { type: "boolean" }, areas: { type: "array", items: { type: "string" } }, missing: { type: "boolean" }, nullText: { type: "string" } } } } }; }
function controlHost() {
  const baseline = base(), editor: SyntheticEditor = { open: true, busy: false, readable: true, pending: null, notice: "", problem: null, canSave: false, draft: { baseline, origin: baseline.origin, values: fields.emptyPlanMetadataDraft(), reason: "", confirmed: false }, draftRef: { current: null }, reads: { fresh: { ...baseline } }, canHandleDraft: () => editor.open && editor.readable && !editor.busy && !editor.pending, show: () => {}, close: () => {}, review: () => {}, commit: () => {}, change: patch => { editor.draft = { ...editor.draft, ...patch, confirmed: patch.confirmed === true }; editor.draftRef.current = editor.draft; try { editor.canSave = fields.reviewedPlanMetadataChanges(baseline.metadataSchema.fieldSchema, baseline.snapshot.customFields, editor.draft.values).length > 0; editor.problem = null; } catch (cause) { editor.canSave = false; editor.problem = String(cause); } } };
  editor.draftRef.current = editor.draft;
  const bindings = { React, Error, ...fields, ...values, ...rows, useState: (initial: unknown): [unknown, (value: unknown) => void] => React.useState(initial), useId: () => React.useId(), Modal: (props: { children?: React.ReactNode }) => props.children,
    trpcReact: { testPlanGovernance: { editPlanCustomFields: { useMutation: () => ({}) } } }, usePlanChangeEditor: () => editor };
  const context = vm.createContext(bindings);
  vm.runInContext(compiled, context);
  const component = (context as unknown as { meta: (props: unknown) => React.ReactNode }).meta;
  const render = (renderFields?: Renderer) => component({ projectId: "current-project", testPlanId: "current-plan", organizationId: "org", onChanged: () => {}, renderFields });
  return { editor, render, context, bindings };
}
it("actual numeric handler preserves invalid text and blocks the parent save immediately", () => {
  const h = controlHost(); const input = elements(h.render()).find(node => node.type === "input" && node.props.inputMode === "decimal")!;
  input.props.onChange!({ target: { value: "-" } });
  const next = elements(h.render()), invalid = next.find(node => node.type === "input" && node.props.inputMode === "decimal")!;
  expect(invalid.props.value).toBe("-"); expect(invalid.props["aria-invalid"]).toBe(true);
  const save = next.find(node => node.type === "button" && node.props.children === "Save reviewed metadata changes")!; expect(save.props.disabled).toBe(true);
  expect(h.editor.draft.values.changes.some(change => change.key === "n")).toBe(false);
  expect(next.some(node => node.type === "button" && React.Children.toArray(node.props.children).join("") === "Leave n unchanged")).toBe(true);
});
it("actual metadata layout gives controls full width and exact lists a complete responsive row", () => {
  const h = controlHost(), nodes = elements(h.render());
  const controls = nodes.filter(node => ["textarea", "select"].includes(String(node.type)) || node.type === "input" && node.props.inputMode === "decimal");
  expect(controls.length).toBeGreaterThan(2);
  for (const control of controls) expect(control.props.style).toMatchObject({ width: "100%", minWidth: 0, boxSizing: "border-box" });
  expect(nodes.some(node => node.type === "div" && node.props.style?.gridTemplateColumns === "repeat(auto-fit, minmax(min(260px, 100%), 1fr))")).toBe(true);
  expect(nodes.some(node => node.type === "section" && node.props.style?.gridColumn === "1 / -1")).toBe(true);
});
it("actual Boolean controls preserve absent vs false, NULL/unknown readonly and exact typed SETs", () => {
  const h = controlHost(), selects = elements(h.render()).filter(node => node.type === "select");
  expect(selects.map(node => node.props.value)).toEqual(["FALSE", "ABSENT"]);
  selects[1]!.props.onChange!({ target: { value: "FALSE" } }); expect(h.editor.draft.values.changes).toEqual([{ operation: "SET", key: "missing", value: false }]);
  const before = JSON.stringify(h.editor.draft.baseline.snapshot.customFields); h.render(); expect(JSON.stringify(h.editor.draft.baseline.snapshot.customFields)).toBe(before);
  expect(elements(h.render()).some(node => node.type === "pre" && String(node.props.children).includes('"retain"'))).toBe(true);
});
it("specialized renderer remains present through pending/private loss with inert hidden original scope and guarded setters", () => {
  const h = controlHost(), calls: Parameters<Renderer>[] = [], renderer: Renderer = (...args) => { calls.push(args); return React.createElement("span", null, "Synthetic QA lists"); };
  h.render(renderer); expect(calls.at(-1)![2]).toEqual({ active: true, projectId: "original-project", testPlanId: "original-plan" });
  h.editor.pending = { input: { requestId: "retained" } }; const hiddenPending = elements(h.render(renderer)).find(node => node.type === "div" && node.props.hidden === true)!;
  expect(hiddenPending).toBeTruthy(); expect(calls.at(-1)![2].active).toBe(false); const pendingSetter = calls.at(-1)![1]; pendingSetter({ ...calls.at(-1)![0], areas: ["should not apply"] }); expect(h.editor.draft.values.changes).toEqual([]);
  h.editor.readable = false; const hiddenPrivate = elements(h.render(renderer)).find(node => node.type === "div" && node.props.hidden === true)!;
  const node = { inert: false }, ref: unknown = Object.getOwnPropertyDescriptor(hiddenPrivate, "ref")?.value;
  if (typeof ref !== "function") throw Error("Expected actual inert ref callback");
  ref(node); expect(node.inert).toBe(true); expect(calls.at(-1)![2].projectId).toBe("original-project");
});
it("specialized renderer refuses unknown/non-list replacement and blocks saving an older valid patch", () => {
  const h = controlHost(); let setter: Parameters<Renderer>[1] = () => {};
  h.render((_value, onChange) => { setter = onChange; return null; }); setter({ ...h.editor.draft.baseline.snapshot.customFields, n: 99 });
  expect(h.editor.draft.values.rendererError).toMatch(/non-list/); expect(h.editor.canSave).toBe(false); expect(h.editor.draft.values.changes).toEqual([]);
});
it("actual string-row identity retains empty/duplicate/order across edits/removal and resets only changed external values", () => {
  const h = controlHost(), hooks: unknown[] = []; let cursor = 0, dirty = false, values = ["same", "same", ""], tree: React.ReactNode;
  h.bindings.useId = () => "rows";
  h.bindings.useState = (initial: unknown) => { const at = cursor++; if (!Object.hasOwn(hooks, at)) hooks[at] = typeof initial === "function" ? initial() : initial; return [hooks[at], (next: unknown) => { hooks[at] = next; dirty = true; }]; };
  const rowComponent = (h.context as unknown as { rows: (props: unknown) => React.ReactNode }).rows;
  function render() { for (let at = 0; at < 10; at++) { cursor = 0; dirty = false; tree = rowComponent({ label: "Areas", values, onChange: (next: string[]) => { values = next; } }); if (!dirty) return elements(tree); } throw Error("Rows did not settle"); }
  const keys = (nodes: Element[]) => nodes.filter(node => node.type === "div").map(node => node.key), first = render(), original = keys(first);
  first.find(node => node.type === "button" && node.props["aria-label"] === "Remove Areas row 1")!.props.onClick!(); const second = render(); expect(values).toEqual(["same", ""]); expect(keys(second)).toEqual(original.slice(1));
  second.find(node => node.type === "textarea")!.props.onChange!({ target: { value: " exact, prose\n" } }); expect(render().filter(node => node.type === "textarea").map(node => node.props.value)).toEqual([" exact, prose\n", ""]);
  expect(keys(render())).toEqual(original.slice(1)); values = ["external snapshot"]; expect(keys(render()).some(key => original.includes(key))).toBe(false);
});
