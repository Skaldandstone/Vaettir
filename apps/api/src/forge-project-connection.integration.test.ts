import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, type Prisma } from "@vaettir/db";
import { atlassianQualityRouter } from "./routers/atlassianQuality.js";
import { assertOwnedTestDatabase } from "./testOnlyDatabaseSafety.js";
import { hardDeleteOrganization } from "./services/orgHardDelete.js";
import { issueForgeConnectionRequest, forgeConnectionDigest } from "./services/forgeConnectionRequest.js";
import { readSharedQuality } from "./services/atlassianQualitySharing.js";
import type { ForgeIdentity } from "./services/forgeInvocation.js";

const identity: ForgeIdentity = {
  appId: "ari:cloud:ecosystem::app/743bf96f-0f9f-4fed-981a-ea3fc318d15d",
  environmentId: "ari:cloud:ecosystem::environment/743bf96f-0f9f-4fed-981a-ea3fc318d15d/d2844601-7a1f-4e4e-9b77-e0d4d3682c50",
  installationId: "ari:cloud:ecosystem::installation/10000000-0000-4000-8000-000000000001",
  cloudId: "10000000-0000-4000-8000-000000000002", siteOrigin: "https://synthetic.atlassian.net",
  product: "jira", targetId: "10", principal: "synthetic-viewer", moduleKey: "vaettir-project-quality",
  apiBaseUrl: "https://api.atlassian.com/ex/jira/10000000-0000-4000-8000-000000000002",
};
describe("durable native project connection on owned PostgreSQL", () => {
  const tag = `forge-connect-${randomUUID()}`;
  let orgId: string, projects: string[];
  let user: Prisma.UserGetPayload<{ include: { memberships: true } }>;
  let caller: ReturnType<typeof atlassianQualityRouter.createCaller>;
  beforeAll(async () => {
    assertOwnedTestDatabase(process.env.DATABASE_URL);
    const tier = await prisma.planTier.findUniqueOrThrow({ where: { key: "free" } });
    const org = await prisma.organization.create({ data: { slug: tag, name: tag, planTierId: tier.id } });
    orgId = org.id;
    user = await prisma.user.create({ data: { email: `${tag}@example.invalid`, clerkUserId: tag,
      memberships: { create: { organizationId: orgId, role: "OWNER", seatType: "FULL" } } }, include: { memberships: true } });
    projects = await Promise.all(["one", "two"].map(async slug => (await prisma.project.create({ data: { organizationId: orgId, name: `${tag}-${slug}`, slug } })).id));
    caller = atlassianQualityRouter.createCaller({ prisma, user, authenticatedClerkSubject: tag });
  });
  beforeEach(() => {
    vi.stubEnv("VAETTIR_FORGE_APP_ID", identity.appId); vi.stubEnv("VAETTIR_FORGE_ENVIRONMENT_ID", identity.environmentId);
    vi.stubEnv("PRODUCTION_SIGNAL_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
    vi.stubEnv("WEB_APP_URL", "https://vaettir.example.test");
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    if (!orgId || !user) return;
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
    if (org.slug !== tag) throw new Error("Owned Forge fixture mismatch");
    await hardDeleteOrganization(prisma, orgId, user.id, "Owned Forge connection fixture teardown");
  });
  function input(projectId = projects[0]!) {
    const issued = issueForgeConnectionRequest(identity, "Synthetic Jira project (TEST)");
    return { requestToken: new URL(issued.connectionUrl).searchParams.get("request")!, expectedClerkActorId: tag,
      organizationId: orgId, projectId, approveConnection: true as const };
  }
  it("serializes simultaneous identical saves and refuses a competing project for the consumed nonce", async () => {
    const value = input();
    const replies = await Promise.all([caller.connectProject(value), caller.connectProject(value)]);
    expect(replies[0]).toEqual(replies[1]);
    expect(await prisma.auditLog.count({ where: { organizationId: orgId, entityId: replies[0]!.connectionKey } })).toBe(1);
    await expect(caller.connectProject({ ...value, projectId: projects[1]! })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await prisma.auditLog.count({ where: { organizationId: orgId, projectId: projects[1], entityType: "ForgeConnectionRequest" } })).toBe(0);
  });
  it("races two project choices without granting both, and a revoked winner stays revoked on replay", async () => {
    const value = input(), results = await Promise.allSettled([caller.connectProject(value), caller.connectProject({ ...value, projectId: projects[1]! })]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(r => r.status === "rejected")).toHaveLength(1);
    const winner = results.find(r => r.status === "fulfilled") as PromiseFulfilledResult<Awaited<ReturnType<typeof caller.connectProject>>>;
    await caller.revoke({ projectId: winner.value.projectId, organizationId: orgId, id: winner.value.connectionKey, requestId: randomUUID() });
    expect((await caller.connectProject({ ...value, projectId: winner.value.projectId })).state).toBe("REVOKED");
  });
  it("refuses fresh writes when native Clerk mapping or current administrator access changed", async () => {
    const value = input();
    try {
      await prisma.user.update({ where: { id: user.id }, data: { clerkUserId: tag + "-remapped" } });
      await expect(caller.connectProject(value)).rejects.toMatchObject({ code: "FORBIDDEN" });
    } finally { await prisma.user.update({ where: { id: user.id }, data: { clerkUserId: tag } }); }
    try {
      await prisma.membership.update({ where: { organizationId_userId: { organizationId: orgId, userId: user.id } }, data: { role: "VIEWER" } });
      await expect(caller.connectProject(value)).rejects.toMatchObject({ code: "FORBIDDEN" });
    } finally { await prisma.membership.update({ where: { organizationId_userId: { organizationId: orgId, userId: user.id } }, data: { role: "OWNER" } }); }
    expect(await prisma.auditLog.count({ where: { organizationId: orgId, entityType: "ForgeConnectionRequest", metadata: { path: ["requestDigest"], equals: forgeConnectionDigest(value.requestToken) } } })).toBe(0);
  });
  it("continues to the newest approved capture while excluding drafts and another project's captures", async () => {
    const connected = await caller.connectProject(input());
    const read = (id?: string) => prisma.$transaction(tx => readSharedQuality(tx, connected.connectionKey, identity, id));
    expect((await read()).protocol).toBe("vaettir-quality-empty/v1");
    const ids = ["approved", "draft", "foreign"].map(() => forgeConnectionDigest(randomUUID()));
    const payload = { state: "approved", title: "Synthetic approved quality", projectName: tag,
      asOf: "2026-10-16T00:00:00.000Z", windowStart: "2026-10-15T00:00:00.000Z",
      execution: { runs: 0, results: 0, outcomes: [], distinctCases: 0 }, inventory: { active: 0 }, limitations: [], architectureMappings: [{ private: true }] };
    for (let index = 0; index < 3; index++) await prisma.projectReportSnapshot.create({ data: {
      id: ids[index]!, projectId: projects[index === 2 ? 1 : 0]!, organizationId: orgId, createdById: user.id,
      inputHash: ids[index]!, title: payload.title, asOf: new Date(Date.parse(payload.asOf) + index * 1000),
      payload: { ...payload, state: index === 1 ? "preview" : "approved" },
    } });
    const result = await read();
    expect(result.protocol).toBe("vaettir-quality/v1");
    if (result.protocol !== "vaettir-quality/v1") throw new Error("Expected approved snapshot");
    expect(result.snapshot.id).toBe(ids[0]); expect(result.available).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("architectureMappings");
    await expect(read(ids[1])).rejects.toThrow(); await expect(read(ids[2])).rejects.toThrow();
  });
});
