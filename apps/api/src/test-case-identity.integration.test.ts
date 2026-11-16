import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@vaettir/db";
import { appRouter } from "./router.js";
import { commitImportedTestCases } from "./services/importCommit.js";
import { prerequisiteRequestHash } from "./services/casePrerequisiteSchema.js";
import { assertOwnedTestDatabase } from "./testOnlyDatabaseSafety.js";

const isolated = (() => { try { assertOwnedTestDatabase(process.env.DATABASE_URL); return true; } catch { return false; } })();

describe.skipIf(!isolated)("stable human-readable test case identities", () => {
  const run = `case-id-${randomUUID()}`;
  const ownerSubject = run, viewerSubject = `${run}-viewer`, outsiderSubject = `${run}-outsider`;
  let owner: ReturnType<typeof appRouter.createCaller>;
  let viewer: ReturnType<typeof appRouter.createCaller>;
  let outsider: ReturnType<typeof appRouter.createCaller>;
  let organizationId: string;
  let otherOrgId: string;
  let actorId: string;
  let projectId: string;
  let otherProjectId: string;
  const keyInput = (current: Awaited<ReturnType<typeof owner.project.caseIdentity>>, caseKey: string, subject = ownerSubject) => ({
    projectId: current.projectId, originalOrganizationId: current.organizationId, expectedClerkActorId: subject, expectedNativeActorId: current.actorId,
    requestId: randomUUID(), expectedCaseKey: current.caseKey, expectedRevision: current.revision, caseKey,
  });

  beforeAll(async () => {
    const tier = await prisma.planTier.findFirstOrThrow();
    const org = await prisma.organization.create({ data: { name: run, slug: run, planTierId: tier.id } });
    const otherOrg = await prisma.organization.create({ data: { name: `${run}-other`, slug: `${run}-other`, planTierId: tier.id } });
    organizationId = org.id; otherOrgId = otherOrg.id;
    const [ownerUser, viewerUser, outsiderUser] = await Promise.all([
      prisma.user.create({ data: { email: `${run}@example.com`, clerkUserId: run, memberships: { create: { organizationId, role: "OWNER" } } }, include: { memberships: true } }),
      prisma.user.create({ data: { email: `${run}-viewer@example.com`, clerkUserId: `${run}-viewer`, memberships: { create: { organizationId, role: "VIEWER" } } }, include: { memberships: true } }),
      prisma.user.create({ data: { email: `${run}-outsider@example.com`, clerkUserId: `${run}-outsider`, memberships: { create: { organizationId: otherOrgId, role: "OWNER" } } }, include: { memberships: true } }),
    ]);
    actorId = ownerUser.id;
    owner = appRouter.createCaller({ prisma, user: ownerUser, authenticatedClerkSubject: ownerSubject });
    viewer = appRouter.createCaller({ prisma, user: viewerUser, authenticatedClerkSubject: viewerSubject });
    outsider = appRouter.createCaller({ prisma, user: outsiderUser, authenticatedClerkSubject: outsiderSubject });
    projectId = (await owner.project.create({ organizationId, name: "aTw", caseKey: "aTw" })).id;
    otherProjectId = (await outsider.project.create({ organizationId: otherOrgId, name: "aTw", caseKey: "atw" })).id;
  });

  it("serializes concurrent creation and allocates distinct project-local numbers", async () => {
    const cases = await Promise.all(Array.from({ length: 24 }, (_, index) => prisma.testCase.create({
      data: { projectId, title: `Concurrent ${index}`, testType: "FUNCTIONAL" },
    })));
    expect(cases.map(c => c.caseNumber).sort((a, b) => a - b)).toEqual(Array.from({ length: 24 }, (_, i) => i + 1));
    expect(new Set(cases.map(c => c.displayId)).size).toBe(24);
    for (const c of cases) expect(c.displayId).toBe(`atw-${String(c.caseNumber).padStart(2, "0")}`);
    expect(await owner.project.caseIdentity({ projectId })).toMatchObject({ caseKey: "atw", allocatedCount: 24, keyLocked: false, revision: 0 });
  });

  it("retains identity through titles, suite moves, archiving and project renames", async () => {
    const original = await prisma.testCase.findFirstOrThrow({ where: { projectId }, orderBy: { caseNumber: "asc" } });
    await prisma.testCase.update({ where: { id: original.id }, data: { title: "Changed title", suitePath: "Auth/Login", archived: true } });
    await prisma.project.update({ where: { id: projectId }, data: { name: "Renamed project" } });
    const after = await prisma.testCase.findUniqueOrThrow({ where: { id: original.id } });
    expect([after.id, after.displayId, after.caseNumber]).toEqual([original.id, original.displayId, original.caseNumber]);
    await prisma.testCase.update({ where: { id: original.id }, data: { archived: false } });
  });

  it("never reuses a committed number after deletion and does not truncate three-digit numbers", async () => {
    const first = await prisma.testCase.create({ data: { projectId, title: "Disposable", testType: "FUNCTIONAL" } });
    await prisma.testCase.delete({ where: { id: first.id } });
    const next = await prisma.testCase.create({ data: { projectId, title: "Next", testType: "FUNCTIONAL" } });
    expect(next.caseNumber).toBe(first.caseNumber + 1);
    await prisma.testCase.createMany({ data: Array.from({ length: 80 }, (_, i) => ({ projectId, title: `Hundred ${i}`, testType: "FUNCTIONAL" as const })) });
    const hundred = await owner.testCases.byDisplayId({ projectId, displayId: "ATW-100" });
    expect(hundred.displayId).toBe("atw-100");
  });

  it("rejects supplied, rewritten and cross-project identities at the database layer", async () => {
    const tc = await prisma.testCase.findFirstOrThrow({ where: { projectId } });
    const counter = (await prisma.project.findUniqueOrThrow({ where: { id: projectId } })).nextCaseNumber;
    await expect(prisma.testCase.create({ data: { projectId, title: "Forged", testType: "FUNCTIONAL", displayId: "atw-999", caseNumber: 999 } })).rejects.toThrow("assigned by the database");
    await expect(prisma.testCase.update({ where: { id: tc.id }, data: { displayId: "atw-999" } })).rejects.toThrow("identity cannot be changed");
    await expect(prisma.testCase.update({ where: { id: tc.id }, data: { projectId: otherProjectId } })).rejects.toThrow("identity cannot be changed");
    await expect(prisma.project.update({ where: { id: projectId }, data: { nextCaseNumber: 0 } })).rejects.toThrow("cannot be reused");
    await expect(prisma.project.update({ where: { id: projectId }, data: { caseKey: "rname" } })).rejects.toThrow("original reviewed key change");
    expect((await prisma.project.findUniqueOrThrow({ where: { id: projectId } })).nextCaseNumber).toBe(counter);
  });

  it("allocates for old-client inserts omitting both new identity fields", async () => {
    const id = randomUUID();
    const rows = await prisma.$queryRaw<Array<{ displayId: string; caseNumber: number }>>`
      INSERT INTO "TestCase" (id, "projectId", title, given, "when", "then", tags, "testType", "updatedAt")
      VALUES (${id}, ${projectId}, 'Legacy client', ARRAY['signed in'], ARRAY['delete comment'], ARRAY['removed'], ARRAY[]::text[], 'FUNCTIONAL', now())
      RETURNING "displayId", "caseNumber"`;
    expect(rows[0]?.displayId).toBe(`atw-${String(rows[0]?.caseNumber).padStart(2, "0")}`);
  });

  it("retains human identity and source external identity on identical and changed imports", async () => {
    const args = { projectId, organizationId, actorId, source: "XRAY" as const, sourceLabel: "Synthetic export", keyPrefix: "xray", framework: "xray", fieldMapping: {}, skipped: [], rows: [
      { rowNumber: 1, title: "Imported", given: ["member"], when: ["login"], then: ["home"], priority: "HIGH" as const, tags: [], externalId: "SOURCE-7" },
    ] };
    await commitImportedTestCases(prisma, args);
    const before = await prisma.testCase.findFirstOrThrow({ where: { projectId, source: { externalTestId: `xray:${projectId}:SOURCE-7` } }, include: { source: true } });
    const identical = await commitImportedTestCases(prisma, args);
    expect(identical).toMatchObject({ createdCount: 0, updatedCount: 0 });
    const changed = await commitImportedTestCases(prisma, { ...args, rows: [{ ...args.rows[0]!, title: "Updated imported" }] });
    expect(changed).toMatchObject({ createdCount: 0, updatedCount: 1 });
    const after = await prisma.testCase.findUniqueOrThrow({ where: { id: before.id }, include: { source: true } });
    expect([after.id, after.displayId, after.caseNumber, after.source?.externalTestId]).toEqual([before.id, before.displayId, before.caseNumber, before.source?.externalTestId]);
  });

  it("uses human IDs to find prerequisites without changing procedure steps", async () => {
    const login = await owner.testCases.byDisplayId({ projectId, displayId: "atw-01" });
    const premium = await prisma.testCase.create({ data: { projectId, title: "Premium", testType: "FUNCTIONAL", given: ["member"], when: ["subscribe"], then: ["enabled"] } });
    const readRequestId = randomUUID(), access = await owner.testCaseStructure.prerequisiteAccess({ projectId, caseId: premium.id, readRequestId });
    expect(access).toMatchObject({ projectId, caseId: premium.id, readRequestId, canEdit: true, readScope: { projectId, organizationId, actorId, actorClerkUserId: ownerSubject } });
    const pins = { projectId, caseId: premium.id, originalOrganizationId: access.readScope.organizationId, expectedClerkActorId: access.readScope.actorClerkUserId, expectedActorId: access.readScope.actorId };
    const pageRequestId = randomUUID(), page = await owner.testCaseStructure.prerequisitePage({ ...pins, readRequestId: pageRequestId, search: login.displayId, sort: "case-id" });
    expect(page).toMatchObject({ projectId, caseId: premium.id, readRequestId: pageRequestId, readScope: access.readScope, prerequisiteIds: [] });
    expect(page.items).toContainEqual(expect.objectContaining({ id: login.id, displayId: "atw-01", unavailable: false }));
    const input = { ...pins, requestId: randomUUID(), expectedGraphHash: page.graphHash, expectedPrerequisiteIds: page.prerequisiteIds, prerequisiteIds: [login.id], confirmed: true as const };
    const saved = await owner.testCaseStructure.reviewedSetPrerequisites(input);
    expect(saved).toEqual({ projectId, caseId: premium.id, organizationId, actorId, actorClerkUserId: ownerSubject, requestId: input.requestId, requestHash: prerequisiteRequestHash(input), prerequisiteIds: [login.id], replayed: false });
    expect(await owner.testCaseStructure.reviewedSetPrerequisites(input)).toEqual({ ...saved, replayed: true });
    const after = await owner.testCases.byId({ id: premium.id });
    expect(after.displayId).toBe(premium.displayId);
    expect([after.given, after.when, after.then]).toEqual([premium.given, premium.when, premium.then]);
    expect((await owner.testCases.list({ projectId })).find(c => c.id === premium.id)?.displayId).toBe(premium.displayId);
  });

  it("keeps lookup tenant scoped even when another workspace has the same human key", async () => {
    const external = await prisma.testCase.create({ data: { projectId: otherProjectId, title: "Private other tenant", testType: "FUNCTIONAL" } });
    expect(external.displayId).toBe("atw-01");
    const ours = await owner.testCases.byDisplayId({ projectId, displayId: "atw-01" });
    expect(ours.id).not.toBe(external.id);
    await expect(owner.testCases.byDisplayId({ projectId: otherProjectId, displayId: external.displayId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(outsider.testCases.byDisplayId({ projectId, displayId: "atw-01" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(owner.testCases.byDisplayId({ projectId, displayId: "atw-999999" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await viewer.testCases.byDisplayId({ projectId, displayId: "atw-01" })).id).toBe(ours.id);
  });

  it("allows reviewed keys before and after allocation but prevents stale, duplicate or unauthorized changes", async () => {
    const empty = await owner.project.create({ organizationId, name: "New workspace flow" });
    const current = await owner.project.caseIdentity({ projectId: empty.id });
    await expect(viewer.project.saveCaseKey(keyInput(await viewer.project.caseIdentity({ projectId: empty.id }), "cust", viewerSubject))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(owner.project.saveCaseKey({ ...keyInput(current, "cust"), expectedCaseKey: "wrong" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(owner.project.saveCaseKey(keyInput(current, "atw"))).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await owner.project.saveCaseKey(keyInput(current, "CUST"))).toMatchObject({ caseKey: "cust", keyLocked: false, aliasesPreserved: true, revision: 1 });
    const tc = await prisma.testCase.create({ data: { projectId: empty.id, title: "First", testType: "FUNCTIONAL" } });
    expect(tc.displayId).toBe("cust-01");
    const request = keyInput(await owner.project.caseIdentity({ projectId: empty.id }), "new");
    expect(await owner.project.saveCaseKey(request)).toMatchObject({ caseKey: "new", revision: 2, replayed: false });
    expect(await owner.project.saveCaseKey(request)).toMatchObject({ caseKey: "new", revision: 2, replayed: true });
    expect((await prisma.testCase.findUniqueOrThrow({ where: { id: tc.id } })).displayId).toBe("cust-01");
    expect(await owner.testCases.byDisplayId({ projectId: empty.id, displayId: "cust-01" })).toMatchObject({ id: tc.id, displayId: "new-01" });
    expect(await owner.testCases.byDisplayId({ projectId: empty.id, displayId: "new-01" })).toMatchObject({ id: tc.id, displayId: "new-01" });
    expect(await prisma.auditLog.count({ where: { projectId: empty.id, entityType: "ProjectCaseKeyWrite" } })).toBe(2);
  });

  it("serializes first-case allocation against a concurrent key configuration", async () => {
    const empty = await owner.project.create({ organizationId, name: "Racing prefix" });
    const original = await owner.project.caseIdentity({ projectId: empty.id });
    const [configuration, creation] = await Promise.allSettled([
      owner.project.saveCaseKey(keyInput(original, "race")),
      prisma.testCase.create({ data: { projectId: empty.id, title: "Concurrent first", testType: "FUNCTIONAL" } }),
    ]);
    expect(creation.status).toBe("fulfilled");
    const identity = await owner.project.caseIdentity({ projectId: empty.id });
    const tc = await prisma.testCase.findFirstOrThrow({ where: { projectId: empty.id } });
    expect(configuration.status).toBe("fulfilled");
    expect(identity.caseKey).toBe("race");
    expect([original.caseKey + "-01", "race-01"]).toContain(tc.displayId);
    expect(await owner.testCases.byDisplayId({ projectId: empty.id, displayId: tc.displayId })).toMatchObject({ id: tc.id, displayId: "race-01" });
  });

  it("generates collision-safe default keys for old project inserts", async () => {
    const first = await prisma.project.create({ data: { organizationId, name: "Game test", slug: "game-test" } });
    const second = await prisma.project.create({ data: { organizationId, name: "GameTest", slug: "gametest" } });
    expect([first.caseKey, second.caseKey]).toEqual(["gamet", "aaaaa"]);
    await expect(prisma.project.create({ data: { organizationId, name: "Bad key", slug: "bad-key", caseKey: "not valid" } })).rejects.toThrow();
  });

  it("rejects foreign plans and step libraries before allocating an identity or exposing content", async () => {
    const sameOrgProject = await owner.project.create({ organizationId, name: "Other same-org project" });
    const type = await prisma.testPlanType.findFirstOrThrow();
    const before = (await owner.project.caseIdentity({ projectId })).allocatedCount;
    for (const foreignProjectId of [sameOrgProject.id, otherProjectId]) {
      const plan = await prisma.testPlan.create({ data: { projectId: foreignProjectId, name: "Foreign plan", testPlanTypeId: type.id } });
      const group = await prisma.sharedStepGroup.create({ data: { projectId: foreignProjectId, name: "Private shared steps", steps: [{ order: 0, action: "Do not disclose this foreign procedure", expectedResult: "private" }] } });
      await expect(owner.testCases.create({ projectId, title: "Invalid foreign plan", testType: "FUNCTIONAL", steps: [{ action: "Open" }], testPlanId: plan.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(owner.testCases.create({ projectId, title: "Invalid foreign library", testType: "FUNCTIONAL", sharedStepGroupId: group.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
      // Simulate a historical invalid relation from an older client. Reading
      // it fails closed; the repair never deletes or overwrites its content.
      const historical = await prisma.testCase.create({ data: { projectId, title: "Historical invalid relation", testType: "FUNCTIONAL", given: ["original context"], when: ["original action"], then: ["original result"], sharedStepGroupId: group.id } });
      await expect(owner.testCases.byId({ id: historical.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(owner.testCases.generateAutomationDraft({ id: historical.id, framework: "PLAYWRIGHT" })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("shared step group from another project") });
      expect((await prisma.testCase.findUniqueOrThrow({ where: { id: historical.id } })).given).toEqual(["original context"]);
    }
    expect((await owner.project.caseIdentity({ projectId })).allocatedCount).toBe(before + 2);
  });

  it("requires a full editor seat to create a case", async () => {
    const readOnly = await prisma.user.create({ data: { email: `${run}-readonly@example.com`, clerkUserId: `${run}-readonly`, memberships: { create: { organizationId, role: "EDITOR", seatType: "READ_ONLY" } } }, include: { memberships: true } });
    const caller = appRouter.createCaller({ prisma, user: readOnly });
    await expect(caller.testCases.create({ projectId, title: "Forbidden create", testType: "FUNCTIONAL", steps: [{ action: "Open" }] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.testCases.quickCreate({ projectId, title: "Forbidden quick create" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await prisma.testCase.count({ where: { projectId, title: "Forbidden create" } })).toBe(0);
  });

  it("rechecks current authorization rather than accepting a stale full-editor snapshot", async () => {
    const editor = await prisma.user.create({ data: { email: `${run}-stale@example.com`, clerkUserId: `${run}-stale`, memberships: { create: { organizationId, role: "EDITOR", seatType: "FULL" } } }, include: { memberships: true } });
    const caller = appRouter.createCaller({ prisma, user: editor, authenticatedClerkSubject: editor.clerkUserId });
    const empty = await owner.project.create({ organizationId, name: "Authorization changed" });
    const current = await owner.project.caseIdentity({ projectId: empty.id });
    await prisma.membership.update({ where: { organizationId_userId: { organizationId, userId: editor.id } }, data: { role: "VIEWER" } });
    await expect(caller.project.saveCaseKey({ ...keyInput(current, "rvok", editor.clerkUserId), expectedNativeActorId: editor.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await owner.project.caseIdentity({ projectId: empty.id })).caseKey).toBe(current.caseKey);
  });

  it("rolls back case allocation, initial content and audit when a version write fails", async () => {
    const before = (await owner.project.caseIdentity({ projectId })).allocatedCount;
    // Fault injection is confined to this synthetic loopback test database
    // and one uniquely prefixed fixture title. No customer rows are touched.
    await prisma.$executeRawUnsafe(`CREATE FUNCTION identity_snapshot_failure_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.title LIKE 'Identity failed initial version case-id-%' THEN RAISE EXCEPTION 'Synthetic snapshot fault'; END IF; RETURN NEW; END $$`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER identity_snapshot_failure_fixture BEFORE INSERT ON "TestCaseVersion" FOR EACH ROW EXECUTE FUNCTION identity_snapshot_failure_fixture()`);
    try {
      await expect(owner.testCases.create({ projectId, title: `Identity failed initial version ${run}`, testType: "FUNCTIONAL", steps: [{ action: "Open" }] })).rejects.toThrow("Synthetic snapshot fault");
      expect(await prisma.testCase.count({ where: { projectId, title: `Identity failed initial version ${run}` } })).toBe(0);
      expect((await owner.project.caseIdentity({ projectId })).allocatedCount).toBe(before);
      expect(await prisma.auditLog.count({ where: { projectId, summary: { contains: `Identity failed initial version ${run}` } } })).toBe(0);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER identity_snapshot_failure_fixture ON "TestCaseVersion"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION identity_snapshot_failure_fixture()`);
    }
  });
});
