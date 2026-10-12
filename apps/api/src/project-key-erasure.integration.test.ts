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
  beforeAll(async () => {
    const tier = await prisma.planTier.findFirstOrThrow();
    const orgs = await Promise.all(["old", "new"].map(suffix => prisma.organization.create({ data: {
      name: tag + suffix, slug: tag + suffix, planTierId: tier.id,
    } })));
    oldOrg = orgs[0]!.id; newOrg = orgs[1]!.id;
    const actor = await prisma.user.create({ data: { clerkUserId: tag, email: tag + "@example.com",
      memberships: { create: orgs.map(org => ({ organizationId: org.id, role: "OWNER", seatType: "FULL" })) } }, include: { memberships: true } });
    actorId = actor.id; caller = appRouter.createCaller({ prisma, user: actor, authenticatedClerkSubject: tag });
    projectId = (await caller.project.create({ organizationId: oldOrg, name: tag, caseKey: "move-old" })).id;
    await prisma.testCase.create({ data: { projectId, title: "Retained synthetic case", testType: "FUNCTIONAL" } });
    const current = await caller.project.caseIdentity({ projectId });
    acceptedRequest = { projectId, originalOrganizationId: oldOrg, expectedNativeActorId: actorId, expectedClerkActorId: tag,
      requestId: randomUUID(), expectedRevision: current.revision, expectedCaseKey: current.caseKey, caseKey: "move-new" };
    await caller.project.saveCaseKey(acceptedRequest);
    originalWrite = await prisma.$queryRaw`SELECT * FROM "ProjectCaseKeyWrite" WHERE id=${acceptedRequest.requestId}`;
  });
  afterAll(async () => {
    // Exact owned tenants only, original first. Native foreign-scope refusal
    // remains a refusal, never a reason to bypass guards or prune foreign rows.
    // Keep both permanent deletion receipts and their dedicated actor in CI.
    for (const id of [oldOrg, newOrg]) {
      if (!id) continue;
      const org = await prisma.organization.findUnique({ where: { id } });
      if (!org) continue;
      if (![tag + "old", tag + "new"].includes(org.slug)) throw Error("Exact owned key erasure fixture required");
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
    for (const prefix of ["move-old", "move-new"]) expect(await caller.testCases.byDisplayId({ projectId, displayId: prefix + "-01" })).toMatchObject({ id: casesBefore[0]!.id, displayId: "move-new-01" });
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
    const collision = await caller.project.create({ organizationId: newOrg, name: tag + "-collision", caseKey: "conflict-old" });
    const current = await caller.project.caseIdentity({ projectId: collision.id });
    await caller.project.saveCaseKey({ projectId: collision.id, originalOrganizationId: newOrg, expectedNativeActorId: actorId,
      expectedClerkActorId: tag, requestId: randomUUID(), expectedRevision: current.revision, expectedCaseKey: current.caseKey, caseKey: "conflict-current" });
    const other = await caller.project.create({ organizationId: oldOrg, name: tag + "-other", caseKey: "conflict-old" });
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
    })).rejects.toThrow("original organization or parent deletion");
    expect(await prisma.$queryRaw`SELECT * FROM "ProjectCaseKeyWrite" WHERE id=${acceptedRequest.requestId}`).toEqual(originalWrite);
  });
  it("refuses destination erasure with foreign-original history and keeps every affected row intact", async () => {
    const preview = await previewOrgHardDelete(prisma, newOrg);
    expect(preview.projectCaseKeyScope).toMatchObject({ blocked: true,
      foreignOriginalRecordsOnCurrentProjects: { ProjectCaseKeyAlias: 2, ProjectCaseKeyWrite: 1 } });
    const before = await prisma.$queryRaw`SELECT * FROM "ProjectCaseKeyAlias" WHERE "projectId"=${projectId} ORDER BY "organizationId","caseKey"`;
    await expect(hardDeleteOrganization(prisma, newOrg, actorId, "Synthetic foreign-original refusal")).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(await prisma.$queryRaw`SELECT * FROM "ProjectCaseKeyAlias" WHERE "projectId"=${projectId} ORDER BY "organizationId","caseKey"`).toEqual(before);
    expect(await prisma.$queryRaw`SELECT * FROM "ProjectCaseKeyWrite" WHERE id=${acceptedRequest.requestId}`).toEqual(originalWrite);
    expect(await prisma.organization.findUnique({ where: { id: newOrg } })).not.toBeNull();
  });
  it("erases only original tenant history on moved projects, with exact receipt counts and unchanged foreign data", async () => {
    const foreignProject = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    const foreignCases = await prisma.testCase.findMany({ where: { projectId } });
    const destinationAliases = await prisma.$queryRaw`SELECT * FROM "ProjectCaseKeyAlias" WHERE "projectId"=${projectId} AND "organizationId"=${newOrg} ORDER BY "caseKey"`;
    const result = await hardDeleteOrganization(prisma, oldOrg, actorId, "Synthetic original tenant key erasure");
    expect(result.rowCounts).toMatchObject({ ProjectCaseKeyAlias: 2, ProjectCaseKeyWrite: 1, Project: 0 });
    expect((await prisma.organizationDeletionLog.findUniqueOrThrow({ where: { id: result.deletionLogId } })).rowCounts).toMatchObject({ ProjectCaseKeyAlias: 2, ProjectCaseKeyWrite: 1 });
    expect(await prisma.project.findUniqueOrThrow({ where: { id: projectId } })).toEqual(foreignProject);
    expect(await prisma.testCase.findMany({ where: { projectId } })).toEqual(foreignCases);
    expect(await prisma.$queryRaw`SELECT * FROM "ProjectCaseKeyAlias" WHERE "projectId"=${projectId} AND "organizationId"=${newOrg} ORDER BY "caseKey"`).toEqual(destinationAliases);
    expect(await prisma.$queryRaw`SELECT * FROM "ProjectCaseKeyWrite" WHERE id=${acceptedRequest.requestId}`).toEqual([]);
    expect(await prisma.organization.findUnique({ where: { id: oldOrg } })).toBeNull();
    for (const prefix of ["move-old", "move-new"]) expect(await caller.testCases.byDisplayId({ projectId, displayId: prefix + "-01" })).toMatchObject({ id: foreignCases[0]!.id });
  });
});
