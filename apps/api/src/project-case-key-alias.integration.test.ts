import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@vaettir/db";
import { appRouter } from "./router.js";
import { assertOwnedTestDatabase } from "./testOnlyDatabaseSafety.js";
import { captureCaseProcedureExport } from "./services/caseProcedureExport.js";
import { defaultCaseQuery } from "./services/caseQuerySchema.js";
import { queryCasePage } from "./services/caseQuery.js";

const isolated = (() => { try { assertOwnedTestDatabase(process.env.DATABASE_URL); return true; } catch { return false; } })();
// Never run against a configured customer/local database. Current authoring is
// source-only; the native migration/locking assertions require disposable CI PG.
describe.skipIf(!isolated)("durable project key aliases and immutable original case evidence", () => {
  const run = "key-alias-" + randomUUID();
  let projectId: string, organizationId: string;
  let owner: ReturnType<typeof appRouter.createCaller>;
  let actorId: string;
  beforeAll(async () => {
    const tier = await prisma.planTier.findFirstOrThrow();
    const org = await prisma.organization.create({ data: { name: run, slug: run, planTierId: tier.id } });
    organizationId = org.id;
    const user = await prisma.user.create({ data: { clerkUserId: run, email: run + "@example.com",
      memberships: { create: { organizationId, role: "OWNER", seatType: "FULL" } } }, include: { memberships: true } });
    actorId = user.id;
    owner = appRouter.createCaller({ prisma, user, authenticatedClerkSubject: run });
    projectId = (await owner.project.create({ organizationId, name: run, caseKey: "old" })).id;
  });
  async function proposal(key: string, id = projectId) {
    const current = await owner.project.caseIdentity({ projectId: id });
    return { projectId: id, originalOrganizationId: current.organizationId, expectedClerkActorId: run,
      expectedNativeActorId: current.actorId, requestId: randomUUID(), expectedCaseKey: current.caseKey, expectedRevision: current.revision, caseKey: key };
  }
  it("changes existing live labels while preserving all issued IDs, source IDs and version bodies", async () => {
    const original = await owner.testCases.create({ projectId, title: "Exact synthetic prose", testType: "FUNCTIONAL",
      steps: [{ action: "line one\nline two", expectedResult: "literal result" }], given: ["original context"], tags: ["synthetic-original"] });
    await prisma.testCaseSource.create({ data: { testCaseId: original.id, filePath: "synthetic/fixture.csv", framework: "custom:synthetic",
      externalTestId: "original-source-01", contentHash: "a".repeat(64), importSnapshot: { title: "Exact synthetic prose", action: "line one\nline two" } } });
    await prisma.testCaseVersion.create({ data: { testCaseId: original.id, versionNumber: 71, title: "Frozen original synthetic version",
      given: ["frozen original"], when: ["line one\nline two"], then: ["literal result"], steps: [{ action: "line one\nline two", expectedResult: "literal result" }],
      tags: ["synthetic-original"], priority: "MEDIUM", testType: "FUNCTIONAL", createdById: actorId } });
    const frozenRun = await prisma.testRun.create({ data: { projectId, ciProvider: "manual", commitSha: "manual", branch: "manual", startedAt: new Date(),
      manualTestCaseIds: [original.id], manualPrerequisites: { [original.id]: { displayId: "old-01", procedure: "line one\nline two" } },
      executionContext: { evidence: "synthetic immutable evidence\nsecond line" } } });
    const frozenBytes = JSON.stringify(frozenRun);
    const before = await prisma.testCase.findUniqueOrThrow({ where: { id: original.id }, include: { versions: true, steps: true, source: true } });
    expect(before.source).toMatchObject({ externalTestId: "original-source-01", contentHash: "a".repeat(64) });
    expect(before.versions.some(version => version.versionNumber === 71)).toBe(true);
    expect(before.steps).toHaveLength(1);
    expect(frozenRun.manualTestCaseIds).toEqual([original.id]);
    const request = await proposal("new");
    const accepted = await owner.project.saveCaseKey(request);
    expect(accepted).toMatchObject({ revision: 1, aliasesPreserved: true, replayed: false });
    const after = await prisma.testCase.findUniqueOrThrow({ where: { id: original.id }, include: { versions: true, steps: true, source: true } });
    expect(after).toEqual(before);
    expect(after).toMatchObject({ id: original.id, displayId: "old-01", caseNumber: 1, source: { externalTestId: "original-source-01" } });
    expect(JSON.stringify(after.versions)).toBe(JSON.stringify(before.versions));
    expect(JSON.stringify(after.steps)).toBe(JSON.stringify(before.steps));
    expect(JSON.stringify(await prisma.testRun.findUniqueOrThrow({ where: { id: frozenRun.id } }))).toBe(frozenBytes);
    for (const displayId of ["old-01", "NEW-01"]) expect(await owner.testCases.byDisplayId({ projectId, displayId })).toMatchObject({ id: original.id, displayId: "new-01" });
    expect((await owner.testCases.byId({ id: original.id })).displayId).toBe("new-01");
    expect((await owner.testCases.list({ projectId })).find(row => row.id === original.id)?.displayId).toBe("new-01");
    const exported = await prisma.$transaction(tx => captureCaseProcedureExport(tx, { projectId, ids: [original.id], scope: "selected", includeArchived: false }));
    expect(exported.cases[0]).toMatchObject({ id: original.id, displayId: "new-01", caseNumber: 1, given: ["original context"] });
    expect(exported.cases[0]?.authoredSteps[0]?.action).toBe("line one\nline two");
    const page = await prisma.$transaction(tx => queryCasePage(tx, { projectId, requestId: randomUUID(), query: defaultCaseQuery() }, actorId, organizationId, { PRODUCTION_SIGNAL_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") }));
    expect(page.items[0]).toMatchObject({ id: original.id, displayId: "new-01", caseNumber: 1 });
    const replay = await owner.project.saveCaseKey(request);
    expect(replay).toEqual({ ...accepted, replayed: true });
    expect(await owner.project.caseIdentity({ projectId })).toMatchObject({ revision: 1, caseKey: "new", allocatedCount: 1 });
  });
  it("preserves old aliases across multiple renames and rejects canonical number aliases that were never issued", async () => {
    await owner.project.saveCaseKey(await proposal("third"));
    await owner.project.saveCaseKey(await proposal("old"));
    for (const prefix of ["old", "new", "third"]) expect(await owner.testCases.byDisplayId({ projectId, displayId: prefix + "-01" })).toMatchObject({ displayId: "old-01" });
    for (const displayId of ["old-001", "third-999999"]) await expect(owner.testCases.byDisplayId({ projectId, displayId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(owner.testCases.byDisplayId({ projectId, displayId: "old-1" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it("cannot reuse another project's reserved historical key; old binaries fail safely", async () => {
    const second = await owner.project.create({ organizationId, name: run + "-second", caseKey: "secon" });
    await expect(owner.project.saveCaseKey(await proposal("new", second.id))).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(prisma.project.create({ data: { organizationId, name: "Reuse old", slug: run + "-reuse", caseKey: "third" } })).rejects.toThrow();
    await expect(prisma.project.update({ where: { id: projectId }, data: { caseKey: "bare" } })).rejects.toThrow("original reviewed key change");
    const next = await prisma.testCase.create({ data: { projectId, title: "Old client allocation", testType: "FUNCTIONAL" } });
    expect(next.displayId).toBe("old-02"); expect(next.caseNumber).toBe(2);
  });
  it("revision CAS prevents competing renames and same-key ABA; accepted old UUID recovers after later changes", async () => {
    const original = await proposal("racea");
    const second = { ...original, requestId: randomUUID(), caseKey: "raceb" };
    const results = await Promise.allSettled([owner.project.saveCaseKey(original), owner.project.saveCaseKey(second)]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const acceptedIndex = results.findIndex(result => result.status === "fulfilled");
    const acceptedInput = acceptedIndex === 0 ? original : second;
    await owner.project.saveCaseKey(await proposal("old"));
    const beforeReplay = await owner.project.caseIdentity({ projectId });
    const writesBefore = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*)::bigint AS count FROM "ProjectCaseKeyWrite" WHERE "projectId"=${projectId}`;
    expect(await owner.project.saveCaseKey(acceptedInput)).toMatchObject({ caseKey: acceptedInput.caseKey, replayed: true });
    expect(await owner.project.caseIdentity({ projectId })).toEqual(beforeReplay);
    expect(await prisma.$queryRaw`SELECT count(*)::bigint AS count FROM "ProjectCaseKeyWrite" WHERE "projectId"=${projectId}`).toEqual(writesBefore);
    await expect(owner.project.saveCaseKey({ ...original, requestId: randomUUID(), caseKey: "anew" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(owner.project.saveCaseKey({ ...acceptedInput, caseKey: "repl" })).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("serializes rename with old-client case allocation without changing issued numbers", async () => {
    const target = await owner.project.create({ organizationId, name: run + "-allocation", caseKey: "alloc" });
    const change = await proposal("alnew", target.id);
    const [, issued] = await Promise.all([owner.project.saveCaseKey(change), prisma.testCase.create({ data: { projectId: target.id, title: "Concurrent old client", testType: "FUNCTIONAL" } })]);
    expect(issued.caseNumber).toBe(1);
    expect(["alloc-01", "alnew-01"]).toContain(issued.displayId);
    for (const prefix of ["alloc", "alnew"]) expect(await owner.testCases.byDisplayId({ projectId: target.id, displayId: prefix + "-01" })).toMatchObject({ id: issued.id, displayId: "alnew-01" });
    const next = await prisma.testCase.create({ data: { projectId: target.id, title: "Next allocation", testType: "FUNCTIONAL" } });
    expect(next.caseNumber).toBe(2); expect(next.displayId).toBe("alnew-02");
  });
  it("reserves one prefix atomically against an old-client project insert", async () => {
    const target = await owner.project.create({ organizationId, name: run + "-prefix-race", caseKey: "pref" });
    const results = await Promise.allSettled([
      owner.project.saveCaseKey(await proposal("resrv", target.id)),
      prisma.project.create({ data: { organizationId, name: "Concurrent old client project", slug: run + "-old-race", caseKey: "resrv" } }),
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const reservations = await prisma.$queryRaw<Array<{ projectId: string }>>`SELECT "projectId" FROM "ProjectCaseKeyAlias" WHERE "organizationId"=${organizationId} AND "caseKey"=${"resrv"}`;
    expect(reservations).toHaveLength(1);
  });
  it("requires current role, seat, tenant and original native actor even for receipt recovery", async () => {
    const request = await proposal("auth");
    await owner.project.saveCaseKey(request);
    for (const data of [{ role: "VIEWER" as const }, { role: "EDITOR" as const, seatType: "READ_ONLY" as const }]) {
      await prisma.membership.update({ where: { organizationId_userId: { organizationId, userId: actorId } }, data });
      await expect(owner.project.saveCaseKey(request)).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    await prisma.membership.update({ where: { organizationId_userId: { organizationId, userId: actorId } }, data: { role: "OWNER", seatType: "FULL" } });
    await expect(owner.project.saveCaseKey({ ...request, originalOrganizationId: "another-tenant" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(owner.project.saveCaseKey({ ...request, expectedNativeActorId: "replacement-native" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const tier = await prisma.planTier.findFirstOrThrow();
    const foreignOrg = await prisma.organization.create({ data: { name: run + "-foreign", slug: run + "-foreign", planTierId: tier.id } });
    const outsider = await prisma.user.create({ data: { clerkUserId: run + "-foreign", email: run + "-foreign@example.com",
      memberships: { create: { organizationId: foreignOrg.id, role: "OWNER", seatType: "FULL" } } }, include: { memberships: true } });
    const foreignCaller = appRouter.createCaller({ prisma, user: outsider, authenticatedClerkSubject: outsider.clerkUserId });
    await expect(foreignCaller.project.caseIdentity({ projectId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(foreignCaller.project.saveCaseKey({ ...request, expectedNativeActorId: outsider.id, expectedClerkActorId: outsider.clerkUserId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    // A stale caller carries the same Clerk subject, but its original native DB mapping is gone.
    await prisma.user.update({ where: { id: actorId }, data: { clerkUserId: run + "-retired" } });
    const replacement = await prisma.user.create({ data: { clerkUserId: run, email: run + "-replacement@example.com",
      memberships: { create: { organizationId, role: "OWNER", seatType: "FULL" } } }, include: { memberships: true } });
    const replacementCaller = appRouter.createCaller({ prisma, user: replacement, authenticatedClerkSubject: run });
    await expect(replacementCaller.project.saveCaseKey(request)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(owner.project.saveCaseKey(request)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await prisma.user.update({ where: { id: replacement.id }, data: { clerkUserId: run + "-replacement-retired" } });
    await prisma.user.update({ where: { id: actorId }, data: { clerkUserId: run } });
    expect(await owner.project.saveCaseKey(request)).toMatchObject({ replayed: true });
  });
  it("alias/write rows cannot be edited/deleted directly and parent removal retains immutable key tombstones", async () => {
    await expect(prisma.$executeRaw`DELETE FROM "ProjectCaseKeyAlias" WHERE "projectId"=${projectId}`).rejects.toThrow("cannot be changed or deleted");
    await expect(prisma.$executeRaw`UPDATE "ProjectCaseKeyWrite" SET "requestHash"=${"0".repeat(64)} WHERE "projectId"=${projectId}`).rejects.toThrow("cannot be changed or deleted");
    await expect(prisma.$executeRaw`UPDATE "ProjectCaseKeyAlias" SET "caseKey"=${"tampered"} WHERE "projectId"=${projectId}`).rejects.toThrow("cannot be changed or deleted");
    await expect(prisma.$executeRaw`DELETE FROM "ProjectCaseKeyWrite" WHERE "projectId"=${projectId}`).rejects.toThrow("cannot be changed or deleted");
    const empty = await owner.project.create({ organizationId, name: run + "-erasure", caseKey: "erase" });
    await owner.project.saveCaseKey(await proposal("erasb", empty.id));
    const beforeAliases = await prisma.$queryRaw`SELECT * FROM "ProjectCaseKeyAlias" WHERE "projectId"=${empty.id} ORDER BY "caseKey"`;
    const beforeWrites = await prisma.$queryRaw`SELECT * FROM "ProjectCaseKeyWrite" WHERE "projectId"=${empty.id} ORDER BY id`;
    await prisma.project.delete({ where: { id: empty.id } });
    const aliases = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*)::bigint AS count FROM "ProjectCaseKeyAlias" WHERE "projectId"=${empty.id}`;
    expect(aliases[0]?.count).toBe(2n);
    const writes = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*)::bigint AS count FROM "ProjectCaseKeyWrite" WHERE "projectId"=${empty.id}`;
    expect(writes[0]?.count).toBe(1n);
    expect(await prisma.$queryRaw`SELECT * FROM "ProjectCaseKeyAlias" WHERE "projectId"=${empty.id} ORDER BY "caseKey"`).toEqual(beforeAliases);
    expect(await prisma.$queryRaw`SELECT * FROM "ProjectCaseKeyWrite" WHERE "projectId"=${empty.id} ORDER BY id`).toEqual(beforeWrites);
    await expect(owner.project.caseIdentity({ projectId: empty.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(prisma.project.create({ data: { id: empty.id, organizationId, name: "Reused", slug: run + "-reused", caseKey: "diff" } })).rejects.toThrow("cannot be reused");
    const unrelated = await owner.project.create({ organizationId, name: run + "-id-rebound", caseKey: "rebon" });
    await expect(prisma.project.update({ where: { id: unrelated.id }, data: { id: empty.id } })).rejects.toThrow("Project identity cannot be changed");
    expect(await prisma.project.findUnique({ where: { id: empty.id } })).toBeNull();
    expect((await prisma.project.findUniqueOrThrow({ where: { id: unrelated.id } })).caseKey).toBe("rebon");
    expect(await prisma.$queryRaw`SELECT * FROM "ProjectCaseKeyWrite" WHERE "projectId"=${empty.id} ORDER BY id`).toEqual(beforeWrites);
  });
});
