import { randomUUID, createHmac } from "node:crypto";
import { beforeAll, afterAll, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import { prisma, PrismaClient } from "@vaettir/db";
import { appRouter } from "../router.js";
import { confirmExistingWorkspaceDomain } from "./workspaceDomains.js";
import { registerWorkspaceIngress, requestWorkspaceOrganization, ingressMessage } from "./workspaceDomainIngress.js";
import { resolveLegacyWorkspaceLink } from "./workspaceLegacyLinks.js";
import { issueForgeConnectionRequest } from "./forgeConnectionRequest.js";
import { readSharedQuality } from "./atlassianQualitySharing.js";
import type { ForgeIdentity } from "./forgeInvocation.js";

const suffix = randomUUID().replaceAll("-", "").slice(0, 14);
const names = [`synthetic-${suffix}`, `other-${suffix}`, `race-${suffix}`];
const secret = "local-synthetic-ingress-secret-".repeat(3);
let tierId: string;
let owner: Awaited<ReturnType<typeof prisma.user.create>>;
let outsider: Awaited<ReturnType<typeof prisma.user.create>>;
let singleMember: Awaited<ReturnType<typeof prisma.user.create>>;
const organizations: string[] = [];
const projects: string[] = [];
let second: PrismaClient;
async function actor(userId: string, workspaceOrganizationId?: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { memberships: true } });
  return { prisma, user, authenticatedClerkSubject: user.clerkUserId, staff: null, workspaceOrganizationId };
}
beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL ?? "");
  const local = url.hostname === "127.0.0.1" && url.port === "55439" && url.pathname.startsWith("/vaettir_domain_test");
  const ci = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(url.hostname)
    && url.port === "5432" && url.pathname === "/vaettir_test";
  if (!local && !ci)
    throw new Error("Dedicated local synthetic database required");
  vi.stubEnv("VAETTIR_WORKSPACE_DOMAINS_ENABLED", "1");
  vi.stubEnv("VAETTIR_DOMAIN_INGRESS_SECRET", secret);
  second = new PrismaClient();
  const tier = await prisma.planTier.create({ data: { key: `domain-${suffix}`, name: "Synthetic domain", sortOrder: 999, minFullSeats: 0, maxFullSeats: 10, maxReadOnlySeats: 10, includedAiCreditsPerMonth: 0, monthlyPricePerSeatCents: 0 } });
  tierId = tier.id;
  owner = await prisma.user.create({ data: { clerkUserId: `owner-${suffix}`, email: `owner-${suffix}@example.test` } });
  outsider = await prisma.user.create({ data: { clerkUserId: `outsider-${suffix}`, email: `outsider-${suffix}@example.test` } });
  singleMember = await prisma.user.create({ data: { clerkUserId: `single-${suffix}`, email: `single-${suffix}@example.test` } });
  for (let i = 0; i < 3; i++) {
    const org = await prisma.organization.create({ data: { name: `Synthetic ${i}`, slug: `domain-${suffix}-${i}`, planTierId: tierId } });
    organizations.push(org.id);
    await prisma.membership.create({ data: { organizationId: org.id, userId: owner.id, role: "OWNER", seatType: "FULL" } });
    const project = await prisma.project.create({ data: { organizationId: org.id, name: "Synthetic project", slug: "synthetic" } });
    projects.push(project.id);
  }
  await prisma.membership.create({ data: { organizationId: organizations[0]!, userId: singleMember.id, role: "VIEWER", seatType: "READ_ONLY" } });
});
afterAll(async () => {
  vi.unstubAllEnvs();
  if (projects.length) await prisma.project.deleteMany({ where: { id: { in: projects } } });
  if (organizations.length) {
    await prisma.membership.deleteMany({ where: { organizationId: { in: organizations } } });
    await prisma.organization.deleteMany({ where: { id: { in: organizations } } });
  }
  if (owner) await prisma.user.deleteMany({ where: { id: { in: [owner.id, outsider.id, singleMember.id] } } });
  if (tierId) await prisma.planTier.delete({ where: { id: tierId } });
  await second?.$disconnect();
});
it("confirms once, safely replays the same name and rejects rename or direct SQL reassignment", async () => {
  const ctx = await actor(owner.id);
  const claim = await confirmExistingWorkspaceDomain(ctx, organizations[0]!, names[0]!);
  expect(claim.hostname).toBe(`${names[0]}.vaettir.app`);
  expect(await confirmExistingWorkspaceDomain(ctx, organizations[0]!, names[0]!)).toEqual(claim);
  await expect(confirmExistingWorkspaceDomain(ctx, organizations[0]!, names[1]!)).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(second.workspaceDomain.update({ where: { name: names[0] }, data: { name: names[1] } })).rejects.toThrow();
  await expect(second.workspaceDomain.delete({ where: { name: names[0] } })).rejects.toThrow();
  expect(await second.workspaceDomain.findUnique({ where: { organizationId: organizations[0] } })).toMatchObject({ name: names[0] });
});
it("uses database uniqueness for simultaneous claims from different API clients", async () => {
  const ctx = await actor(owner.id);
  const result = await Promise.allSettled([
    confirmExistingWorkspaceDomain(ctx, organizations[1]!, names[2]!),
    confirmExistingWorkspaceDomain({ ...ctx, prisma: second }, organizations[2]!, names[2]!),
  ]);
  expect(result.filter(x => x.status === "fulfilled")).toHaveLength(1);
  expect(result.filter(x => x.status === "rejected")).toHaveLength(1);
  expect(await prisma.workspaceDomain.count({ where: { name: names[2] } })).toBe(1);
});
it("refuses non-owner, stale identity, cross-host scope and missing permanent confirmation", async () => {
  await expect(confirmExistingWorkspaceDomain(await actor(outsider.id), organizations[1]!, names[1]!)).rejects.toMatchObject({ code: "FORBIDDEN" });
  const ctx = await actor(owner.id, organizations[0]);
  await expect(confirmExistingWorkspaceDomain(ctx, organizations[1]!, names[1]!)).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(confirmExistingWorkspaceDomain({ ...ctx, authenticatedClerkSubject: "stale" }, organizations[0]!, names[0]!)).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(appRouter.createCaller(ctx).organization.confirmDomain({ organizationId: organizations[0]!, name: names[0]!, confirmPermanentAddress: false as true })).rejects.toThrow();
  vi.stubEnv("VAETTIR_WORKSPACE_DOMAIN_ORGANIZATION_IDS", organizations[0]!);
  await expect(confirmExistingWorkspaceDomain(await actor(owner.id), organizations[1]!, names[1]!)).rejects.toMatchObject({ code: "FORBIDDEN" });
  vi.stubEnv("VAETTIR_WORKSPACE_DOMAIN_ORGANIZATION_IDS", "");
});
it("enforces the actual signed HTTP host for multi-org members, unknown hosts and public/staff surfaces", async () => {
  const server = Fastify();
  registerWorkspaceIngress(server, prisma);
  const user = (await actor(owner.id)).user;
  await server.register(fastifyTRPCPlugin, {
    prefix: "/trpc", trpcOptions: { router: appRouter, createContext: async ({ req }) => ({
      prisma, user, authenticatedClerkSubject: user.clerkUserId, staff: null,
      workspaceOrganizationId: requestWorkspaceOrganization(req),
    }) },
  });
  function headers(host: string, target: string) {
    const timestamp = String(Date.now());
    return { "x-vaettir-host": host, "x-vaettir-time": timestamp, "x-vaettir-signature": createHmac("sha256", secret).update(ingressMessage("GET", target, host, timestamp)).digest("hex") };
  }
  try {
    const target = "/trpc/organization.mine";
    const own = await server.inject({ url: target, headers: headers(`${names[0]}.vaettir.app`, target) });
    expect(own.statusCode).toBe(200);
    expect(own.json().result.data.map((o: { id: string }) => o.id)).toEqual([organizations[0]]);
    const other = `/trpc/project.byId?input=${encodeURIComponent(JSON.stringify({ id: projects[1] }))}`;
    expect((await server.inject({ url: other, headers: headers(`${names[0]}.vaettir.app`, other) })).statusCode).toBe(403);
    expect((await server.inject({ url: target, headers: headers(`unknown-${suffix}.vaettir.app`, target) })).statusCode).toBe(404);
    const staff = "/trpc/beta.list";
    expect((await server.inject({ url: staff, headers: headers(`${names[0]}.vaettir.app`, staff) })).statusCode).toBe(403);
    expect((await server.inject({ url: target, headers: { "x-forwarded-host": `${names[0]}.vaettir.app` } })).statusCode).toBe(403);
    expect(own.headers["cache-control"]).toBe("no-store");
    expect(own.headers["x-vaettir-workspace-verified"]).toBe("tenant-v1");
  } finally { await server.close(); }
});
it("routes legacy project links only to their authenticated, explicitly activated claim and drops sensitive query values", async () => {
  const ctx = await actor(owner.id);
  vi.stubEnv("VAETTIR_ACTIVE_WORKSPACE_NAMES", names[0]!);
  expect(await resolveLegacyWorkspaceLink(ctx, `/projects/${projects[0]}/reports?tab=readiness&token=private&request=private`))
    .toEqual({ url: `https://${names[0]}.vaettir.app/projects/${projects[0]}/reports?tab=readiness` });
  expect(await resolveLegacyWorkspaceLink(ctx, `/projects/${projects[1]}`)).toEqual({ url: null });
  expect(await resolveLegacyWorkspaceLink(ctx, "/projects")).toEqual({ url: null });
  expect(await resolveLegacyWorkspaceLink(await actor(singleMember.id), "/projects")).toEqual({ url: `https://${names[0]}.vaettir.app/projects` });
  expect(await resolveLegacyWorkspaceLink(ctx, "/integrations/atlassian/connect?request=private")).toEqual({ url: null });
  expect(await resolveLegacyWorkspaceLink(ctx, "https://evil.test/projects/x")).toEqual({ url: null });
  await expect(resolveLegacyWorkspaceLink(await actor(outsider.id), `/projects/${projects[0]}`)).rejects.toMatchObject({ code: "FORBIDDEN" });
});
it("binds native options, explicit connection, sharing settings and revocation to the signed customer host", async () => {
  const identity: ForgeIdentity = {
    appId: "ari:cloud:ecosystem::app/743bf96f-0f9f-4fed-981a-ea3fc318d15d",
    environmentId: "ari:cloud:ecosystem::environment/743bf96f-0f9f-4fed-981a-ea3fc318d15d/d2844601-7a1f-4e4e-9b77-e0d4d3682c50",
    installationId: "ari:cloud:ecosystem::installation/10000000-0000-4000-8000-000000000001",
    cloudId: "10000000-0000-4000-8000-000000000002", siteOrigin: "https://synthetic.atlassian.net",
    product: "jira", targetId: "10", principal: "synthetic-viewer", moduleKey: "vaettir-project-quality",
    apiBaseUrl: "https://api.atlassian.com/ex/jira/10000000-0000-4000-8000-000000000002",
  };
  vi.stubEnv("VAETTIR_FORGE_APP_ID", identity.appId);
  vi.stubEnv("VAETTIR_FORGE_ENVIRONMENT_ID", identity.environmentId);
  vi.stubEnv("PRODUCTION_SIGNAL_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
  vi.stubEnv("WEB_APP_URL", "https://vaettir.skaldandstone.com");
  const issued = issueForgeConnectionRequest(identity, "Synthetic native target");
  const setup = new URL(issued.connectionUrl);
  expect(setup.origin).toBe("https://vaettir.skaldandstone.com");
  expect(await resolveLegacyWorkspaceLink(await actor(owner.id), setup.pathname + setup.search)).toEqual({ url: null });
  const requestToken = setup.searchParams.get("request")!;
  const server = Fastify();
  registerWorkspaceIngress(server, prisma);
  const user = (await actor(owner.id)).user;
  await server.register(fastifyTRPCPlugin, { prefix: "/trpc", trpcOptions: {
    router: appRouter, createContext: async ({ req }) => ({
      prisma, user, authenticatedClerkSubject: user.clerkUserId, staff: null,
      workspaceOrganizationId: requestWorkspaceOrganization(req),
    }),
  } });
  const host = `${names[0]}.vaettir.app`;
  async function call(method: "GET" | "POST", procedure: string, input: unknown) {
    const payload = JSON.stringify(input);
    const target = `/trpc/atlassianQuality.${procedure}${method === "GET" ? `?input=${encodeURIComponent(payload)}` : ""}`;
    const timestamp = String(Date.now());
    return server.inject({ method, url: target, ...(method === "POST" ? { payload } : {}), headers: {
      "content-type": "application/json", origin: `https://${host}`,
      "x-vaettir-host": host, "x-vaettir-time": timestamp,
      "x-vaettir-signature": createHmac("sha256", secret).update(ingressMessage(method, target, host, timestamp)).digest("hex"),
    } });
  }
  const base = { requestToken, expectedClerkActorId: user.clerkUserId };
  const own = { organizationId: organizations[0]!, projectId: projects[0]! };
  const foreign = { organizationId: organizations[1]!, projectId: projects[1]! };
  try {
    const options = await call("POST", "connectionOptions", base);
    expect(options.statusCode).toBe(200);
    expect(options.json().result.data.organizations.map((o: { id: string }) => o.id)).toEqual([own.organizationId]);
    expect(options.json().result.data.projects.map((p: { id: string }) => p.id)).toEqual([own.projectId]);
    expect(options.body).not.toContain(foreign.organizationId);
    expect(options.body).not.toContain(requestToken);
    expect((await call("POST", "connectionOptions", { ...base, organizationId: foreign.organizationId })).statusCode).toBe(403);
    expect((await call("POST", "connectProject", { ...base, ...foreign, approveConnection: true })).statusCode).toBe(403);
    expect((await call("GET", "settings", foreign)).statusCode).toBe(403);
    expect((await call("POST", "connectProject", { ...base, ...own, approveConnection: false })).statusCode).toBe(400);
    const connected = await call("POST", "connectProject", { ...base, ...own, approveConnection: true });
    expect(connected.statusCode).toBe(200);
    const key = connected.json().result.data.connectionKey as string;
    expect((await call("GET", "settings", own)).json().result.data.connections).toHaveLength(1);
    await expect(prisma.$transaction(tx => readSharedQuality(tx, key, identity))).resolves.toMatchObject({ projectId: own.projectId });
    expect((await call("POST", "revoke", { ...foreign, id: key, requestId: randomUUID() })).statusCode).toBe(403);
    expect((await call("POST", "revoke", { ...own, id: key, requestId: randomUUID() })).statusCode).toBe(200);
    await expect(second.$transaction(tx => readSharedQuality(tx, key, identity))).rejects.toThrow("Sharing unavailable");
    expect((await call("POST", "connectProject", { ...base, ...own, approveConnection: true })).json().result.data.state).toBe("REVOKED");
    expect(await prisma.auditLog.count({ where: { organizationId: foreign.organizationId } })).toBe(0);
  } finally {
    await server.close();
    // These are disposable fixtures in the explicitly guarded local/CI database.
    await prisma.auditLog.deleteMany({ where: { organizationId: own.organizationId } });
  }
});
it("retains a retired name after organization erasure without preventing the erasure itself", async () => {
  const id = organizations[0]!;
  await prisma.project.deleteMany({ where: { organizationId: id } });
  await prisma.membership.deleteMany({ where: { organizationId: id } });
  await prisma.organization.delete({ where: { id } });
  expect(await second.workspaceDomain.findUnique({ where: { name: names[0] } })).toMatchObject({ organizationId: null });
  await expect(second.workspaceDomain.create({ data: { name: names[0]!, organizationId: organizations[1], claimedByUserId: owner.id } })).rejects.toThrow();
});
