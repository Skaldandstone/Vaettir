import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@vaettir/db";
import { appRouter } from "./router.js";
import { assertOwnedTestDatabase } from "./testOnlyDatabaseSafety.js";
import { hardDeleteOrganization, previewOrgHardDelete } from "./services/orgHardDelete.js";

const isolated = (() => { try { assertOwnedTestDatabase(process.env.DATABASE_URL); return true; } catch { return false; } })();
describe.skipIf(!isolated)("original tenant key history through project moves and exact org erasure", () => {
  const tag = "key-erasure-" + randomUUID();
  let actorId: string, caller: ReturnType<typeof appRouter.createCaller>, oldOrg: string, newOrg: string, projectId: string;
  let acceptedRequest: Parameters<typeof caller.project.saveCaseKey>[0];
  let originalWrite: unknown;
  const cleanupOrgs = new Map<string, string>();
  beforeAll(async () => {
    const tier = await prisma.planTier.findFirstOrThrow();
    const orgs = await Promise.all(["old", "new"].map(suffix => prisma.organization.create({ data: {
      name: tag + suffix, slug: tag + suffix, planTierId: tier.id,
    } })));
    oldOrg = orgs[0]!.id; newOrg = orgs[1]!.id;
    cleanupOrgs.set(oldOrg, tag + "old"); cleanupOrgs.set(newOrg, tag + "new");
    const actor = await prisma.user.create({ data: { clerkUserId: tag, email: tag + "@example.com",
      memberships: { create: orgs.map(org => ({ organizationId: org.id, role: "OWNER", seatType: "FULL" })) } }, include: { memberships: true } });
    actorId = actor.id; caller = appRouter.createCaller({ prisma, user: actor, authenticatedClerkSubject: tag });
    projectId = (await caller.project.create({ organizationId: oldOrg, name: tag, caseKey: "mold" })).id;
    await prisma.testCase.create({ data: { projectId, title: "Retained synthetic case", testType: "FUNCTIONAL" } });
    const current = await caller.project.caseIdentity({ projectId });
    acceptedRequest = { projectId, originalOrganizationId: oldOrg, expectedNativeActorId: actorId, expectedClerkActorId: tag,
      requestId: randomUUID(), expectedRevision: current.revision, expectedCaseKey: current.caseKey, caseKey: "mnew" };
    await caller.project.saveCaseKey(acceptedRequest);
    originalWrite = await prisma.$queryRaw`SELECT * FROM "ProjectCaseKeyWrite" WHERE id=${acceptedRequest.requestId}`;
  });
  afterAll(async () => {
    // Exact owned tenants only, original first. Native foreign-scope refusal
    // remains a refusal, never a reason to bypass guards or prune foreign rows.
    // Keep both permanent deletion receipts and their dedicated actor in CI.
    for (const [id, slug] of cleanupOrgs) {
      if (!id) continue;
      const org = await prisma.organization.findUnique({ where: { id } });
      if (!org) continue;
      if (org.slug !== slug) throw Error("Exact owned key erasure fixture required");
      await hardDeleteOrganization(prisma, id, actorId, "Owned synthetic key erasure fixture cleanup");
    }
  });
  it("supports a real move and all old references without migrating any original receipt", async () => {
    const casesBefore = await prisma.testCase.findMany({ where: { projectId } });
    const aliasesBefore = await prisma.$queryRaw`SELECT * FROM "ProjectCaseKeyAlias" WHERE "projectId"=${projectId} AND "organizationId"=${oldOrg} ORDER BY "caseKey"`;
    await prisma.project.update({ where: { id: projectId }, data: { organizationId: newOrg } });
    expect(await prisma.$queryRaw`SELECT * FROM "ProjectCaseKeyWrite" WHERE id=${acceptedRequest.requestId}`).toEqual(originalWrite);
    expect(await prisma.$queryRaw`SELECT * FROM "ProjectCaseKeyAlias" WHERE "projectId"=${projectId} AND "organizationId"=${oldOrg} ORDER BY "caseKey"`).toEqual(aliasesBefore);
    expect(await prisma.testCase.findMany({ where: { projectId } })).toEqual(casesBefore);
    for (const prefix of ["mold", "mnew"]) expect(await caller.testCases.byDisplayId({ projectId, displayId: prefix + "-01" })).toMatchObject({ id: casesBefore[0]!.id, displayId: "mnew-01" });
    await expect(caller.project.saveCaseKey(acceptedRequest)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.project.saveCaseKey({ ...acceptedRequest, originalOrganizationId: newOrg })).rejects.toMatchObject({ code: "CONFLICT" });
    await prisma.project.update({ where: { id: projectId }, data: { organizationId: oldOrg } });
    expect(await caller.project.saveCaseKey(acceptedRequest)).toMatchObject({ replayed: true, requestId: acceptedRequest.requestId, organizationId: oldOrg });
    await prisma.project.update({ where: { id: projectId }, data: { organizationId: newOrg } });
    expect(await prisma.$queryRaw`SELECT * FROM "ProjectCaseKeyWrite" WHERE id=${acceptedRequest.requestId}`).toEqual(originalWrite);
    const originalPreview = await previewOrgHardDelete(prisma, oldOrg);
    expect(originalPreview.rowCounts).toMatchObject({ ProjectCaseKeyAlias: 2, ProjectCaseKeyWrite: 1 });
    expect(originalPreview.projectCaseKeyScope).toMatchObject({ blocked: false,
      originalRecordsOnReparentedProjects: { ProjectCaseKeyAlias: 2, ProjectCaseKeyWrite: 1 } });
  });
  it("rejects destination historical namespace conflicts atomically instead of stealing aliases", async () => {
    const collision = await caller.project.create({ organizationId: newOrg, name: tag + "-collision", caseKey: "cold" });
    const current = await caller.project.caseIdentity({ projectId: collision.id });
    await caller.project.saveCaseKey({ projectId: collision.id, originalOrganizationId: newOrg, expectedNativeActorId: actorId,
      expectedClerkActorId: tag, requestId: randomUUID(), expectedRevision: current.revision, expectedCaseKey: current.caseKey, caseKey: "ccurr" });
    const other = await caller.project.create({ organizationId: oldOrg, name: tag + "-other", caseKey: "cold" });
    const before = await prisma.$queryRaw`SELECT * FROM "ProjectCaseKeyAlias" WHERE "projectId"=${other.id} ORDER BY "organizationId","caseKey"`;
    await expect(prisma.project.update({ where: { id: other.id }, data: { organizationId: newOrg } })).rejects.toThrow();
    expect((await prisma.project.findUniqueOrThrow({ where: { id: other.id } })).organizationId).toBe(oldOrg);
    expect(await prisma.$queryRaw`SELECT * FROM "ProjectCaseKeyAlias" WHERE "projectId"=${other.id} ORDER BY "organizationId","caseKey"`).toEqual(before);
    await prisma.project.delete({ where: { id: other.id } });
    await prisma.project.delete({ where: { id: collision.id } });
  });
  it("cannot prune original key history using only a forged erasure marker", async () => {
    await expect(prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT set_config('vaettir.project_case_key_erasure',${oldOrg},true)`;
      await tx.$executeRaw`DELETE FROM "ProjectCaseKeyWrite" WHERE "organizationId"=${oldOrg}`;
    })).rejects.toThrow("original organization deletion");
    expect(await prisma.$queryRaw`SELECT * FROM "ProjectCaseKeyWrite" WHERE id=${acceptedRequest.requestId}`).toEqual(originalWrite);
  });
  it("erases the destination while retaining foreign-original key rows byte-exact as inaccessible tombstones", async () => {
    const preview = await previewOrgHardDelete(prisma, newOrg);
    expect(preview.projectCaseKeyScope).toMatchObject({ blocked: false,
      foreignOriginalRecordsOnCurrentProjects: { ProjectCaseKeyAlias: 2, ProjectCaseKeyWrite: 1 } });
    const before = await prisma.$queryRaw`SELECT * FROM "ProjectCaseKeyAlias" WHERE "projectId"=${projectId} AND "organizationId"=${oldOrg} ORDER BY "caseKey"`;
    const result = await hardDeleteOrganization(prisma, newOrg, actorId, "Synthetic current parent erasure with retained foreign key history");
    expect(result.rowCounts).toMatchObject({ ProjectCaseKeyAlias: 4, ProjectCaseKeyWrite: 1, Project: 1 });
    expect(await prisma.$queryRaw`SELECT * FROM "ProjectCaseKeyAlias" WHERE "projectId"=${projectId} AND "organizationId"=${oldOrg} ORDER BY "caseKey"`).toEqual(before);
    expect(await prisma.$queryRaw`SELECT * FROM "ProjectCaseKeyWrite" WHERE id=${acceptedRequest.requestId}`).toEqual(originalWrite);
    expect(await prisma.organization.findUnique({ where: { id: newOrg } })).toBeNull();
    expect(await prisma.project.findUnique({ where: { id: projectId } })).toBeNull();
    for (const prefix of ["mold", "mnew"]) await expect(caller.testCases.byDisplayId({ projectId, displayId: prefix + "-01" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(caller.project.caseIdentity({ projectId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    // Prisma maps PostgreSQL23505 to its structured unique-constraint error;
    // the driver's human-readable trigger text is not the invariant.
    await expect(prisma.project.create({ data: { organizationId: oldOrg, name: "Reused prefix", slug: tag + "-prefix-reuse", caseKey: "mnew" } })).rejects.toMatchObject({ code: "P2002" });
    expect(await prisma.project.count({ where: { organizationId: oldOrg, slug: tag + "-prefix-reuse" } })).toBe(0);
    expect(await prisma.$queryRaw`SELECT * FROM "ProjectCaseKeyAlias" WHERE "projectId"=${projectId} AND "organizationId"=${oldOrg} ORDER BY "caseKey"`).toEqual(before);
    expect(await prisma.$queryRaw`SELECT * FROM "ProjectCaseKeyWrite" WHERE id=${acceptedRequest.requestId}`).toEqual(originalWrite);
    await expect(prisma.project.create({ data: { id: projectId, organizationId: oldOrg, name: "Reused ID", slug: tag + "-id-reuse", caseKey: "reborn" } })).rejects.toThrow("cannot be reused");
  });
  it("erases exact original tenant tombstones after parent removal with a durable original-scope count receipt", async () => {
    const preview = await previewOrgHardDelete(prisma, oldOrg);
    expect(preview.projectCaseKeyScope).toMatchObject({ blocked: false,
      originalRecordsOnReparentedProjects: { ProjectCaseKeyAlias: 0, ProjectCaseKeyWrite: 0 },
      originalRecordsOnRemovedProjects: { ProjectCaseKeyAlias: 3, ProjectCaseKeyWrite: 1 } });
    const result = await hardDeleteOrganization(prisma, oldOrg, actorId, "Synthetic original tenant key erasure");
    expect(result.rowCounts).toMatchObject({ ProjectCaseKeyAlias: 3, ProjectCaseKeyWrite: 1, Project: 0 });
    expect((await prisma.organizationDeletionLog.findUniqueOrThrow({ where: { id: result.deletionLogId } })).rowCounts).toMatchObject({ ProjectCaseKeyAlias: 3, ProjectCaseKeyWrite: 1 });
    expect(await prisma.$queryRaw`SELECT * FROM "ProjectCaseKeyWrite" WHERE id=${acceptedRequest.requestId}`).toEqual([]);
    expect(await prisma.organization.findUnique({ where: { id: oldOrg } })).toBeNull();
    expect(await prisma.$queryRaw`SELECT * FROM "ProjectCaseKeyAlias" WHERE "organizationId"=${oldOrg}`).toEqual([]);
  });
  it("erases original key history while its parent still exists in a foreign destination, preserving that destination byte-exact", async () => {
    const tier = await prisma.planTier.findFirstOrThrow();
    const origin = await prisma.organization.create({ data: { name: tag + "pold", slug: tag + "pold", planTierId: tier.id } });
    const destination = await prisma.organization.create({ data: { name: tag + "pnew", slug: tag + "pnew", planTierId: tier.id } });
    cleanupOrgs.set(origin.id, tag + "pold"); cleanupOrgs.set(destination.id, tag + "pnew");
    await prisma.membership.createMany({ data: [origin.id, destination.id].map(organizationId => ({ organizationId, userId: actorId, role: "OWNER", seatType: "FULL" })) });
    const actor = await prisma.user.findUniqueOrThrow({ where: { id: actorId }, include: { memberships: true } });
    const scoped = appRouter.createCaller({ prisma, user: actor, authenticatedClerkSubject: tag });
    const project = await scoped.project.create({ organizationId: origin.id, name: tag + "-positive", caseKey: "pold" });
    const testCase = await prisma.testCase.create({ data: { projectId: project.id, title: "Foreign destination synthetic procedure", testType: "FUNCTIONAL",
      given: ["literal setup"], when: ["literal multiline\nprocedure"], then: ["literal expected result"] } });
    const current = await scoped.project.caseIdentity({ projectId: project.id });
    const request = { projectId: project.id, originalOrganizationId: origin.id, expectedNativeActorId: actorId, expectedClerkActorId: tag,
      expectedCaseKey: current.caseKey, expectedRevision: current.revision, requestId: randomUUID(), caseKey: "pnew" };
    await scoped.project.saveCaseKey(request);
    await prisma.project.update({ where: { id: project.id }, data: { organizationId: destination.id } });
    const beforeProject = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
    const beforeCase = await prisma.testCase.findUniqueOrThrow({ where: { id: testCase.id } });
    const beforeAliases = await prisma.$queryRaw`SELECT * FROM "ProjectCaseKeyAlias" WHERE "projectId"=${project.id} AND "organizationId"=${destination.id} ORDER BY "caseKey"`;
    const preview = await previewOrgHardDelete(prisma, origin.id);
    expect(preview.projectCaseKeyScope).toMatchObject({ blocked: false,
      originalRecordsOnReparentedProjects: { ProjectCaseKeyAlias: 2, ProjectCaseKeyWrite: 1 },
      originalRecordsOnRemovedProjects: { ProjectCaseKeyAlias: 0, ProjectCaseKeyWrite: 0 } });
    const result = await hardDeleteOrganization(prisma, origin.id, actorId, "Synthetic positive original erasure with foreign live parent");
    expect(result.rowCounts).toMatchObject({ ProjectCaseKeyAlias: 2, ProjectCaseKeyWrite: 1, Project: 0 });
    expect((await prisma.organizationDeletionLog.findUniqueOrThrow({ where: { id: result.deletionLogId } })).rowCounts).toMatchObject({ ProjectCaseKeyAlias: 2, ProjectCaseKeyWrite: 1 });
    expect(await prisma.project.findUniqueOrThrow({ where: { id: project.id } })).toEqual(beforeProject);
    expect(await prisma.testCase.findUniqueOrThrow({ where: { id: testCase.id } })).toEqual(beforeCase);
    expect(await prisma.$queryRaw`SELECT * FROM "ProjectCaseKeyAlias" WHERE "projectId"=${project.id} AND "organizationId"=${destination.id} ORDER BY "caseKey"`).toEqual(beforeAliases);
    expect(await prisma.$queryRaw`SELECT * FROM "ProjectCaseKeyWrite" WHERE id=${request.requestId}`).toEqual([]);
    for (const prefix of ["pold", "pnew"]) expect(await scoped.testCases.byDisplayId({ projectId: project.id, displayId: prefix + "-01" })).toMatchObject({ id: testCase.id, displayId: "pnew-01" });
  });
});
