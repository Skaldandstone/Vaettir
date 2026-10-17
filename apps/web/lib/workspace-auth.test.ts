import { createHmac } from "node:crypto";
import { describe, expect, it, vi, afterEach } from "vitest";
import { isWorkspaceAuthHost, workspaceRedirectOrigins, verifiedWorkspaceWebHost } from "./workspace-auth";
afterEach(() => vi.restoreAllMocks());
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
});
