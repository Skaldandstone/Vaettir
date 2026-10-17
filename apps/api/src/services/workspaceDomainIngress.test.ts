import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ingressMessage, verifyWorkspaceIngress } from "./workspaceDomainIngress.js";
import { workspaceNameError } from "@vaettir/core";

const secret = "synthetic-ingress-fixture-".repeat(4);
const now = 1792200000000;
function signed(host = "synthetic-team.vaettir.app", target = "/api/trpc/organization.mine") {
  const timestamp = String(now);
  return { "x-vaettir-host": host, "x-vaettir-time": timestamp,
    "x-vaettir-signature": createHmac("sha256", secret).update(ingressMessage("GET", target, host, timestamp)).digest("hex") };
}
afterEach(() => vi.unstubAllEnvs());
describe("workspace ingress attestation", () => {
  it("requires deployment opt-in, exact signed host, method, target and time", () => {
    vi.stubEnv("VAETTIR_WORKSPACE_DOMAINS_ENABLED", "1");
    const headers = signed();
    expect(verifyWorkspaceIngress(headers, "GET", "/trpc/organization.mine", secret, now)).toBe("synthetic-team.vaettir.app");
    expect(() => verifyWorkspaceIngress({ ...headers, "x-vaettir-host": "other-team.vaettir.app" }, "GET", "/trpc/organization.mine", secret, now)).toThrow();
    expect(() => verifyWorkspaceIngress(headers, "POST", "/trpc/organization.mine", secret, now)).toThrow();
    expect(() => verifyWorkspaceIngress(headers, "GET", "/trpc/organization.byId", secret, now)).toThrow();
    expect(() => verifyWorkspaceIngress(headers, "GET", "/trpc/organization.mine", secret, now + 31_000)).toThrow();
    expect(() => verifyWorkspaceIngress(headers, "GET", "/trpc/organization.mine", undefined, now)).toThrow();
    vi.stubEnv("VAETTIR_WORKSPACE_DOMAINS_ENABLED", "0");
    expect(() => verifyWorkspaceIngress(headers, "GET", "/trpc/organization.mine", secret, now)).toThrow();
  });
  it("rejects spoofed forwarding and malformed or reserved hostnames", () => {
    vi.stubEnv("VAETTIR_WORKSPACE_DOMAINS_ENABLED", "1");
    expect(verifyWorkspaceIngress({}, "GET", "/health", secret, now)).toBeNull();
    expect(() => verifyWorkspaceIngress({ "x-forwarded-host": "synthetic-team.vaettir.app" }, "GET", "/health", secret, now)).toThrow();
    for (const host of ["a.b.vaettir.app", "www.vaettir.app", "team.vaettir.app.evil.test", "TEAM.vaettir.app"]) {
      expect(() => verifyWorkspaceIngress(signed(host), "GET", "/trpc/organization.mine", secret, now)).toThrow();
    }
    expect(verifyWorkspaceIngress(signed("app.vaettir.app"), "GET", "/trpc/organization.mine", secret, now)).toBe("app.vaettir.app");
  });
  it("rejects ambiguous labels and reserves service names", () => {
    for (const name of ["api", "admin", "www", "clerk", "x.y", "xn--team", "-team", "team-", "42team", "a".repeat(64)])
      expect(workspaceNameError(name)).toBeTruthy();
    expect(workspaceNameError("Synthetic-Team")).toBeNull();
  });
});
