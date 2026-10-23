// SOURCE ONLY. Authored for an owned migrated loopback test database; NOT RUN tonight.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@vaettir/db";
import { qualityRiskOverviewRouter } from "./routers/qualityRiskOverview.js";
import { qualityRisksRouter } from "./routers/qualityRisks.js";
import { hardDeleteOrganization } from "./services/orgHardDelete.js";

describe("risk overview original actor and live read authorization", () => {
  const prefix = `overview-actor-${randomUUID()}`, clerkOwner = `${prefix}-owner`, clerkViewer = `${prefix}-viewer`;
  const organizations: string[] = [], users: string[] = [];
  let projectId: string, ownerId: string, viewerId: string, riskId: string;
  let owner: ReturnType<typeof qualityRiskOverviewRouter.createCaller>, viewer: typeof owner;
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
    if (!["localhost", "127.0.0.1"].includes(url.hostname) || !/test/i.test(url.pathname) || url.searchParams.has("host")) throw Error("Owned disposable loopback test database required");
    const tier = await prisma.planTier.findUniqueOrThrow({ where: { key: "free" } });
    for (let i = 0; i < 2; i++) organizations.push((await prisma.organization.create({ data: { name: `${prefix}-${i}`, slug: `${prefix}-${i}`, planTierId: tier.id } })).id);
    const ownerUser = await prisma.user.create({ data: { email: `${prefix}-owner@example.com`, clerkUserId: clerkOwner,
      memberships: { create: organizations.map(organizationId => ({ organizationId, role: "OWNER" as const, seatType: "FULL" as const })) } }, include: { memberships: true } });
    ownerId = ownerUser.id; users.push(ownerId); owner = qualityRiskOverviewRouter.createCaller({ prisma, user: ownerUser });
    const viewerUser = await prisma.user.create({ data: { email: `${prefix}-viewer@example.com`, clerkUserId: clerkViewer,
      memberships: { create: { organizationId: organizations[0]!, role: "VIEWER", seatType: "READ_ONLY" } } }, include: { memberships: true } });
    viewerId = viewerUser.id; users.push(viewerId); viewer = qualityRiskOverviewRouter.createCaller({ prisma, user: viewerUser });
    projectId = (await prisma.project.create({ data: { organizationId: organizations[0]!, name: "Synthetic actor overview", slug: `${prefix}-project`, caseKey: "ovact" } })).id;
    const writer = qualityRisksRouter.createCaller({ prisma, user: ownerUser });
    riskId = (await writer.write({ operation: "CREATE", projectId, requestId: randomUUID(), definition: {
      title: "Synthetic actor-bound risk", component: "Synthetic component", failureMode: "Synthetic failure", cause: "Synthetic cause", effect: "Synthetic effect",
      likelihood: "UNKNOWN", consequence: "UNKNOWN", rationale: "Synthetic private rationale", mitigation: "", requirementIds: [], caseIds: [] } })).entry.id;
  });
  afterAll(async () => {
    if (!ownerId) return;
    for (const id of organizations) {
      const row = await prisma.organization.findUnique({ where: { id }, select: { slug: true } });
      if (!row?.slug.startsWith(prefix)) throw Error("Owned fixture identity mismatch");
      await hardDeleteOrganization(prisma, id, ownerId, "Owned synthetic overview actor erasure");
    }
    await prisma.organizationDeletionLog.deleteMany({ where: { organizationId: { in: organizations }, deletedById: { in: users } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
  });
  const input = () => ({ projectId, originalOrganizationId: organizations[0]! });
  it("legacy omitted actor and scoped Viewer both retain ordinary read-only count semantics", async () => {
    const old = await viewer.summary(input()), scoped = await viewer.summary({ ...input(), expectedClerkActorId: clerkViewer });
    expect(old).toMatchObject({ projectId, organizationId: organizations[0], actorClerkUserId: clerkViewer });
    expect(scoped.population).toEqual(old.population); expect(scoped.filtered).toEqual(old.filtered);
    expect(old.population.entries).toBe(1); expect(old.population.likelihood.UNKNOWN).toBe(1);
    expect(await viewer.byId({ ...input(), id: riskId, expectedClerkActorId: clerkViewer })).toMatchObject({ projectId, organizationId: organizations[0], actorClerkUserId: clerkViewer });
    expect((await prisma.membership.findUniqueOrThrow({ where: { organizationId_userId: { organizationId: organizations[0]!, userId: viewerId } } })).seatType).toBe("READ_ONLY");
  });
  it("changed signed-in actor cannot read a prior actor scope even when both can read this project", async () => {
    await expect(viewer.summary({ ...input(), expectedClerkActorId: clerkOwner })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(viewer.byId({ ...input(), id: riskId, expectedClerkActorId: clerkOwner })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(owner.summary({ ...input(), expectedClerkActorId: clerkViewer })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await owner.summary({ ...input(), expectedClerkActorId: clerkOwner })).actorClerkUserId).toBe(clerkOwner);
  });
  it("cached caller membership cannot read after current membership removal", async () => {
    await prisma.membership.delete({ where: { organizationId_userId: { organizationId: organizations[0]!, userId: viewerId } } });
    try {
      await expect(viewer.summary({ ...input(), expectedClerkActorId: clerkViewer })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(viewer.byId({ ...input(), id: riskId, expectedClerkActorId: clerkViewer })).rejects.toMatchObject({ code: "FORBIDDEN" });
    } finally { await prisma.membership.create({ data: { organizationId: organizations[0]!, userId: viewerId, role: "VIEWER", seatType: "READ_ONLY" } }); }
  });
  it("reparented register refuses both scoped and legacy actor reads for an owner of both tenants", async () => {
    await prisma.project.update({ where: { id: projectId }, data: { organizationId: organizations[1]! } });
    try {
      for (const expectedClerkActorId of [undefined, clerkOwner]) {
        await expect(owner.summary({ projectId, expectedClerkActorId })).rejects.toMatchObject({ code: "NOT_FOUND" });
        await expect(owner.byId({ projectId, id: riskId, expectedClerkActorId })).rejects.toMatchObject({ code: "NOT_FOUND" });
      }
    } finally { await prisma.project.update({ where: { id: projectId }, data: { organizationId: organizations[0]! } }); }
  });
});
