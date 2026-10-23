import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { expect, it } from "vitest";
import { sameCommentReader } from "./case-comment-draft";
import type { CommentAccess, CommentAccessState } from "./use-case-comment-access";
import type { RouterInputs } from "./trpcReact";
type ReadInput = RouterInputs["caseComments"]["access"];
const source = readFileSync(new URL("./use-case-comment-access.ts", import.meta.url), "utf8"), ast = ts.createSourceFile("access.ts", source, ts.ScriptTarget.Latest, true);
const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "useCaseCommentAccess")!;
const code = ts.transpileModule(`${ts.createPrinter().printNode(ts.EmitHint.Unspecified, declaration, ast).replace(/\bexport\s+/, "")}\nthis.access=useCaseCommentAccess;`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
function harness() {
  const hooks: unknown[] = []; let cursor = 0, dirty = false, uuid = 0, input: ReadInput, enabled = false, result: CommentAccess;
  const auth = { isLoaded: true, isSignedIn: true, userId: "clerk", sessionId: "A" }, params = { projectId: "project", caseId: "case", active: true };
  const query = { data: undefined as CommentAccessState | undefined, isFetchedAfterMount: false, isFetching: false, isPaused: false, error: null as unknown };
  const context = vm.createContext({ useAuth: () => auth, sameCommentReader, crypto: { randomUUID: () => `read-${++uuid}` },
    useState: (initial: unknown) => { const at = cursor++; if (!Object.hasOwn(hooks, at)) hooks[at] = typeof initial === "function" ? initial() : initial; return [hooks[at], (value: unknown) => { const next = typeof value === "function" ? value(hooks[at]) : value; if (!Object.is(next, hooks[at])) { hooks[at] = next; dirty = true; } }]; },
    trpcReact: { caseComments: { access: { useQuery: (value: ReadInput, options: { enabled: boolean }) => { input = value; enabled = options.enabled; return query; } } } },
  }); vm.runInContext(code, context);
  const access = (context as unknown as { access: (...args: unknown[]) => CommentAccess }).access;
  function render() { for (let index = 0; index < 25; index++) { cursor = 0; dirty = false; result = access(params.projectId, params.caseId, params.active); if (!dirty) return result; } throw Error("Comment reader did not settle"); }
  function receive(patch = {}) { query.isFetchedAfterMount = true; query.data = { requestId: input.requestId, projectId: input.projectId, caseId: input.caseId, readScope: { projectId: input.projectId, organizationId: "org", actorClerkUserId: "clerk", actorId: "native" }, canComment: true, ...patch }; return render(); }
  render(); return { auth, params, query, render, receive, input: () => input, enabled: () => enabled };
}
it("actual comments bootstrap pins only completed native echo, then rechecks original pins without custom-field definitions", () => {
  const h = harness(); expect(h.enabled()).toBe(true); expect(h.input()).not.toHaveProperty("originalOrganizationId"); const first = h.input().requestId;
  expect(h.receive().fresh).toBeNull(); expect(h.input().requestId).not.toBe(first); expect(h.input()).toMatchObject({ originalOrganizationId: "org", expectedClerkActorId: "clerk" });
  expect(h.receive().fresh).not.toBeNull(); expect(h.render().origin).toEqual({ projectId: "project", caseId: "case", organizationId: "org", clerkActorId: "clerk", nativeActorId: "native" }); expect(source).not.toContain("useCaseFieldAccess"); expect(source).not.toContain("caseFields");
});
it("session, Clerk, active and case A-B-A rotates requests and never rebinds original author", () => {
  const h = harness(); h.receive(); h.receive(); const original = h.input().requestId;
  h.auth.sessionId = "B"; expect(h.render().fresh).toBeNull(); const other = h.input().requestId; h.auth.sessionId = "A"; expect(h.render().fresh).toBeNull(); expect(h.input().requestId).not.toBe(original); expect(h.input().requestId).not.toBe(other); h.receive();
  h.auth.userId = "other"; expect(h.render().fresh).toBeNull(); expect(h.enabled()).toBe(false); h.auth.userId = "clerk"; expect(h.render().fresh).toBeNull(); h.receive();
  h.params.active = false; expect(h.render().fresh).toBeNull(); expect(h.enabled()).toBe(false); h.params.active = true; expect(h.render().fresh).toBeNull(); h.receive();
  h.params.caseId = "other"; expect(h.render().fresh).toBeNull(); expect(h.enabled()).toBe(false); h.params.caseId = "case"; expect(h.render().fresh).toBeNull(); expect(h.render().origin!.caseId).toBe("case");
});
it("wrong echo/organization/native mapping never supplies current access even to a dual member", () => {
  const h = harness(); h.receive(); h.receive(); const scope = h.query.data!.readScope;
  for (const patch of [{ requestId: "old" }, { caseId: "other" }, { projectId: "other" }, { readScope: { ...scope, actorId: "replacement" } }, { readScope: { ...scope, organizationId: "foreign" } }, { readScope: { ...scope, actorClerkUserId: "other" } }]) expect(h.receive(patch).fresh).toBeNull();
  expect(h.render().origin!.nativeActorId).toBe("native"); expect(h.render().origin!.organizationId).toBe("org");
});
it("completed same-reader access is still hidden on fetching/paused/error/incomplete mount and refresh", () => {
  const h = harness(); h.receive(); h.receive();
  for (const key of ["isFetching", "isPaused"] as const) { h.query[key] = true; expect(h.render().fresh).toBeNull(); h.query[key] = false; }
  h.query.error = Error("Revoked"); expect(h.render().fresh).toBeNull(); h.query.error = null; h.query.isFetchedAfterMount = false; expect(h.render().fresh).toBeNull(); h.query.isFetchedAfterMount = true;
  h.render().refresh(); expect(h.render().fresh).toBeNull(); expect(h.receive().fresh).not.toBeNull();
});
