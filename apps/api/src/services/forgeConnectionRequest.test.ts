import { describe, expect, it } from "vitest";
import { forgeConnectionLifetimeMs, issueForgeConnectionRequest, readForgeConnectionRequest } from "./forgeConnectionRequest.js";
import type { ForgeIdentity } from "./forgeInvocation.js";
const identity: ForgeIdentity = {
  appId: "ari:cloud:ecosystem::app/743bf96f-0f9f-4fed-981a-ea3fc318d15d",
  environmentId: "ari:cloud:ecosystem::environment/743bf96f-0f9f-4fed-981a-ea3fc318d15d/d2844601-7a1f-4e4e-9b77-e0d4d3682c50",
  installationId: "ari:cloud:ecosystem::installation/10000000-0000-4000-8000-000000000001",
  cloudId: "10000000-0000-4000-8000-000000000002", siteOrigin: "https://company.atlassian.net", product: "jira", targetId: "10",
  principal: "private-atlassian-principal-not-forwarded", moduleKey: "vaettir-project-quality", apiBaseUrl: "https://api.atlassian.com/ex/jira/10000000-0000-4000-8000-000000000002",
};
const env = { VAETTIR_FORGE_APP_ID: identity.appId, VAETTIR_FORGE_ENVIRONMENT_ID: identity.environmentId,
  PRODUCTION_SIGNAL_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"), WEB_APP_URL: "https://vaettir.example.test" };
const now = 1700000000000;
const issue = (configured = env) => issueForgeConnectionRequest(identity, "Company project (TEST)", configured, now);
const token = (url: string) => new URL(url).searchParams.get("request")!;
describe("verified native project connection handoffs", () => {
  it("opens the actual protected setup route with unique authenticated opaque state, no caller-controlled redirect or bearer token", () => {
    const a = issue(), b = issue(), url = new URL(a.connectionUrl), raw = token(a.connectionUrl);
    expect(url.origin).toBe(env.WEB_APP_URL); expect(url.pathname).toBe("/integrations/atlassian/connect");
    expect(url.searchParams.size).toBe(1); expect(a.connectionUrl).not.toContain(identity.principal);
    expect(a.connectionUrl).not.toContain(identity.siteOrigin); expect(token(b.connectionUrl)).not.toBe(raw);
    const decoded = readForgeConnectionRequest(raw, env, now);
    expect(decoded.binding.targetId).toBe("10"); expect(decoded.binding.environmentId).toBe(identity.environmentId);
    expect(decoded).not.toHaveProperty("principal"); expect(decoded).not.toHaveProperty("userToken");
    expect(decoded.expiresAt - decoded.issuedAt).toBe(forgeConnectionLifetimeMs);
  });
  it("rejects tampering, expiration, clock rollback, key rotation, wrong app/environment and noncanonical encoding", () => {
    const raw = token(issue().connectionUrl), bytes = Buffer.from(raw, "base64url"); bytes[bytes.length - 2] ^= 1;
    expect(() => readForgeConnectionRequest(bytes.toString("base64url"), env, now)).toThrow();
    expect(() => readForgeConnectionRequest(raw, env, now + forgeConnectionLifetimeMs)).toThrow();
    expect(() => readForgeConnectionRequest(raw, env, now - 1)).toThrow();
    expect(() => readForgeConnectionRequest(raw, { ...env, PRODUCTION_SIGNAL_ENCRYPTION_KEY: Buffer.alloc(32, 8).toString("base64") }, now)).toThrow();
    expect(() => readForgeConnectionRequest(raw, { ...env, VAETTIR_FORGE_ENVIRONMENT_ID: "another" }, now)).toThrow();
    expect(() => readForgeConnectionRequest(raw + "=", env, now)).toThrow();
  });
  it("fails closed without deployment encryption, matching application identity or a trustworthy web origin", () => {
    for (const origin of ["http://vaettir.example.test", "https://vaettir.example.test/untrusted", "https://user:password@vaettir.example.test", "https://vaettir.example.test/?redirect=https://evil.test"])
      expect(() => issue({ ...env, WEB_APP_URL: origin })).toThrow();
    expect(() => issue({ ...env, PRODUCTION_SIGNAL_ENCRYPTION_KEY: "" })).toThrow();
    expect(() => issue({ ...env, VAETTIR_FORGE_APP_ID: "another" })).toThrow();
  });
});
