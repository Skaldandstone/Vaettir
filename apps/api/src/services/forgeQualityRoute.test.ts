import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@vaettir/db";
import { readFileSync } from "node:fs";

const mocks = vi.hoisted(() => ({
  viewer: vi.fn(),
  event: vi.fn(),
  invocation: vi.fn(),
  version: vi.fn(),
  sharing: vi.fn(),
  snapshot: vi.fn(),
  ticket: vi.fn(),
  connections: vi.fn(),
  capture: vi.fn(),
  product: vi.fn(),
}));
vi.mock("./forgeInvocation.js", () => ({
  verifyForgeInvocation: mocks.invocation,
  verifyForgeViewer: mocks.viewer,
  verifyForgeEventInvocation: mocks.event,
  readForgeJiraVersion: mocks.version,
  productJson: mocks.product,
}));
vi.mock("./atlassianQualitySharing.js", async (original) => ({
  ...(await original<object>()),
  listForgeSharing: mocks.connections,
  readSharedQuality: mocks.snapshot,
  authorizeForgeSharing: mocks.sharing,
}));
vi.mock("./jiraTicketVerification.js", () => ({
  readJiraTicketVerification: mocks.ticket,
}));
vi.mock("./jiraReleaseEvidence.js", async (original) => ({
  ...(await original<object>()),
  releaseEventConnections: mocks.connections,
  captureJiraRelease: mocks.capture,
}));
import { registerForgeQualityRoute } from "./forgeQualityRoute.js";

const key = "forge-sharing-" + "a".repeat(64),
  headers = {
    authorization: "Bearer signed-fit",
    "x-forge-oauth-user": "ephemeral-user",
  };
