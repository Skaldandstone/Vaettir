import { readFileSync } from "node:fs";
import ts from "typescript";
import { expect, it, vi } from "vitest";
import { currentSessionScope } from "./auth-query-cache";

// Actual saved-view handlers; only committed view/SDK/response boundaries are
// synthetic. Never invokes the saved-view API, database or native confirmation.
const ast = ts.createSourceFile("page.tsx", readFileSync(new URL("../app/projects/[projectId]/test-cases/page.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const page = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "TestCasesPage") as ts.FunctionDeclaration;
const selected = ["saveNewView", "saveCurrentView", "deleteCurrentView", "currentViewFrame", "refreshSavedViews"];
const code = ts.transpileModule(page.body!.statements.filter(node => ts.isFunctionDeclaration(node) && selected.includes(node.name?.text ?? "")).map(node => node.getText(ast)).join("\n"), { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText;
type Operation = "create" | "update" | "delete";
function harness() {
  let resolve!: (value: unknown) => void, reject!: (error: unknown) => void;
  const waiting = new Promise<unknown>((yes, no) => { resolve = yes; reject = no; });
  const state = { active: "original", name: " First draft ", error: null as string | null };
  const declaration = page.body!.statements.flatMap(node => ts.isVariableStatement(node) ? [...node.declarationList.declarations] : []).find(node => node.name.getText(ast) === "viewFrame");
  const factory = (declaration?.initializer as ts.CallExpression | undefined)?.arguments[0];
  if (!factory) throw Error("Actual saved-view frame factory missing");
  const frame = new Function("projectId", "permissions", "folderActor", "viewFrameKey", "return (" + factory.getText(ast) + ");")(
    "p", { loaded: true, accessError: null, organizationId: "o", canEdit: false },
    { isLoaded: true, isSignedIn: true, userId: "u", sessionId: "s" }, "original-intent",
  )();
  const activeViewFrame = { current: null };
  const effect = page.body!.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(ast) === "useLayoutEffect" && node.expression.arguments[0]?.getText(ast).includes("activeViewFrame")) as ts.ExpressionStatement | undefined;
  if (!effect) throw Error("Actual saved-view frame lifecycle missing");
  const callback = (effect.expression as ts.CallExpression).arguments[0]!;
  new Function("viewFrame", "activeViewFrame", "return (" + callback.getText(ast) + ");")(frame, activeViewFrame)();
  const mutation = vi.fn((_input: unknown) => waiting), invalidate = vi.fn(async () => {});
  const bindings = { projectId: "p", currentView: { id: "original", name: "Original", version: 3 }, newViewName: state.name,
    viewFrame: frame, activeViewFrame, currentSessionScope,
    window: { confirm: vi.fn(() => true), Clerk: { loaded: true, session: { id: "s", user: { id: "u" } } } },
    createView: { mutateAsync: mutation }, updateView: { mutateAsync: mutation }, removeView: { mutateAsync: mutation },
    viewFilters: () => ({ search: "original filters" }), utils: { testCaseViews: { list: { invalidate } } },
    setError: (value: string | null) => { state.error = value; }, setActiveViewId: (value: string) => { state.active = value; }, setNewViewName: (value: string) => { state.name = value; } };
  const handlers = new Function(...Object.keys(bindings), code + ";return {create:saveNewView,update:saveCurrentView,delete:deleteCurrentView};")(...Object.values(bindings)) as Record<Operation, () => Promise<void>>;
  return { state, mutation, invalidate, resolve, reject, run: (operation: Operation) => handlers[operation](),
    switchView: () => { Object.assign(activeViewFrame, { current: { ...frame } }); state.active = "new-view"; state.name = " New draft "; state.error = "New view notice"; } };
}
it.each(["create", "update", "delete"] as const)("late %s success/refusal cannot replace a newly selected view, draft or notice", async operation => {
  for (const result of ["success", "refusal"]) {
    const h = harness(), done = h.run(operation); h.switchView();
    if (result === "success") h.resolve({ id: "created", deleted: true }); else h.reject(Error("synthetic CAS refusal"));
    await done;
    expect(h.state).toEqual({ active: "new-view", name: " New draft ", error: "New view notice" });
    expect(h.mutation).toHaveBeenCalledOnce();
  }
});
it.each(["create", "update", "delete"] as const)("current %s succeeds without changing the original version/filter payload", async operation => {
  const h = harness(), done = h.run(operation); h.resolve({ id: "created", deleted: true }); await done;
  expect(h.mutation).toHaveBeenCalledOnce(); expect(h.mutation.mock.calls[0]![0]).toMatchObject({ projectId: "p", ...(operation === "create" ? { name: "First draft", filters: { search: "original filters" } } : { id: "original", version: 3 }) });
  expect(h.state.active).toBe(operation === "create" ? "created" : operation === "delete" ? "" : "original");
  expect(h.state.name).toBe(operation === "create" ? "" : " First draft "); expect(h.state.error).toBeNull();
});
it.each(["create", "update", "delete"] as const)("%s acknowledgement remains confirmed when refreshing the list fails", async operation => {
  const h = harness(); h.invalidate.mockRejectedValue(Error("synthetic refresh failure"));
  const done = h.run(operation); h.resolve({ id: "created", deleted: true }); await done;
  expect(h.state.error).toBe(operation === "delete" ? "View deleted. Refresh the list." : "View saved. Refresh the list.");
  expect(h.state.active).toBe(operation === "create" ? "created" : operation === "delete" ? "" : "original");
  expect(h.mutation).toHaveBeenCalledOnce();
});
it.each(["create", "update", "delete"] as const)("an obsolete %s handler cannot dispatch a saved-view mutation", async operation => {
  const h = harness(); h.switchView(); const done = h.run(operation); h.resolve({ id: "created", deleted: true }); await done;
  expect(h.mutation).not.toHaveBeenCalled(); expect(h.state.error).toBe("New view notice");
});
