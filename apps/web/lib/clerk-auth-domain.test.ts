import { describe, expect, it } from "vitest";
import { legacyAuthDocumentDestination, workspaceClerkConfiguration } from "./clerk-auth-domain";

const legacy = "https://vaettir.skaldandstone.com";
const primary = "https://app.vaettir.app";
const request = (path: string, method = "GET", extra: Record<string, string> = {}) => ({
  url: legacy + path, method, headers: new Headers({ "sec-fetch-dest": "document", ...extra }),
});
describe("coordinated primary authentication migration", () => {
  it("retains the live bridge by default and uses same-domain sessions only in the explicitly enabled release", () => {
    expect(workspaceClerkConfiguration("synthetic.vaettir.app", false).isSatellite).toBe(true);
    const config = workspaceClerkConfiguration("synthetic.vaettir.app", true, "synthetic,admin,https://evil.test");
    expect(config.isSatellite).toBe(false);
    expect(config.signInUrl).toBe(primary + "/sign-in");
    expect(config.signUpUrl).toBe(primary + "/sign-up");
    expect(config.allowedRedirectOrigins).toEqual([primary, "https://synthetic.vaettir.app"]);
  });
  it("preserves complete project/native setup links without trusting forwarding or return hosts", () => {
    const path = "/integrations/atlassian/connect?request=opaque_-state&next=%2Fprojects%2Fa%3Ftab%3Dx";
    expect(legacyAuthDocumentDestination(request(path, "GET", { "x-forwarded-host": "evil.test" }), null)).toBe(primary + path);
    expect(legacyAuthDocumentDestination(request("/projects/a?tab=reports", "HEAD"), null)).toBe(primary + "/projects/a?tab=reports");
    const auth = new URL(legacyAuthDocumentDestination(request("/sign-in?redirect_url=" + encodeURIComponent(legacy + "/projects/a?tab=x#report")), null)!);
    expect(auth.searchParams.get("redirect_url")).toBe(primary + "/projects/a?tab=x#report");
    expect(legacyAuthDocumentDestination(request("/projects/a"), "synthetic.vaettir.app")).toBeNull();
  });
  it("never redirects writes, bearer requests, APIs, webhooks, provider callbacks or background fetches", () => {
    for (const path of ["/api/integrations/forge/quality", "/api/health/detailed", "/trpc/private", "/webhooks/clerk", "/connections/github/callback?code=synthetic", "/__clerk/v1/client", "/_next/static/a.js"])
      expect(legacyAuthDocumentDestination(request(path), null)).toBeNull();
    for (const method of ["POST", "PUT", "DELETE", "OPTIONS"])
      expect(legacyAuthDocumentDestination(request("/projects/a", method), null)).toBeNull();
    expect(legacyAuthDocumentDestination(request("/projects/a", "GET", { authorization: "Bearer synthetic" }), null)).toBeNull();
    expect(legacyAuthDocumentDestination(request("/projects/a", "GET", { "sec-fetch-dest": "empty" }), null)).toBeNull();
  });
  it("rejects external, credentialed, insecure and ambiguous sign-in returns", () => {
    for (const back of ["https://evil.test/a", "http://app.vaettir.app/a", "https://user:synthetic@app.vaettir.app/a", "//evil.test/a", "https://unknown.vaettir.app/a"])
      expect(() => legacyAuthDocumentDestination(request("/sign-in?redirect_url=" + encodeURIComponent(back)), null, "synthetic")).toThrow();
    expect(() => legacyAuthDocumentDestination(request("/sign-in?redirect_url=%2Fa&redirect_url=%2Fb"), null)).toThrow("Ambiguous");
    const back = "https://synthetic.vaettir.app/projects/a";
    expect(new URL(legacyAuthDocumentDestination(request("/sign-in?redirect_url=" + encodeURIComponent(back)), null, "synthetic")!).searchParams.get("redirect_url")).toBe(back);
  });
});