const identity = {
  moduleKey: "vaettir-project-quality",
  product: "jira",
  targetId: "10",
};
function fixture() {
  const app = Fastify();
  const tx = {},
    prisma = {
      $transaction: vi.fn(async (work: (tx: object) => unknown) => work(tx)),
    };
  registerForgeQualityRoute(app, prisma as unknown as PrismaClient);
  return { app, prisma, tx };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("VAETTIR_FORGE_APP_ID", "company-app");
  vi.stubEnv("VAETTIR_FORGE_ENVIRONMENT_ID", "company-env");
  mocks.invocation.mockResolvedValue(identity);
  mocks.viewer.mockResolvedValue(identity);
  mocks.snapshot.mockResolvedValue({ protocol: "vaettir-quality/v1" });
  mocks.connections.mockResolvedValue([]);
});
afterEach(() => vi.unstubAllEnvs());
describe("Forge quality HTTP authorization boundary", () => {
  it("issues a direct opaque setup link only for the verified product destination, without a sharing write", async () => {
    const viewer = {
      ...identity,
      appId: "ari:cloud:ecosystem::app/743bf96f-0f9f-4fed-981a-ea3fc318d15d",
      environmentId: "ari:cloud:ecosystem::environment/743bf96f-0f9f-4fed-981a-ea3fc318d15d/d2844601-7a1f-4e4e-9b77-e0d4d3682c50",
      installationId: "ari:cloud:ecosystem::installation/10000000-0000-4000-8000-000000000001",
      cloudId: "10000000-0000-4000-8000-000000000002",
      siteOrigin: "https://company.atlassian.net", principal: "private-viewer",
      apiBaseUrl: "https://api.atlassian.com/ex/jira/10000000-0000-4000-8000-000000000002",
    };
    vi.stubEnv("VAETTIR_FORGE_APP_ID", viewer.appId);
    vi.stubEnv("VAETTIR_FORGE_ENVIRONMENT_ID", viewer.environmentId);
    vi.stubEnv("PRODUCTION_SIGNAL_ENCRYPTION_KEY", Buffer.alloc(32, 4).toString("base64"));
    vi.stubEnv("WEB_APP_URL", "https://vaettir.example.test");
    mocks.invocation.mockResolvedValue(viewer); mocks.viewer.mockResolvedValue(viewer);
    mocks.product.mockResolvedValue({ id: "10", key: "TEST", name: "Company demo" });
    const f = fixture(), send = (payload: object) => f.app.inject({ method: "POST", url: "/api/integrations/forge/quality", headers, payload });
    const response = await send({ action: "CONNECT" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store, private");
    const url = new URL(response.json().connectionUrl);
    expect(url.origin + url.pathname).toBe("https://vaettir.example.test/integrations/atlassian/connect");
    expect(response.json().targetLabel).toBe("Company demo (TEST)");
    expect(response.body).not.toMatch(/ephemeral-user|signed-fit|private-viewer|installationId|cloudId/);
    expect(mocks.product).toHaveBeenCalledWith(viewer.apiBaseUrl + "/rest/api/3/project/10", "ephemeral-user", expect.any(Function));
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
    expect((await send({ action: "CONNECT", redirect: "https://attacker.test" })).statusCode).toBe(400);
    mocks.product.mockResolvedValue({ id: "20", key: "OTHER", name: "Other destination" });
    expect((await send({ action: "CONNECT" })).statusCode).toBe(403);
    mocks.viewer.mockRejectedValue(new Error("No current project access"));
    mocks.product.mockClear();
    expect((await send({ action: "CONNECT" })).statusCode).toBe(403);
    expect(mocks.product).not.toHaveBeenCalled();
    await f.app.close();
  });
  it("returns setup identity after an empty LIST using Forge's canonical environment ARI", async () => {
    const binding = {
      appId: "ari:cloud:ecosystem::app/743bf96f-0f9f-4fed-981a-ea3fc318d15d",
      environmentId:
        "ari:cloud:ecosystem::environment/743bf96f-0f9f-4fed-981a-ea3fc318d15d/d2844601-7a1f-4e4e-9b77-e0d4d3682c50",
      installationId:
        "ari:cloud:ecosystem::installation/10000000-0000-4000-8000-000000000001",
      cloudId: "10000000-0000-4000-8000-000000000002",
      siteOrigin: "https://company.atlassian.net",
      product: "jira",
      targetId: "10",
    };
    const viewer = { ...identity, ...binding, principal: "synthetic-viewer" };
    vi.stubEnv("VAETTIR_FORGE_APP_ID", binding.appId);
    vi.stubEnv("VAETTIR_FORGE_ENVIRONMENT_ID", binding.environmentId);
    mocks.invocation.mockResolvedValue(viewer);
    mocks.viewer.mockResolvedValue(viewer);
    const f = fixture();
    for (const action of ["LIST", "IDENTITY"]) {
      const response = await f.app.inject({
        method: "POST",
        url: "/api/integrations/forge/quality",
        headers,
        payload: { action },
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toContain("application/json");
      expect(response.headers["cache-control"]).toBe("no-store, private");
      if (action === "IDENTITY") expect(response.json().binding).toEqual(binding);
    }
    expect(mocks.invocation).toHaveBeenCalledWith("signed-fit", binding.appId, binding.environmentId);
    expect(mocks.viewer).toHaveBeenCalledWith(viewer, "ephemeral-user");
    expect(f.prisma.$transaction).toHaveBeenCalledTimes(1);
    await f.app.close();
  });
  it("mounts JSON routes outside raw Stripe byte parsing and outside the duplicated /api alias", () => {
    const source = readFileSync(
      new URL("../serverApplication.ts", import.meta.url),
      "utf8",
    );
    const stripe = source.slice(
      source.indexOf("async function registerStripeWebhookRoute"),
      source.indexOf("async function registerPagerDutyWebhookRoute"),
    );
    expect(stripe).not.toContain("registerForgeQualityRoute(");
    expect(
      source.match(/registerForgeQualityRoute\(instance, prisma\)/g),
    ).toHaveLength(1);
  });
  it("fails closed when disabled, tokens are missing, context is forged or the body injects tenant authority", async () => {
    const f = fixture();
    const request = (body: object, token = headers) =>
      f.app.inject({
        method: "POST",
        url: "/api/integrations/forge/quality",
        headers: token,
        payload: body,
      });
    expect(
      (
        await request({
          action: "READ",
          connectionKey: key,
          organizationId: "foreign",
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await request({ action: "LIST" }, {} as typeof headers)).statusCode,
    ).toBe(401);
    expect(mocks.invocation).not.toHaveBeenCalled();
    mocks.invocation.mockRejectedValue(
      new Error("private provider response must not leak"),
    );
    const denied = await request({ action: "LIST" });
    expect(denied.statusCode).toBe(403);
    expect(denied.body).not.toContain("private provider");
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
    vi.stubEnv("VAETTIR_FORGE_ENVIRONMENT_ID", "");
    expect((await request({ action: "LIST" })).statusCode).toBe(503);
    await f.app.close();
  });
  it("dispatches issue-specific results only after current viewer verification and never writes from a UI read", async () => {
    const f = fixture();
    const issue = {
      ...identity,
      moduleKey: "vaettir-issue-quality",
      issueKey: "TEST-2",
      resourceId: "20",
    };
    mocks.viewer.mockResolvedValue(issue);
    mocks.ticket.mockResolvedValue({
      protocol: "vaettir-ticket-verification/v1",
      tests: [],
    });
    const result = await f.app.inject({
      method: "POST",
      url: "/api/integrations/forge/quality",
      headers,
      payload: { action: "READ", connectionKey: key },
    });
    expect(result.statusCode).toBe(200);
    expect(result.headers["cache-control"]).toContain("no-store");
    expect(mocks.ticket).toHaveBeenCalledWith(f.tx, key, issue);
    expect(mocks.snapshot).not.toHaveBeenCalled();
    expect(mocks.capture).not.toHaveBeenCalled();
    await f.app.close();
  });
  it("accepts only the backend release event protocol and returns retryable failure for an unconfirmed capture", async () => {
    const f = fixture(),
      payload = {
        eventType: "avi:jira:released:version",
        versionId: "45",
        observedAt: "2026-10-16T00:00:00.000Z",
      },
      systemHeaders = {
        authorization: "Bearer signed-backend-fit",
        "x-forge-oauth-system": "ephemeral-system",
      };
    expect(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/integrations/forge/release-event",
          headers,
          payload,
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/integrations/forge/release-event",
          headers: systemHeaders,
          payload: { ...payload, eventType: "avi:jira:archived:version" },
        })
      ).statusCode,
    ).toBe(400);
    mocks.event.mockResolvedValue(identity);
    mocks.version.mockResolvedValue({
      id: "45",
      projectId: 10,
      released: true,
    });
    mocks.connections.mockResolvedValue([{ key, identity }]);
    mocks.capture.mockRejectedValue(new Error("private case content"));
    const failure = await f.app.inject({
      method: "POST",
      url: "/api/integrations/forge/release-event",
      headers: systemHeaders,
      payload,
    });
    expect(failure.statusCode).toBe(503);
    expect(failure.body).not.toContain("private case");
    mocks.capture.mockResolvedValue({ captured: true });
    const accepted = await f.app.inject({
      method: "POST",
      url: "/api/integrations/forge/release-event",
      headers: systemHeaders,
      payload,
    });
    expect(accepted.json()).toEqual({ captured: 1 });
    mocks.version.mockResolvedValue({
      id: "45",
      projectId: 10,
      released: false,
    });
    mocks.capture.mockClear();
    expect(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/integrations/forge/release-event",
          headers: systemHeaders,
          payload,
        })
      ).statusCode,
    ).toBe(200);
    expect(mocks.capture).not.toHaveBeenCalled();
    await f.app.close();
  });
});
