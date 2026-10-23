// SOURCE ONLY. Do not run until morning against a migrated owned loopback test database.
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { prisma } from "@vaettir/db";
import { appRouter } from "./router.js";
import { hardDeleteOrganization } from "./services/orgHardDelete.js";

describe("procedure restore current actor and original tenant", () => {
  const prefix = `procedure-scope-${randomUUID()}`;
  const orgIds: string[] = [], userIds: string[] = [];
  let projectId: string, actorId: string, otherActorId: string;
  let owner: ReturnType<typeof appRouter.createCaller>, other: typeof owner;
  const clerkActorId = `${prefix}-owner`;
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
    if (!["localhost", "127.0.0.1"].includes(url.hostname) || !/test/i.test(url.pathname) || url.searchParams.has("host"))
      throw Error("Owned disposable loopback test database required");
    const tier = await prisma.planTier.findUniqueOrThrow({ where: { key: "free" } });
    for (let i = 0; i < 2; i++) {
      const organization = await prisma.organization.create({ data: { name: `${prefix}-${i}`, slug: `${prefix}-${i}`, planTierId: tier.id } });
      orgIds.push(organization.id);
    }
    for (let i = 0; i < 2; i++) {
      const user = await prisma.user.create({ data: { email: `${prefix}-${i}@example.com`, clerkUserId: i === 0 ? clerkActorId : `${prefix}-other`,
        memberships: { create: orgIds.map(organizationId => ({ organizationId, role: "OWNER" as const, seatType: "FULL" as const })) } }, include: { memberships: true } });
      userIds.push(user.id);
      if (i === 0) { actorId = user.id; owner = appRouter.createCaller({ prisma, user }); }
      else { otherActorId = user.id; other = appRouter.createCaller({ prisma, user }); }
    }
    projectId = (await owner.project.create({ organizationId: orgIds[0]!, name: "Synthetic original-scope procedure project", caseKey: "prscope" })).id;
  });
  afterAll(async () => {
    if (!actorId) return;
    for (const id of orgIds) {
      const org = await prisma.organization.findUnique({ where: { id }, select: { slug: true } });
      if (!org?.slug.startsWith(prefix)) throw Error("Owned fixture identity mismatch");
      await hardDeleteOrganization(prisma, id, actorId, "Owned synthetic procedure scope erasure");
    }
    // Retain dedicated synthetic users: deletion receipts intentionally retain their actor FK.
    for (const organizationId of orgIds)
      expect(await prisma.organizationDeletionLog.count({ where: { organizationId, deletedById: actorId } })).toBe(1);
  });
  const expectedScope = () => ({ organizationId: orgIds[0]!, clerkActorId });
  async function reviewed(scoped = true) {
    const c = await owner.testCases.create({ projectId, title: "Synthetic current human title", given: ["Keep setup"], when: ["Keep action"],
      then: ["Keep outcome"], tags: [], priority: "HIGH", testType: "FUNCTIONAL", suitePath: "Human/suite" });
    const bundle = await owner.testCases.exportProcedure({ projectId, ids: [c.id], scope: "selected", includeArchived: false });
    bundle.cases[0]!.title = "Reviewed synthetic prior procedure";
    const serialized = JSON.stringify(bundle);
    const preview = await owner.caseProcedureReimport.preview({ projectId, serialized, ...(scoped ? { expectedScope: expectedScope() } : {}) });
    const input = { projectId, serialized, expectedReviewHash: preview.expectedReviewHash, actorId,
      selections: [{ caseId: c.id, reason: "Explicit synthetic conflict review", overwriteConfirmed: true as const }],
      confirmed: true as const, requestId: randomUUID(), ...(scoped ? { expectedScope: expectedScope() } : {}) };
    return { c, input, preview };
  }
  it("wrong org or actor refuses before preview parses invalid JSON", async () => {
    for (const scope of [{ ...expectedScope(), organizationId: orgIds[1]! }, { ...expectedScope(), clerkActorId: `${prefix}-other` }])
      await expect(owner.caseProcedureReimport.preview({ projectId, serialized: "not JSON", expectedScope: scope })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("scoped approval and exact replay echo original identity without another history write", async () => {
    const { c, input, preview } = await reviewed();
    expect(preview).toMatchObject({ projectId, organizationId: orgIds[0], actorClerkUserId: clerkActorId, actorId });
    const accepted = await owner.caseProcedureReimport.approve(input);
    const versions = await prisma.testCaseVersion.count({ where: { testCaseId: c.id } });
    expect(await owner.caseProcedureReimport.approve(input)).toMatchObject({ ...accepted, replayed: true });
    expect(await prisma.testCaseVersion.count({ where: { testCaseId: c.id } })).toBe(versions);
    expect((await prisma.testCase.findUniqueOrThrow({ where: { id: c.id } })).suitePath).toBe("Human/suite");
  });
  it("asynchronous signed-in actor switch cannot use an approval even if its DB actor field is rebound", async () => {
    const { c, input } = await reviewed();
    await expect(other.caseProcedureReimport.approve({ ...input, actorId: otherActorId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await prisma.testCase.findUniqueOrThrow({ where: { id: c.id } })).title).toBe("Synthetic current human title");
    expect(await prisma.auditLog.count({ where: { entityType: "TestCaseProcedureReimport", entityId: input.requestId } })).toBe(0);
  });
  it("legacy receipt cannot be replayed after project reparent even when the actor owns both organizations", async () => {
    const { c, input } = await reviewed(false);
    await owner.caseProcedureReimport.approve(input);
    const versions = await prisma.testCaseVersion.count({ where: { testCaseId: c.id } });
    await prisma.project.update({ where: { id: projectId }, data: { organizationId: orgIds[1]! } });
    try {
      await expect(owner.caseProcedureReimport.approve(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(await prisma.testCaseVersion.count({ where: { testCaseId: c.id } })).toBe(versions);
    } finally { await prisma.project.update({ where: { id: projectId }, data: { organizationId: orgIds[0]! } }); }
    await expect(owner.caseProcedureReimport.approve(input)).resolves.toMatchObject({ replayed: true, organizationId: orgIds[0] });
  });
  it("fresh role demotion refuses exact replay rather than trusting a caller's cached membership", async () => {
    const { input } = await reviewed();
    await owner.caseProcedureReimport.approve(input);
    await prisma.membership.update({ where: { organizationId_userId: { organizationId: orgIds[0]!, userId: actorId } }, data: { role: "VIEWER", seatType: "READ_ONLY" } });
    try { await expect(owner.caseProcedureReimport.approve(input)).rejects.toMatchObject({ code: "FORBIDDEN" }); }
    finally { await prisma.membership.update({ where: { organizationId_userId: { organizationId: orgIds[0]!, userId: actorId } }, data: { role: "OWNER", seatType: "FULL" } }); }
  });
});
