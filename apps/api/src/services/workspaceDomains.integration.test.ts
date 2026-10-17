import { randomUUID, createHmac } from "node:crypto";
import { beforeAll, afterAll, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import { prisma, PrismaClient } from "@vaettir/db";
import { appRouter } from "../router.js";
import { confirmExistingWorkspaceDomain } from "./workspaceDomains.js";
import { registerWorkspaceIngress, requestWorkspaceOrganization, ingressMessage } from "./workspaceDomainIngress.js";
import { resolveLegacyWorkspaceLink } from "./workspaceLegacyLinks.js";

const suffix = randomUUID().replaceAll("-", "").slice(0, 14);
const names = [`synthetic-${suffix}`, `other-${suffix}`, `race-${suffix}`];
const secret = "local-synthetic-ingress-secret-".repeat(3);
let tierId: string;
let owner: Awaited<ReturnType<typeof prisma.user.create>>;
let outsider: Awaited<ReturnType<typeof prisma.user.create>>;
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
  for (let i = 0; i < 3; i++) {
    const org = await prisma.organization.create({ data: { name: `Synthetic ${i}`, slug: `domain-${suffix}-${i}`, planTierId: tierId } });
    organizations.push(org.id);
    await prisma.membership.create({ data: { organizationId: org.id, userId: owner.id, role: "OWNER", seatType: "FULL" } });
    const project = await prisma.project.create({ data: { organizationId: org.id, name: "Synthetic project", slug: "synthetic" } });
    projects.push(project.id);
  }
});
afterAll(async () => {
  vi.unstubAllEnvs();
  if (projects.length) await prisma.project.deleteMany({ where: { id: { in: projects } } });
  if (organizations.length) {
    await prisma.membership.deleteMany({ where: { organizationId: { in: organizations } } });
    await prisma.organization.deleteMany({ where: { id: { in: organizations } } });
  }
  if (owner) await prisma.user.deleteMany({ where: { id: { in: [owner.id, outsider.id] } } });
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
  expect(await resolveLegacyWorkspaceLink(ctx, "/integrations/atlassian/connect?request=private")).toEqual({ url: null });
  expect(await resolveLegacyWorkspaceLink(ctx, "https://evil.test/projects/x")).toEqual({ url: null });
  await expect(resolveLegacyWorkspaceLink(await actor(outsider.id), `/projects/${projects[0]}`)).rejects.toMatchObject({ code: "FORBIDDEN" });
});
it("retains a retired name after organization erasure without preventing the erasure itself", async () => {
  const id = organizations[0]!;
  await prisma.project.deleteMany({ where: { organizationId: id } });
  await prisma.membership.deleteMany({ where: { organizationId: id } });
  await prisma.organization.delete({ where: { id } });
  expect(await second.workspaceDomain.findUnique({ where: { name: names[0] } })).toMatchObject({ organizationId: null });
  await expect(second.workspaceDomain.create({ data: { name: names[0]!, organizationId: organizations[1], claimedByUserId: owner.id } })).rejects.toThrow();
});
