import { createHmac } from "node:crypto";
import { createClerkClient } from "@clerk/nextjs/server";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { verifiedWorkspaceClerkRequest } from "./workspace-clerk-request";

const secret = "synthetic-clerk-ingress-fixture-".repeat(3);
const target = "/projects?__clerk_synced=false&tab=readiness";
function attested(method = "GET", body?: string) {
  const time = String(Date.now());
  const signature = createHmac("sha256", secret)
    .update(["vaettir-domain-v1", time, method, "app.vaettir.app", target].join("\n")).digest("hex");
  return new NextRequest("http://localhost:3000" + target, {
    method, ...(body ? { body } : {}),
    headers: {
      "x-vaettir-host": "app.vaettir.app", "x-vaettir-time": time,
      "x-vaettir-signature": signature, "x-forwarded-host": "app.vaettir.app",
      "x-forwarded-proto": "http", "sec-fetch-dest": "document", accept: "text/html",
    },
  });
}
const clerk = createClerkClient({
  publishableKey: "pk_live_" + Buffer.from("clerk.primary.example.test$").toString("base64"),
  secretKey: "sk_live_synthetic_fixture_only",
});
const satellite = { isSatellite: true, domain: "vaettir.app", signInUrl: "https://vaettir.skaldandstone.com/sign-in" };
afterEach(() => vi.restoreAllMocks());

describe("verified workspace Clerk request context", () => {
  it("makes the installed Clerk SDK return the handshake to the HTTPS workspace behind an HTTP ALB", async () => {
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Synthetic handshake test forbids network access"));
    const request = attested();
    const before = await clerk.authenticateRequest(request, satellite);
    expect(new URL(new URL(before.headers.get("location")!).searchParams.get("redirect_url")!).origin)
      .toBe("http://app.vaettir.app");
    const normalized = await verifiedWorkspaceClerkRequest(request, true, secret);
    const state = await clerk.authenticateRequest(normalized, satellite);
    expect(state.status).toBe("handshake");
    const location = new URL(state.headers.get("location")!);
    expect(location.origin + location.pathname).toBe("https://clerk.vaettir.app/v1/client/handshake");
    expect(location.searchParams.get("redirect_url")).toBe("https://app.vaettir.app" + target);
    expect(request.headers.get("x-forwarded-proto")).toBe("http");
    expect(normalized.headers.get("x-forwarded-proto")).toBe("https");
    expect(network).not.toHaveBeenCalled();
  });
  it("rejects a forged or changed signed target before restoring trusted headers", async () => {
    const request = attested();
    request.headers.set("x-forwarded-host", "evil.test");
    const normalized = await verifiedWorkspaceClerkRequest(request, true, secret);
    expect(normalized.headers.get("x-forwarded-host")).toBe("app.vaettir.app");
    await expect(verifiedWorkspaceClerkRequest(new NextRequest("http://localhost:3000/other", {
      headers: request.headers,
    }), true, secret)).rejects.toThrow("Invalid workspace ingress");
    await expect(verifiedWorkspaceClerkRequest(request, true, undefined)).rejects.toThrow();
  });
  it("keeps legacy and disabled requests intact, and never transfers a POST body stream", async () => {
    const legacy = new NextRequest("http://localhost:3000/projects");
    expect(await verifiedWorkspaceClerkRequest(legacy, true, secret)).toBe(legacy);
    const disabled = attested();
    expect(await verifiedWorkspaceClerkRequest(disabled, false, secret)).toBe(disabled);
    const post = attested("POST", "synthetic request body");
    expect(await verifiedWorkspaceClerkRequest(post, true, secret)).toBe(post);
    expect(post.bodyUsed).toBe(false);
    expect(await post.text()).toBe("synthetic request body");
  });
});
