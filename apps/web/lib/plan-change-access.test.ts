import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { expect, it } from "vitest";
const source = readFileSync(new URL("./use-plan-change-access.ts", import.meta.url), "utf8"), ast = ts.createSourceFile("access.ts", source, ts.ScriptTarget.Latest, true);
const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "usePlanChangeAccess")!;
const code = ts.transpileModule(`${ts.createPrinter().printNode(ts.EmitHint.Unspecified, declaration, ast).replace(/\bexport\s+/, "")}\nthis.access=usePlanChangeAccess;`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
function harness() {
  const hooks: unknown[] = []; let cursor = 0, dirty = false, uuid = 0, input: any, enabled = false, result: any;
  const auth = { isLoaded: true, isSignedIn: true, userId: "clerk", sessionId: "A" }, params = { org: "org", project: "project", plan: "plan", active: true };
  const query = { data: undefined as any, isFetchedAfterMount: false, isFetching: false, isPaused: false, error: null as unknown };
  const context = vm.createContext({ useAuth: () => auth, crypto: { randomUUID: () => `read-${++uuid}` },
    useState: (initial: unknown) => { const at = cursor++; if (!Object.hasOwn(hooks, at)) hooks[at] = typeof initial === "function" ? initial() : initial; return [hooks[at], (value: unknown) => { const next = typeof value === "function" ? value(hooks[at]) : value; if (!Object.is(next, hooks[at])) { hooks[at] = next; dirty = true; } }]; },
    trpcReact: { testPlanGovernance: { preview: { useQuery: (value: unknown, options: { enabled: boolean }) => { input = value; enabled = options.enabled; return query; } } } },
  }); vm.runInContext(code, context);
  const access = (context as unknown as { access: (...args: unknown[]) => unknown }).access;
  function render() { for (let index = 0; index < 25; index++) { cursor = 0; dirty = false; result = access(params.project, params.plan, params.org, params.active); if (!dirty) return result; } throw Error("Native reader did not settle"); }
  function receive(patch = {}) { query.isFetchedAfterMount = true; query.data = { requestId: input.requestId, scope: { projectId: input.projectId, organizationId: input.originalOrganizationId, actorClerkUserId: input.expectedClerkActorId, actorId: "native" }, snapshot: { id: input.testPlanId, projectId: input.projectId, customFields: null }, canRecover: true, metadataSchema: { fieldSchemaHash: null, fieldSchema: null, supported: false, canEdit: false }, ...patch }; return render(); }
  render(); return { auth, params, query, render, receive, input: () => input, enabled: () => enabled };
}
it("pins only echoed current native reads, then requires its new pinned activation before admission", () => {
  const h = harness(); expect(h.enabled()).toBe(true); const bootstrap = h.input().requestId;
  expect(h.receive().fresh).toBeNull(); expect(h.input().requestId).not.toBe(bootstrap);
  expect(h.receive().fresh).not.toBeNull(); expect(h.render().origin).toEqual({ projectId: "project", organizationId: "org", clerkActorId: "clerk", caseId: null });
});
it("session/actor/org A-B-A never reuses a prior activation or transfers the original reader", () => {
  const h = harness(); h.receive(); h.receive(); const original = h.input().requestId;
  h.auth.sessionId = "B"; expect(h.render().fresh).toBeNull(); const otherSession = h.input().requestId;
  h.auth.sessionId = "A"; expect(h.render().fresh).toBeNull(); expect(h.input().requestId).not.toBe(original); expect(h.input().requestId).not.toBe(otherSession);
  h.receive(); h.auth.userId = "other"; expect(h.render().fresh).toBeNull(); expect(h.enabled()).toBe(false); h.auth.userId = "clerk"; expect(h.render().fresh).toBeNull(); h.receive();
  h.params.org = "other-org"; expect(h.render().fresh).toBeNull(); expect(h.enabled()).toBe(false); expect(h.input().originalOrganizationId).toBe("org");
  h.params.org = "org"; expect(h.render().fresh).toBeNull(); expect(h.render().origin.organizationId).toBe("org");
});
it("missing discovery, fetching, paused and errors hide private snapshots, not blank/default metadata", () => {
  const h = harness(); h.receive(); h.receive();
  for (const key of ["isFetching", "isPaused"] as const) { h.query[key] = true; expect(h.render().fresh).toBeNull(); h.query[key] = false; }
  h.query.error = Error("Revoked"); expect(h.render().fresh).toBeNull(); h.query.error = null;
  h.params.org = ""; expect(h.render().fresh).toBeNull(); expect(h.enabled()).toBe(false); h.params.org = "org"; expect(h.render().fresh).toBeNull();
});
it("unsupported metadata schema does not block genuine native status/receipt recovery; actor remapping still withholds", () => {
  const h = harness(); h.receive(); const native = h.receive(); expect(native.fresh.canRecover).toBe(true); expect(native.fresh.metadataSchema.fieldSchemaHash).toBeNull();
  const oldScope = h.query.data.scope; h.receive({ scope: { ...oldScope, actorId: "replacement" } }); expect(h.render().fresh).toBeNull(); expect(h.render().nativeActorId).toBe("native");
});
it("explicit refresh/closed views require new current read and wrong native scope/token is never relabelled", () => {
  const h = harness(); h.receive(); h.receive(); h.render().refresh(); expect(h.render().fresh).toBeNull(); h.receive();
  h.params.active = false; expect(h.render().fresh).toBeNull(); expect(h.enabled()).toBe(false); h.params.active = true; expect(h.render().fresh).toBeNull();
  for (const patch of [{ requestId: "old" }, { snapshot: { id: "other", projectId: "project" } }, { scope: { ...h.query.data.scope, organizationId: "foreign" } }]) expect(h.receive(patch).fresh).toBeNull();
  h.params.project = "other-project"; expect(h.render().fresh).toBeNull(); expect(h.render().origin.projectId).toBe("project");
});
