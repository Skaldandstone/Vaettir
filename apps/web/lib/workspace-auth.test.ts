import { createHmac } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { createRequire } from "node:module";
import { parse } from "node:url";
import { describe, expect, it, vi, afterEach } from "vitest";
import { isWorkspaceAuthHost, workspaceRedirectOrigins, verifiedWorkspaceWebHost } from "./workspace-auth";
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe("workspace authentication origins", () => {
  it("recognizes only single valid workspace labels and the entry host", () => {
    for (const host of ["app.vaettir.app", "synthetic-team.vaettir.app"]) expect(isWorkspaceAuthHost(host)).toBe(true);
    for (const host of ["vaettir.app", "www.vaettir.app", "admin.vaettir.app", "x.y.vaettir.app", "team.vaettir.app.evil.test", "vaettir.skaldandstone.com"]) expect(isWorkspaceAuthHost(host)).toBe(false);
    expect(workspaceRedirectOrigins("synthetic-team,admin,https://evil.test")).toEqual(["https://app.vaettir.app", "https://synthetic-team.vaettir.app"]);
  });
  it("requires an edge signature binding server-side satellite selection to the exact path", async () => {
    const now = 1792200000000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    const host = "synthetic-team.vaettir.app", secret = "synthetic-web-ingress-".repeat(4), time = String(now);
    const signature = createHmac("sha256", secret).update(["vaettir-domain-v1", time, "GET", host, "/projects/synthetic?tab=readiness"].join("\n")).digest("hex");
    const request = { method: "GET", url: "https://origin.invalid/projects/synthetic?tab=readiness",
      headers: new Headers({ "x-vaettir-host": host, "x-vaettir-time": time, "x-vaettir-signature": signature }) };
    expect(await verifiedWorkspaceWebHost(request, secret)).toBe(host);
    await expect(verifiedWorkspaceWebHost({ ...request, url: "https://origin.invalid/other" }, secret)).rejects.toThrow();
    await expect(verifiedWorkspaceWebHost(request, undefined)).rejects.toThrow();
    expect(await verifiedWorkspaceWebHost({ ...request, headers: new Headers() }, secret)).toBeNull();
  });
  it("verifies the original signed target through the installed Next middleware adapter", async () => {
    vi.stubGlobal("AsyncLocalStorage", AsyncLocalStorage);
    const require = createRequire(import.meta.url);
    const { adapter } = require("next/dist/server/web/adapter");
    const { urlQueryToSearchParams } = require("next/dist/shared/lib/router/utils/querystring");
    const secret = "synthetic-web-ingress-".repeat(4), host = "app.vaettir.app", time = String(Date.now());
    for (const target of [
      "/integrations/atlassian/connect?request=synthetic-opaque&compat=primary%20domain",
      "/projects/synthetic?a=first&b=%2B%25%2F%7E&a=second&empty=&_rsc=synthetic",
      "/projects/synthetic?unicode=%E2%9C%93&blank&unicode=second",
      "/projects/synthetic?request=opaque%2Btoken&2=two&1=first&2=second&__proto__=safe&_rsc=synthetic",
    ]) {
      const headers = new Headers({ "x-vaettir-host": host, "x-vaettir-time": time, "x-vaettir-target": target,
        "x-vaettir-signature": createHmac("sha256", secret).update(["vaettir-domain-v1", time, "GET", host, target].join("\n")).digest("hex") });
      // runMiddleware constructs this URL from parsed.query before the adapter.
      const parsed = parse(target, true), query = urlQueryToSearchParams(parsed.query).toString();
      let checked = false;
      await adapter({ page: "/middleware", request: {
        url: `http://localhost:3000${parsed.pathname}${query ? `?${query}` : ""}`,
        method: "GET", headers: Object.fromEntries(headers), nextConfig: {},
      }, handler: async (request: { method: string; url: string; headers: Headers }) => {
        expect(await verifiedWorkspaceWebHost(request, secret)).toBe(host);
        const observed = { method: request.method, url: request.url, headers: request.headers };
        for (const changed of [
          { ...observed, method: "POST" },
          { ...observed, url: request.url.replace(parsed.pathname!, "/other") },
          { ...observed, url: request.url + "&request=changed" },
          { ...observed, headers: new Headers({ ...Object.fromEntries(headers), "x-vaettir-host": "other-team.vaettir.app" }) },
          { ...observed, headers: new Headers({ ...Object.fromEntries(headers), "x-vaettir-target": target + "&extra=value" }) },
        ]) await expect(verifiedWorkspaceWebHost(changed, secret)).rejects.toThrow("Invalid workspace ingress");
        checked = true;
        return new Response(null);
      } });
      expect(checked).toBe(true);
    }
  });
  it("rejects changed query values, duplicate value order and unsigned target substitution", async () => {
    const target = "/projects?request=opaque%2Btoken&a=first&b=value&a=second", time = String(Date.now());
    const secret = "synthetic-web-ingress-".repeat(4), host = "app.vaettir.app";
    const headers = new Headers({ "x-vaettir-host": host, "x-vaettir-time": time, "x-vaettir-target": target,
      "x-vaettir-signature": createHmac("sha256", secret).update(["vaettir-domain-v1", time, "GET", host, target].join("\n")).digest("hex") });
    for (const changed of [
      "/projects?request=opaque+token&a=first&a=second&b=value",
      "/projects?request=opaque%2Btoken&a=second&a=first&b=value",
      "/projects?request=opaque%2Btoken&a=first&b=value",
    ]) await expect(verifiedWorkspaceWebHost({ method: "GET", url: "https://origin.invalid" + changed, headers }, secret)).rejects.toThrow();
    for (const forged of ["//evil.test/projects", "https://evil.test/projects", "/projects#fragment"]) {
      const changed = new Headers(headers); changed.set("x-vaettir-target", forged);
      await expect(verifiedWorkspaceWebHost({ method: "GET", url: "https://origin.invalid" + target, headers: changed }, secret)).rejects.toThrow();
    }
  });
});
