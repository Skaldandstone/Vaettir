// Actual hook with modeled commit/unmount and synthetic auth/query boundaries.
// This is not provider or browser acceptance.
import { readFileSync } from "node:fs";
import ts from "typescript";
import { expect, it } from "vitest";
import { currentSessionScope, sameAuthScope } from "./auth-query-cache";
import type { useProjectCustomActions } from "./use-project-custom-actions";

function fixture() {
  const auth = { isLoaded: true, isSignedIn: true, userId: "subject", sessionId: "session" };
  const browser = { Clerk: { loaded: true, session: { id: "session", user: { id: "subject" } } } };
  const query = { isSuccess: true, isError: false, isFetching: false, isPaused: false, error: null,
    data: { projectId: "project", organizationId: "org", clerkSubject: "subject", permissions: ["plans.write"], policyRevision: 1 }, refetch: async () => ({}) };
  let cleanup: (() => void) | undefined, pending: (() => (() => void)) | undefined;
  const refs: { current: unknown }[] = []; let index = 0;
  let options: { enabled: boolean };
  const modules: Record<string, unknown> = {
    react: { useRef: (initial: unknown) => { const slot = index++; return refs[slot] ?? (refs[slot] = { current: initial }); },
      useLayoutEffect: (effect: () => (() => void)) => { pending = effect; } },
    "@clerk/nextjs": { useAuth: () => auth },
    "./trpcReact": { trpcReact: { identityAccess: { projectActions: { useQuery: (_input: unknown, value: typeof options) => { options = value; return query; } } } } },
    "./auth-query-cache": { currentSessionScope, sameAuthScope },
  };
  const code = ts.transpileModule(readFileSync(new URL("./use-project-custom-actions.ts", import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exported: { useProjectCustomActions?: typeof useProjectCustomActions } = {};
  new Function("require", "exports", "window", code)((name: string) => {
    if (!(name in modules)) throw Error("Unexpected dependency: " + name); return modules[name];
  }, exported, browser);
  function render(projectId = "project") {
    index = 0; const result = exported.useProjectCustomActions!(projectId);
    cleanup?.(); cleanup = pending?.(); return result;
  }
  return { auth, browser, query, render, unmount: () => cleanup?.(), enabled: () => options.enabled };
}
it("allows only current scoped actions, not a broad editor flag", () => {
  const f = fixture(), current = f.render();
  expect(current.allows("plans.write", "org")).toBe(true);
  expect(current.owns("plans.write", "org")).toBe(true);
  expect(current.allows("plans.write", "other")).toBe(false);
  expect(current.allows("integrations.manage")).toBe(false);
});
it.each(["fetching", "paused", "error", "subject", "project", "session", "signedOut"])("withholds stale UI authority for %s", fault => {
  const f = fixture(); const previous = f.render();
  if (fault === "fetching") f.query.isFetching = true;
  if (fault === "paused") f.query.isPaused = true;
  if (fault === "error") f.query.isError = true;
  if (fault === "subject") f.query.data = { ...f.query.data, clerkSubject: "other" };
  if (fault === "project") f.query.data = { ...f.query.data, projectId: "other" };
  if (fault === "session") f.browser.Clerk.session.id = "other";
  if (fault === "signedOut") f.auth.isSignedIn = false;
  expect(f.render().allows("plans.write")).toBe(false);
  expect(previous.owns("plans.write")).toBe(false);
  if (fault === "signedOut") expect(f.enabled()).toBe(false);
});
it("revocation and unmount invalidate retained event callbacks", () => {
  const f = fixture(), previous = f.render();
  f.query.data = { ...f.query.data, permissions: [], policyRevision: 2 };
  expect(f.render().allows("plans.write")).toBe(false);
  expect(previous.owns("plans.write")).toBe(false);
  f.query.data = { ...f.query.data, permissions: ["plans.write"], policyRevision: 3 };
  const restored = f.render(); expect(restored.owns("plans.write")).toBe(true);
  expect(previous.owns("plans.write")).toBe(false);
  f.unmount(); expect(restored.owns("plans.write")).toBe(false);
});
