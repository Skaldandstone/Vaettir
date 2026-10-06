import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@vaettir/db";
import { appRouter } from "./router.js";
import { commitImportedTestCases } from "./services/importCommit.js";
import { prerequisiteRequestHash } from "./services/casePrerequisiteSchema.js";

const failures = vi.hoisted(() => ({ snapshot: false }));
vi.mock("./services/testCaseVersion.js", async importOriginal => {
  const actual = await importOriginal<typeof import("./services/testCaseVersion.js")>();
  return { ...actual, snapshotTestCaseVersion: async (...args: Parameters<typeof actual.snapshotTestCaseVersion>) => {
    if (failures.snapshot) throw new Error("Synthetic history storage failure");
    return actual.snapshotTestCaseVersion(...args);
  } };
});

const database = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
if (!database || !["localhost", "127.0.0.1"].includes(database.hostname) || !/test/i.test(database.pathname) || database.searchParams.has("host")) {
  throw new Error("This integration suite requires an explicitly selected disposable loopback test database.");
}

describe("case procedure integrity and retry-safe legacy import", () => {
  const key = `procedure-integrity-${randomUUID()}`;
  const ownerSubject = key, viewerSubject = `${key}-viewer`, readOnlySubject = `${key}-read`;
  let owner: ReturnType<typeof appRouter.createCaller>;
  let viewer: ReturnType<typeof appRouter.createCaller>;
  let readOnlyEditor: ReturnType<typeof appRouter.createCaller>;
  let projectId: string;
  let organizationId: string;
  let actorId: string;
  let ownPlanId: string;
  let foreignPlanId: string;
  let sameOrgForeignPlanId: string;
  const csvText = "title,given,when,then,priority\nDelete own comment,Signed in as comment owner,Choose Delete,Comment removed,HIGH\n";

  beforeAll(async () => {
    const tier = await prisma.planTier.findFirstOrThrow();
    const org = await prisma.organization.create({ data: { name: key, slug: key, planTierId: tier.id } });
    organizationId = org.id;
    const otherOrg = await prisma.organization.create({ data: { name: `${key}-other`, slug: `${key}-other`, planTierId: tier.id } });
    const users = await Promise.all([
      prisma.user.create({ data: { clerkUserId: key, email: `${key}@example.com`, memberships: { create: { organizationId, role: "OWNER", seatType: "FULL" } } }, include: { memberships: true } }),
      prisma.user.create({ data: { clerkUserId: `${key}-viewer`, email: `${key}-viewer@example.com`, memberships: { create: { organizationId, role: "VIEWER" } } }, include: { memberships: true } }),
      prisma.user.create({ data: { clerkUserId: `${key}-read`, email: `${key}-read@example.com`, memberships: { create: { organizationId, role: "EDITOR", seatType: "READ_ONLY" } } }, include: { memberships: true } }),
    ]);
    actorId = users[0]!.id;
    [owner, viewer, readOnlyEditor] = users.map((user, index) => appRouter.createCaller({ prisma, user, authenticatedClerkSubject: [ownerSubject, viewerSubject, readOnlySubject][index]! }));
    const project = await prisma.project.create({ data: { organizationId, name: key, slug: key } });
    projectId = project.id;
    const otherProject = await prisma.project.create({ data: { organizationId: otherOrg.id, name: `${key}-foreign`, slug: `${key}-foreign` } });
    const sameOrgProject = await prisma.project.create({ data: { organizationId, name: `${key}-sibling`, slug: `${key}-sibling` } });
    const planType = await prisma.testPlanType.findFirstOrThrow();
    ownPlanId = (await prisma.testPlan.create({ data: { projectId, testPlanTypeId: planType.id, name: "Own plan" } })).id;
    foreignPlanId = (await prisma.testPlan.create({ data: { projectId: otherProject.id, testPlanTypeId: planType.id, name: "Foreign plan" } })).id;
    sameOrgForeignPlanId = (await prisma.testPlan.create({ data: { projectId: sameOrgProject.id, testPlanTypeId: planType.id, name: "Sibling plan" } })).id;
  });

  it("rejects foreign/sibling plans and actors without current full editor rights before importing", async () => {
    const before = await prisma.testCase.count({ where: { projectId } });
    for (const testPlanId of [foreignPlanId, sameOrgForeignPlanId]) {
      await expect(owner.testCases.importCsv({ projectId, csvText, testPlanId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    await expect(viewer.testCases.importCsv({ projectId, csvText })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(readOnlyEditor.testCases.importCsv({ projectId, csvText })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await prisma.testCase.count({ where: { projectId } })).toBe(before);
    expect(await prisma.importJob.count({ where: { projectId } })).toBe(0);
  });

  it("commits one durable receipt and one complete case on concurrent or later identical retries", async () => {
    const input = { projectId, csvText, testPlanId: ownPlanId };
    const [first, simultaneous] = await Promise.all([owner.testCases.importCsv(input), owner.testCases.importCsv(input)]);
    expect(first).toEqual({ createdCount: 1, skipped: [] });
    expect(simultaneous).toEqual(first);
    expect(await owner.testCases.importCsv(input)).toEqual(first);
    const cases = await prisma.testCase.findMany({ where: { projectId }, include: { versions: true } });
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({ given: ["Signed in as comment owner"], when: ["Choose Delete"], then: ["Comment removed"], testPlanId: ownPlanId });
    expect(cases[0]!.versions).toHaveLength(1);
    expect(await prisma.importJob.count({ where: { projectId } })).toBe(1);
    const auditBefore = await prisma.auditLog.count({ where: { projectId } });
    await prisma.testCase.update({ where: { id: cases[0]!.id }, data: { given: ["Human-edited setup"] } });
    await owner.testCases.importCsv(input);
    expect((await prisma.testCase.findUniqueOrThrow({ where: { id: cases[0]!.id } })).given).toEqual(["Human-edited setup"]);
    expect(await prisma.auditLog.count({ where: { projectId } })).toBe(auditBefore);
  });

  it("rolls back cases, sources and receipt when snapshot storage fails, then recovers on retry", async () => {
    const input = { projectId, csvText: csvText.replace("Delete own comment", "Atomic snapshot import") };
    const before = await prisma.testCase.count({ where: { projectId } });
    const jobs = await prisma.importJob.count({ where: { projectId } });
    const audits = await prisma.auditLog.count({ where: { projectId } });
    failures.snapshot = true;
    try { await expect(owner.testCases.importCsv(input)).rejects.toThrow("Synthetic history storage failure"); }
    finally { failures.snapshot = false; }
    expect(await prisma.testCase.count({ where: { projectId } })).toBe(before);
    expect(await prisma.importJob.count({ where: { projectId } })).toBe(jobs);
    expect(await prisma.auditLog.count({ where: { projectId } })).toBe(audits);
    expect(await owner.testCases.importCsv(input)).toEqual({ createdCount: 1, skipped: [] });
  });

  it("preserves mixed structured and Given/When/Then import content when execution prerequisites are changed", async () => {
    await commitImportedTestCases(prisma, { projectId, organizationId, actorId, source: "CSV", fieldMapping: {}, keyPrefix: key, framework: "synthetic", rows: [{ rowNumber: 2, externalId: "mixed", title: "Mixed imported procedure", given: ["A signed-in comment owner"], when: ["Delete the comment"], then: ["Comment removed"], tags: [], priority: "HIGH", steps: [{ action: "Confirm delete", expectedActionOrData: null, expectedResult: "Dialog closes" }] }], skipped: [] });
    const tc = await prisma.testCase.findFirstOrThrow({ where: { projectId, title: "Mixed imported procedure" } });
    const prior = await owner.testCases.byId({ id: tc.id });
    const login = await owner.testCases.create({ projectId, title: "Login prerequisite", testType: "FUNCTIONAL", steps: [{ action: "Sign in" }] });
    const readRequestId = randomUUID(), access = await owner.testCaseStructure.prerequisiteAccess({ projectId, caseId: tc.id, readRequestId });
    expect(access).toMatchObject({ projectId, caseId: tc.id, readRequestId, canEdit: true, readScope: { projectId, organizationId, actorId, actorClerkUserId: ownerSubject } });
    const pins = { projectId, caseId: tc.id, originalOrganizationId: access.readScope.organizationId, expectedClerkActorId: access.readScope.actorClerkUserId, expectedActorId: access.readScope.actorId };
    const pageRequestId = randomUUID(), page = await owner.testCaseStructure.prerequisitePage({ ...pins, readRequestId: pageRequestId, search: login.displayId, sort: "case-id" });
    expect(page).toMatchObject({ projectId, caseId: tc.id, readRequestId: pageRequestId, readScope: access.readScope, prerequisiteIds: [] });
    expect(page.items.map(item => item.id)).toContain(login.id);
    const input = { ...pins, requestId: randomUUID(), expectedGraphHash: page.graphHash, expectedPrerequisiteIds: page.prerequisiteIds, prerequisiteIds: [login.id], confirmed: true as const };
    const saved = await owner.testCaseStructure.reviewedSetPrerequisites(input);
    expect(saved).toEqual({ projectId, caseId: tc.id, organizationId, actorId, actorClerkUserId: ownerSubject, requestId: input.requestId, requestHash: prerequisiteRequestHash(input), prerequisiteIds: [login.id], replayed: false });
    expect(await owner.testCaseStructure.reviewedSetPrerequisites(input)).toEqual({ ...saved, replayed: true });
    const after = await owner.testCases.byId({ id: tc.id });
    expect(after.given).toEqual(prior.given);
    expect(after.when).toEqual(prior.when);
    expect(after.then).toEqual(prior.then);
    expect(after.steps).toEqual(prior.steps);
    expect(after.caseRevision).toBe(prior.caseRevision);
  });

  it("rejects stale Given/When/Then edits even when structured steps, priority and suite are unchanged", async () => {
    const tc = await owner.testCases.create({ projectId, title: "Two editors", testType: "FUNCTIONAL", given: ["Original setup"], when: ["Act"], then: ["Observe"] });
    const opened = await owner.testCases.byId({ id: tc.id });
    const payload = { id: tc.id, title: opened.title, testType: opened.testType, given: opened.given, when: opened.when, then: opened.then, expectedStepRevision: opened.stepRevision, expectedCaseRevision: opened.caseRevision };
    const attempts = await Promise.allSettled([
      owner.testCases.update({ ...payload, given: ["First edited setup"] }),
      owner.testCases.update({ ...payload, given: ["Second edited setup"] }),
    ]);
    expect(attempts.filter(item => item.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter(item => item.status === "rejected")).toHaveLength(1);
    const saved = await owner.testCases.byId({ id: tc.id });
    expect(saved.given[0]).toMatch(/^(First|Second) edited setup$/);
    await expect(owner.testCases.update({ ...payload, expectedCaseRevision: undefined })).rejects.toThrow("full comparison baseline");
    expect((await owner.testCases.byId({ id: tc.id })).given).toEqual(saved.given);
  });

  it("rolls back content changes when the matching history snapshot cannot be written", async () => {
    const tc = await owner.testCases.create({ projectId, title: "Atomic case edit", testType: "FUNCTIONAL", given: ["Setup"], when: ["Act"], then: ["Observe"] });
    const opened = await owner.testCases.byId({ id: tc.id });
    failures.snapshot = true;
    try { await expect(owner.testCases.update({ id: tc.id, title: "Must roll back", testType: "FUNCTIONAL", given: ["Changed"], when: ["Act"], then: ["Observe"], expectedCaseRevision: opened.caseRevision })).rejects.toThrow("Synthetic history storage failure"); }
    finally { failures.snapshot = false; }
    expect((await owner.testCases.byId({ id: tc.id })).caseRevision).toBe(opened.caseRevision);
  });
});
