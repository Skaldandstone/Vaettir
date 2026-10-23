import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type CryptoKey,
} from "jose";
import {
  verifyForgeInvocation,
  verifyForgeViewer,
  verifyForgeEventInvocation,
  readForgeJiraVersion,
} from "./forgeInvocation.js";

const appId = "ari:cloud:ecosystem::app/743bf96f-0f9f-4fed-981a-ea3fc318d15d",
  environmentId =
    "ari:cloud:ecosystem::environment/d2844601-7a1f-4e4e-9b77-e0d4d3682c50",
  cloudId = "10000000-0000-4000-8000-000000000001";
let privateKey: CryptoKey, keys: ReturnType<typeof createLocalJWKSet>;
beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  keys = createLocalJWKSet({
    keys: [
      { ...(await exportJWK(pair.publicKey)), kid: "test-key", alg: "RS256" },
    ],
  });
});
const claims = () => ({
  app: {
    id: appId,
    installationId:
      "ari:cloud:ecosystem::installation/10000000-0000-4000-8000-000000000002",
    apiBaseUrl: `https://api.atlassian.com/ex/jira/${cloudId}`,
    environment: { id: environmentId, type: "DEVELOPMENT" },
  },
  context: {
    cloudId,
    siteUrl: "https://company.atlassian.net",
    moduleKey: "vaettir-issue-quality",
    extension: { project: { id: "10" }, issue: { id: "20" } },
  },
  principal: "company-user",
});
async function token(value: Record<string, unknown>, expiration = "2m") {
  return new SignJWT(value)
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer("forge/invocation-token")
    .setAudience(appId)
    .setIssuedAt()
    .setExpirationTime(expiration)
    .sign(privateKey);
}
describe("company app Forge invocation boundary", () => {
  it("separates background release consumers from signed UI callers and verifies the exact Jira version", async () => {
    await expect(
      verifyForgeEventInvocation(
        await token(claims()),
        appId,
        environmentId,
        keys,
      ),
    ).rejects.toThrow();
    const ui = claims();
    const event = {
      ...ui,
      app: {
        ...ui.app,
        module: { key: "capture-release", type: "core:function" },
      },
      context: { cloudId },
    };
    const identity = await verifyForgeEventInvocation(
      await token(event),
      appId,
      environmentId,
      keys,
    );
    expect(identity.cloudId).toBe(cloudId);
    await expect(
      verifyForgeInvocation(await token(event), appId, environmentId, keys),
    ).rejects.toThrow();
    await expect(
      verifyForgeEventInvocation(
        await token({ ...event, icLabel: "orange" }),
        appId,
        environmentId,
        keys,
      ),
    ).rejects.toThrow();
    const transport = vi.fn<typeof fetch>(async () =>
      Response.json({
        id: "45",
        projectId: 10,
        name: "v1",
        released: true,
        archived: false,
      }),
    );
    expect(
      (await readForgeJiraVersion(identity, "ephemeral", "45", transport))
        .released,
    ).toBe(true);
    expect(transport.mock.calls[0]?.[0]).toBe(
      `${identity.apiBaseUrl}/rest/api/3/version/45`,
    );
    await expect(
      readForgeJiraVersion(identity, "ephemeral", "46", transport),
    ).rejects.toThrow();
    await expect(
      readForgeJiraVersion(identity, "ephemeral", "../evil", transport),
    ).rejects.toThrow();
  });
  it("requires the signed company app, exact environment, tenant and issue context", async () => {
    const identity = await verifyForgeInvocation(
      await token(claims()),
      appId,
      environmentId,
      keys,
    );
    expect(identity).toMatchObject({
      appId,
      environmentId,
      cloudId,
      product: "jira",
      targetId: "10",
      resourceId: "20",
      siteOrigin: "https://company.atlassian.net",
    });
    const data = claims();
    data.app.environment.id = "other";
    await expect(
      verifyForgeInvocation(await token(data), appId, environmentId, keys),
    ).rejects.toThrow();
    await expect(
      verifyForgeInvocation(
        await token(claims()),
        "wrong-app",
        environmentId,
        keys,
      ),
    ).rejects.toThrow();
    await expect(
      verifyForgeInvocation(
        await token(claims(), "-1m"),
        appId,
        environmentId,
        keys,
      ),
    ).rejects.toThrow();
    const signed = await token(claims()),
      parts = signed.split(".");
    parts[1] = Buffer.from(
      JSON.stringify({ ...claims(), principal: "attacker" }),
    ).toString("base64url");
    await expect(
      verifyForgeInvocation(parts.join("."), appId, environmentId, keys),
    ).rejects.toThrow();
  });
  it("rejects caller-controlled API destinations, missing resource context and isolated clouds", async () => {
    const data = claims();
    data.app.apiBaseUrl = "https://evil.example/ex/jira/tenant";
    await expect(
      verifyForgeInvocation(await token(data), appId, environmentId, keys),
    ).rejects.toThrow();
    const missing = claims();
    missing.context.extension.issue.id = "";
    await expect(
      verifyForgeInvocation(await token(missing), appId, environmentId, keys),
    ).rejects.toThrow();
    await expect(
      verifyForgeInvocation(
        await token({ ...claims(), icLabel: "orange" }),
        appId,
        environmentId,
        keys,
      ),
    ).rejects.toThrow();
  });
  it("uses only a short-lived user token and independently verifies ticket visibility and project", async () => {
    const identity = await verifyForgeInvocation(
      await token(claims()),
      appId,
      environmentId,
      keys,
    );
    const transport = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          permissions: { BROWSE_PROJECTS: { havePermission: true } },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          id: "20",
          key: "APP-2",
          fields: { project: { id: "10" } },
        }),
      );
    expect(
      await verifyForgeViewer(identity, "synthetic-user-token", transport),
    ).toMatchObject({ issueKey: "APP-2" });
    expect(transport).toHaveBeenCalledTimes(2);
    for (const call of transport.mock.calls) {
      expect(call[0]).toMatch(
        new RegExp(`^https://api.atlassian.com/ex/jira/${cloudId}/`),
      );
      expect(call[1]).toMatchObject({
        redirect: "error",
        headers: { Authorization: "Bearer synthetic-user-token" },
      });
    }
    await expect(verifyForgeViewer(identity, "", transport)).rejects.toThrow();
    await expect(
      verifyForgeViewer(
        identity,
        "synthetic",
        vi.fn(async () =>
          Response.json({
            permissions: { BROWSE_PROJECTS: { havePermission: false } },
          }),
        ),
      ),
    ).rejects.toThrow();
  });
  it("checks actual Confluence page-space membership, not a Jira grant or supplied space id", async () => {
    const data = claims();
    data.context.moduleKey = "vaettir-release-quality";
    data.app.apiBaseUrl = `https://api.atlassian.com/ex/confluence/${cloudId}`;
    Object.assign(data.context.extension, {
      space: { id: "30" },
      content: { id: "40" },
    });
    const identity = await verifyForgeInvocation(
      await token(data),
      appId,
      environmentId,
      keys,
    );
    expect(identity.product).toBe("confluence");
    await expect(
      verifyForgeViewer(
        identity,
        "synthetic",
        vi.fn(async () =>
          Response.json({ id: "40", spaceId: "31", status: "current" }),
        ),
      ),
    ).rejects.toThrow();
    await expect(
      verifyForgeViewer(
        identity,
        "synthetic",
        vi.fn(async () =>
          Response.json({ id: "40", spaceId: "30", status: "current" }),
        ),
      ),
    ).resolves.toMatchObject({ targetId: "30" });
  });
});
