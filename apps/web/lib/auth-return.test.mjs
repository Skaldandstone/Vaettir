import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { authReturnUrl, isBrowserDocument, LEGACY_APPLICATION_ORIGIN } from "./auth-return.ts";
import { isWorkspaceAuthHost, workspaceRedirectOrigins } from "./workspace-auth.ts";

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

// Exercise the actual middleware and request normalizer with the Clerk and
// cryptographic ingress boundaries mocked. The SDK/HMAC test runs separately.
const { NextRequest } = createRequire(import.meta.url)("next/server");
const normalizer = readFileSync(new URL("./workspace-clerk-request.ts", import.meta.url), "utf8");
const normalizerCode = ts.transpileModule(normalizer.replace(/^import .*;\r?\n/gm, ""), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
  .replace("export async function verifiedWorkspaceClerkRequest", "this.verifiedWorkspaceClerkRequest = async function verifiedWorkspaceClerkRequest");
const source = readFileSync(new URL("../middleware.ts", import.meta.url), "utf8");
const domainSource = readFileSync(new URL("./clerk-auth-domain.ts", import.meta.url), "utf8");
const domainCode = ts.transpileModule(domainSource.replace(/^import .*;\r?\n/gm, ""), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText.replace(/^export /gm, "");
const code = ts.transpileModule(source.replace(/^import .*;\r?\n/gm, ""), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
  .replace("export default ", "this.handler = ").replace("export const config", "const config");
async function invoke({ signedIn = false, pending = false, method = "GET", path = "/integrations/atlassian/connect?request=opaque_-state", destination = "document", workspaceHost = null, invalidWorkspace = false, primary = false, originHost = "vaettir.skaldandstone.com" } = {}) {
  const events = [];
  const session = { isAuthenticated: signedIn, sessionStatus: pending ? "pending" : signedIn ? "active" : null, redirectToSignIn: options => { events.push(["redirect", options]); return "redirected"; } };
  const auth = Object.assign(async () => session, { protect: async () => { events.push(["protect"]); } });
  const sandbox = { authReturnUrl, isBrowserDocument, LEGACY_APPLICATION_ORIGIN, NextRequest, Headers, URL, Response, isWorkspaceAuthHost, workspaceRedirectOrigins,
    verifiedWorkspaceWebHost: async () => { if (invalidWorkspace) throw new Error("Invalid workspace ingress"); return workspaceHost; },
    process: { env: { NODE_ENV: "production", NEXT_PUBLIC_VAETTIR_WORKSPACE_AUTH_ENABLED: workspaceHost || invalidWorkspace || primary ? "1" : undefined,
      NEXT_PUBLIC_VAETTIR_PRIMARY_AUTH_ENABLED: primary ? "1" : undefined, NEXT_PUBLIC_VAETTIR_ACTIVE_WORKSPACE_NAMES: "synthetic" } },
    clerkMiddleware: (handler, options) => async request => {
      if (workspaceHost && ["GET", "HEAD"].includes(method)) {
        assert.equal(request.headers.get("x-forwarded-host"), workspaceHost);
        assert.equal(request.headers.get("x-forwarded-proto"), "https");
      }
      const configured = await options(request);
      if (primary) {
        assert.equal(configured.isSatellite, false);
        assert.equal(configured.signInUrl, "https://app.vaettir.app/sign-in");
      }
      return handler(auth, request);
    },
    createRouteMatcher: routes => { assert.deepEqual([...routes], ["/", "/sign-in(.*)", "/sign-up(.*)", "/share(.*)", "/beta-guide(.*)"]); return req => ["/", "/sign-in", "/sign-up", "/share", "/beta-guide"].some(route => req.nextUrl.pathname === route || (route !== "/" && req.nextUrl.pathname.startsWith(route + "/"))); },
  };
  vm.createContext(sandbox); vm.runInContext(domainCode, sandbox); vm.runInContext(normalizerCode, sandbox); vm.runInContext(code, sandbox);
  const response = await sandbox.handler(new NextRequest(new URL(path, "http://internal:3000"), { method,
    headers: new Headers({ "sec-fetch-dest": destination, host: originHost, "x-forwarded-host": "attacker.invalid", "x-forwarded-proto": "http" }),
  }), {});
  if (response instanceof Response) events.push(["response", response.status, response.headers.get("location"), response.headers.get("cache-control")]);
  return events;
}
test("actual signed-out document handler chooses HTTPS without reflecting forwarded headers", async () => {
  const events = await invoke(); assert.equal(events.length, 1); assert.equal(events[0][0], "redirect"); assert.equal(events[0][1].returnBackUrl, LEGACY_APPLICATION_ORIGIN + "/integrations/atlassian/connect?request=opaque_-state");
});
test("actual handler preserves a verified customer return origin and fails closed on invalid ingress", async () => {
  const events = await invoke({ workspaceHost: "synthetic.vaettir.app", path: "/projects/synthetic/reports?tab=readiness" });
  assert.equal(events[0][1].returnBackUrl, "https://synthetic.vaettir.app/projects/synthetic/reports?tab=readiness");
  await assert.rejects(invoke({ invalidWorkspace: true }), /Invalid workspace ingress/);
});
test("actual handler retains auth.protect for signed-in, pending tasks and APIs; public pages remain public", async () => {
  for (const options of [{ signedIn: true }, { pending: true }, { method: "POST" }, { destination: "empty" }, { path: "/api/private" }, { path: "/trpc/private" }]) assert.equal((await invoke(options))[0][0], "protect");
  assert.deepEqual(await invoke({ path: "/beta-guide" }), []);
});
test("primary cutover redirects legacy documents before Clerk while preserving opaque setup query and protecting APIs", async () => {
  assert.deepEqual(await invoke({ primary: true }), [["response", 307, "https://app.vaettir.app/integrations/atlassian/connect?request=opaque_-state", "no-store"]]);
  for (const options of [{ path: "/api/private" }, { path: "/trpc/private" }, { method: "POST" }])
    assert.equal((await invoke({ primary: true, ...options }))[0][0], "protect");
  assert.deepEqual(await invoke({ primary: true, path: "/sign-in?redirect_url=https%3A%2F%2Fevil.test" }), [["response", 400, null, "no-store"]]);
  await assert.rejects(invoke({ primary: true, invalidWorkspace: true }), /Invalid workspace ingress/);
});
test("primary cutover keeps verified customer auth protection and HTTPS returns on the new primary", async () => {
  const events = await invoke({ primary: true, workspaceHost: "synthetic.vaettir.app", path: "/projects/synthetic" });
  assert.equal(events[0][0], "redirect");
  assert.equal(events[0][1].returnBackUrl, "https://synthetic.vaettir.app/projects/synthetic");
  for (const options of [{ signedIn: true }, { pending: true }, { method: "POST" }, { path: "/api/private" }])
    assert.equal((await invoke({ primary: true, workspaceHost: "synthetic.vaettir.app", ...options }))[0][0], "protect");
});

test("primary sign-in behind a rewritten origin Host keeps the complete setup return on the new application", async () => {
  const path = "/integrations/atlassian/connect?request=opaque_-state&next=%2Fprojects%2Fa%3Ftab%3Dx";
  const events = await invoke({ primary: true, originHost: "internal-alb.example", path });
  assert.equal(events[0][0], "redirect");
  assert.equal(events[0][1].returnBackUrl, "https://app.vaettir.app" + path);
  for (const options of [{ signedIn: true }, { pending: true }, { method: "POST" }, { path: "/api/private" }, { path: "/trpc/private" }])
    assert.equal((await invoke({ primary: true, originHost: "internal-alb.example", ...options }))[0][0], "protect");
  assert.deepEqual(await invoke({ primary: true, originHost: "internal-alb.example", path: "/" }), []);
  await assert.rejects(invoke({ primary: true, originHost: "internal-alb.example", invalidWorkspace: true }), /Invalid workspace ingress/);
});
