import { readFileSync } from "node:fs";
import React from "react";
import ts from "typescript";
import { expect, it, vi } from "vitest";
import { ActionButton } from "./test-support/action-button";
import { runCaseActionBatches } from "./case-action-batches";
import { currentSessionScope } from "./auth-query-cache";

// Actual organize dialog/handlers; scope, batch completion and mutation are
// synthetic boundaries. No real case update or provider/database/API call.
const ast = ts.createSourceFile("page.tsx", readFileSync(new URL("../app/projects/[projectId]/test-cases/page.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const page = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "TestCasesPage") as ts.FunctionDeclaration;
function find(node: ts.Node, match: (node: ts.Node) => boolean): ts.Node | undefined { if (match(node)) return node; let found: ts.Node | undefined; ts.forEachChild(node, child => { if (!found) found = find(child, match); }); return found; }
const modal = find(page, node => ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === "Modal" && node.openingElement.attributes.properties.some(attribute => attribute.getText(ast).includes('organizeAction.kind === "move"')))!;
let expression = modal.parent;
while (!ts.isJsxExpression(expression)) expression = expression.parent;
const functions = page.body!.statements.filter(node => ts.isFunctionDeclaration(node) && ["bulkMove", "bulkAddTag", "requestOrganize", "editOrganizeDraft"].includes(node.name?.text ?? "")).map(node => node.getText(ast)).join("\n");
const code = ts.transpileModule(functions + `\nreturn {tree:(${expression.expression!.getText(ast)}),move:bulkMove,tag:bulkAddTag,open:requestOrganize};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React } }).outputText;
type Kind = "move" | "tag";
type Scope = { projectId: string; actor: string; eligible: boolean };
type Intent = { kind: Kind; ids: string[]; draft: string; scope: Scope };
type Node = React.ReactElement<Record<string, unknown>>;
function nodes(value: unknown): Node[] { return Array.isArray(value) ? value.flatMap(nodes) : React.isValidElement(value) ? [value as Node, ...nodes((value.props as { children?: unknown }).children)] : []; }
function harness(kind: Kind, obsolete = false) {
  const reviewScope = { projectId: "p", actor: "current", eligible: true };
  const original: Intent = { kind, ids: ["case-a", "case-b"], draft: kind === "tag" ? " original-tag " : "original-plan", scope: obsolete ? { ...reviewScope, actor: "previous" } : reviewScope };
  let action: Intent | null = original, tag = original.draft, plan = original.draft;
  let finish!: () => void;
  const completion = new Promise<{ error: null }>(resolve => { finish = () => resolve({ error: null }); });
  const mutation = vi.fn(async (_input: unknown) => ({ count: 2 }));
  const runBulkAction = vi.fn(async (execute: (ids: string[]) => Promise<unknown>, ids: string[]) => { await execute(ids); return completion; });
  function render() {
    const bindings = { React, Modal: () => null, ActionButton, styles: { dialogActions: "synthetic" }, readOnly: false, bulkBusy: false, bulkError: null, plans: [{ id: "original-plan", name: "Original" }],
      organizeAction: action, reviewScope, currentReviewScope: () => true, projectId: "p", bulkTag: tag, bulkMovePlanId: plan,
      setOrganizeAction: (next: Intent | null | ((current: Intent | null) => Intent | null)) => { action = typeof next === "function" ? next(action) : next; },
      setBulkTag: (next: string) => { tag = next; }, setBulkMovePlanId: (next: string) => { plan = next; },
      bulkMoveMutation: { mutateAsync: mutation }, bulkTagMutation: { mutateAsync: mutation }, runBulkAction };
    return new Function(...Object.keys(bindings), code)(...Object.values(bindings)) as { tree: unknown; move: () => Promise<void>; tag: () => Promise<void>; open: (kind: Kind, ids: string[]) => void };
  }
  const input = () => nodes(render().tree).find(node => node.type === "select" || node.type === "input");
  return { original, mutation, runBulkAction, render, finish, action: () => action, input,
    run: () => render()[kind](), open: (kind: Kind, ids: string[]) => render().open(kind, ids), edit: (value: string) => { (input()!.props.onChange as (event: { target: { value: string } }) => void)({ target: { value } }); } };
}
it.each(["move", "tag"] as const)("late %s completion preserves newer unsent input and its dialog", async kind => {
  const h = harness(kind), done = h.run(); h.edit("new-unsent-draft"); h.finish(); await done;
  expect(h.action()).not.toBeNull(); expect(h.input()?.props.value).toBe("new-unsent-draft");
  expect(h.mutation).toHaveBeenCalledExactlyOnceWith({ projectId: "p", ids: h.original.ids, ...(kind === "tag" ? { tags: ["original-tag"] } : { testPlanId: "original-plan" }) });
});
it.each(["move", "tag"] as const)("an old-scope %s intent is hidden and cannot dispatch through a fresh handler", async kind => {
  const h = harness(kind, true), done = h.run(); h.finish(); await done;
  expect(h.input()).toBeUndefined(); expect(h.mutation).not.toHaveBeenCalled(); expect(h.action()).toBe(h.original);
});
it.each(["move", "tag"] as const)("current unchanged %s completion closes only its original intent", async kind => {
  const h = harness(kind), done = h.run(); h.finish(); await done;
  expect(h.mutation).toHaveBeenCalledOnce(); expect(h.action()).toBeNull(); expect(h.runBulkAction.mock.calls[0]![1]).toBe(h.original.ids);
});
it("a fresh dialog pins its own scope and copied IDs without exposing an old owner's draft", () => {
  const h = harness("tag", true), ids = ["new-case"];
  h.open("move", ids); ids.push("not-reviewed");
  expect(h.action()).toMatchObject({ kind: "move", ids: ["new-case"], draft: "" });
  expect(h.action()!.scope).not.toBe(h.original.scope); expect(h.input()?.props.value).toBe("");
  expect(h.mutation).not.toHaveBeenCalled();
});

// Integration seam: actual organize handler, current-owner guard and batch
// runner together. Only mutation/committed state are synthetic, not a live API.
it.each(["complete", "new-draft", "new-owner"])("organize batching preserves the %s intent across a pending first response", async scenario => {
  const names = ["bulkAddTag", "editOrganizeDraft", "runBulkAction", "currentReviewScope"];
  const actual = page.body!.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text ?? "")).map(node => node.getText(ast)).join("\n");
  const ids = Array.from({ length: 401 }, (_, index) => `synthetic-${index}`);
  const reviewScope = { projectId: "p", userId: "u", sessionId: "s", eligible: true };
  const original = { kind: "tag", ids, draft: " original-tag ", scope: reviewScope };
  let intent = original as typeof original | null, selected = new Set(ids);
  const activeReviewScope = { current: reviewScope };
  let acknowledge!: () => void;
  const pending = new Promise<void>(resolve => { acknowledge = resolve; });
  const mutation = vi.fn(async ({ ids: batch }: { ids: string[] }) => { await pending; return { count: batch.length }; });
  const reload = vi.fn(), notice = vi.fn(), busy = vi.fn();
  const bindings = { organizeAction: original, reviewScope, activeReviewScope, projectId: "p", readOnly: false, bulkBusy: false, selected,
    window: { Clerk: { loaded: true, session: { id: "s", user: { id: "u" } } } }, currentSessionScope, runCaseActionBatches,
    bulkTagMutation: { mutateAsync: mutation }, reload, setBulkBusy: busy, setBulkError: notice,
    setSelected: (update: (value: Set<string>) => Set<string>) => { selected = update(selected); },
    setOrganizeAction: (update: (value: typeof intent) => typeof intent) => { intent = update(intent); } };
  const handlers = new Function(...Object.keys(bindings), ts.transpileModule(actual + ";return {run:bulkAddTag,edit:editOrganizeDraft};", { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText)(...Object.values(bindings)) as { run(): Promise<void>; edit(value: string): void };
  const done = handlers.run();
  expect(mutation).toHaveBeenCalledOnce(); expect(busy).toHaveBeenLastCalledWith(true);
  if (scenario !== "complete") handlers.edit("new-unsent-tag");
  if (scenario === "new-owner") { activeReviewScope.current = { ...reviewScope, userId: "new-owner" }; selected = new Set(["new-owner-selection"]); }
  acknowledge(); await done;
  expect(mutation).toHaveBeenCalledTimes(scenario === "new-owner" ? 1 : 3);
  expect(mutation.mock.calls.map(([input]) => input.ids)).toEqual(scenario === "new-owner" ? [ids.slice(0, 200)] : [ids.slice(0, 200), ids.slice(200, 400), ids.slice(400)]);
  expect(mutation.mock.calls.every(([input]) => JSON.stringify(input).includes('"tags":["original-tag"]'))).toBe(true);
  expect(intent).toEqual(scenario === "complete" ? null : { ...original, draft: "new-unsent-tag" });
  expect([...selected]).toEqual(scenario === "new-owner" ? ["new-owner-selection"] : []);
  expect(reload).toHaveBeenCalledTimes(scenario === "new-owner" ? 0 : 1);
  expect(notice.mock.calls).toEqual([[null]]); expect(busy).toHaveBeenLastCalledWith(false);
});
