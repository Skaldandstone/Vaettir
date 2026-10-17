import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { authReturnUrl, isBrowserDocument, LEGACY_APPLICATION_ORIGIN } from "./auth-return.ts";

test("proxy HTTP input preserves the entire setup path/query on the configured HTTPS origin", () => {
  const path = new URL("http://internal:3000/integrations/atlassian/connect?request=opaque_-state&next=%2Fprojects%2Fa%3Fview%3Dx");
  assert.equal(authReturnUrl(path, LEGACY_APPLICATION_ORIGIN), "https://vaettir.skaldandstone.com" + path.pathname + path.search);
  assert.equal(authReturnUrl(path, "https://verified-workspace.example"), "https://verified-workspace.example" + path.pathname + path.search);
});
test("paths and query redirect hints cannot change the trusted return authority", () => {
  for (const pathname of ["//attacker.invalid/path", "/\\attacker.invalid/path", "/%2F%2Fattacker.invalid/path"]) {
    const target = new URL(authReturnUrl({ pathname, search: "?redirect_url=https%3A%2F%2Fattacker.invalid" }, LEGACY_APPLICATION_ORIGIN));
    assert.equal(target.origin, LEGACY_APPLICATION_ORIGIN);
  }
});
test("invalid origins fail closed, with loopback HTTP allowed only by explicit local-development policy", () => {
  for (const origin of ["http://example.com", "https://user:secret@example.com", "https://example.com/path", "https://example.com?next=x", "https://example.com#x", "javascript:alert(1)", "http://localhost:3000"]) {
    assert.throws(() => authReturnUrl({ pathname: "/private", search: "" }, origin));
  }
  assert.equal(authReturnUrl({ pathname: "/private", search: "" }, "http://localhost:3000", true), "http://localhost:3000/private");
  assert.throws(() => authReturnUrl({ pathname: "/", search: "" }, "http://attacker.invalid", true));
});
test("only browser GET documents or iframes use explicit sign-in navigation", () => {
  for (const destination of ["document", "iframe"]) assert.equal(isBrowserDocument({ method: "GET", headers: new Headers({ "sec-fetch-dest": destination }) }), true);
  assert.equal(isBrowserDocument({ method: "GET", headers: new Headers({ accept: "text/html" }) }), true);
  assert.equal(isBrowserDocument({ method: "POST", headers: new Headers({ accept: "text/html" }) }), false);
  assert.equal(isBrowserDocument({ method: "GET", headers: new Headers({ "sec-fetch-dest": "empty", accept: "application/json" }) }), false);
});

// Exercise the actual middleware handler with only the Clerk boundary mocked.
const source = readFileSync(new URL("../middleware.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source.replace(/^import .*;\r?\n/gm, ""), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
  .replace("export default ", "this.handler = ").replace("export const config", "const config");
async function invoke({ signedIn = false, pending = false, method = "GET", path = "/integrations/atlassian/connect?request=opaque_-state", destination = "document" } = {}) {
  const events = [];
  const session = { isAuthenticated: signedIn, sessionStatus: pending ? "pending" : signedIn ? "active" : null, redirectToSignIn: options => { events.push(["redirect", options]); return "redirected"; } };
  const auth = Object.assign(async () => session, { protect: async () => { events.push(["protect"]); } });
  const sandbox = { authReturnUrl, isBrowserDocument, LEGACY_APPLICATION_ORIGIN, process: { env: { NODE_ENV: "production" } },
    clerkMiddleware: handler => handler,
    createRouteMatcher: routes => { assert.deepEqual([...routes], ["/", "/sign-in(.*)", "/sign-up(.*)", "/share(.*)", "/beta-guide(.*)"]); return req => ["/", "/sign-in", "/sign-up", "/share", "/beta-guide"].some(route => req.nextUrl.pathname === route || (route !== "/" && req.nextUrl.pathname.startsWith(route + "/"))); },
  };
  vm.createContext(sandbox); vm.runInContext(code, sandbox);
  await sandbox.handler(auth, { method, headers: new Headers({ "sec-fetch-dest": destination, "x-forwarded-host": "attacker.invalid", "x-forwarded-proto": "http" }), nextUrl: new URL(path, "http://internal:3000") });
  return events;
}
test("actual signed-out document handler chooses HTTPS without reflecting forwarded headers", async () => {
  const events = await invoke(); assert.equal(events.length, 1); assert.equal(events[0][0], "redirect"); assert.equal(events[0][1].returnBackUrl, LEGACY_APPLICATION_ORIGIN + "/integrations/atlassian/connect?request=opaque_-state");
});
test("actual handler retains auth.protect for signed-in, pending tasks and APIs; public pages remain public", async () => {
  for (const options of [{ signedIn: true }, { pending: true }, { method: "POST" }, { destination: "empty" }, { path: "/api/private" }, { path: "/trpc/private" }]) assert.equal((await invoke(options))[0][0], "protect");
  assert.deepEqual(await invoke({ path: "/beta-guide" }), []);
});
