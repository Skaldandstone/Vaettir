import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@vaettir/db";
import { appRouter } from "./router.js";

const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
const isolated = url && ["localhost", "127.0.0.1"].includes(url.hostname)
  && /test/i.test(url.pathname) && !url.searchParams.has("host");

describe.skipIf(!isolated)("case placement and prerequisite execution", () => {
  let owner: ReturnType<typeof appRouter.createCaller>;
  let viewer: ReturnType<typeof appRouter.createCaller>;
  let outsider: ReturnType<typeof appRouter.createCaller>;
  let projectId: string;
  let otherProjectId: string;
  let loginId: string;
  let premiumId: string;
  let checkoutId: string;
  const key = `case-structure-${Date.now()}`;

  beforeAll(async () => {
    const tier = await prisma.planTier.findUniqueOrThrow({ where: { key: "free" } });
    const org = await prisma.organization.create({ data: { name: key, slug: key, planTierId: tier.id } });
    const otherOrg = await prisma.organization.create({ data: { name: `${key}-other`, slug: `${key}-other`, planTierId: tier.id } });
    const [ownerUser, viewerUser, outsiderUser] = await Promise.all([
      prisma.user.create({ data: { email: `${key}@example.com`, clerkUserId: key, memberships: { create: { organizationId: org.id, role: "OWNER" } } }, include: { memberships: true } }),
      prisma.user.create({ data: { email: `${key}-viewer@example.com`, clerkUserId: `${key}-viewer`, memberships: { create: { organizationId: org.id, role: "VIEWER" } } }, include: { memberships: true } }),
      prisma.user.create({ data: { email: `${key}-outside@example.com`, clerkUserId: `${key}-outside`, memberships: { create: { organizationId: otherOrg.id, role: "OWNER" } } }, include: { memberships: true } }),
    ]);
    owner = appRouter.createCaller({ prisma, user: ownerUser });
    viewer = appRouter.createCaller({ prisma, user: viewerUser });
    outsider = appRouter.createCaller({ prisma, user: outsiderUser });
    const project = await owner.project.create({ organizationId: org.id, name: "Premium flow" });
    projectId = project.id;
    otherProjectId = (await prisma.project.create({ data: { organizationId: otherOrg.id, name: "Other", slug: `${key}-project` } })).id;
    loginId = (await owner.testCases.create({ projectId, title: "Login", testType: "FUNCTIONAL", steps: [{ action: "Sign in" }] })).id;
    premiumId = (await owner.testCases.create({ projectId, title: "Premium action", testType: "FUNCTIONAL", steps: [{ action: "Open premium" }] })).id;
    checkoutId = (await owner.testCases.create({ projectId, title: "Checkout", testType: "FUNCTIONAL", steps: [{ action: "Pay" }] })).id;
  });

  it("moves between suites, persists order, and rejects stale or unauthorized moves", async () => {
    await expect(viewer.testCaseStructure.move({ projectId, caseId: loginId, expectedSuitePath: null, expectedSortPosition: 0, targetSuitePath: "auth", beforeCaseId: null })).rejects.toThrow();
    await expect(outsider.testCaseStructure.list({ projectId })).rejects.toThrow();
    await owner.testCaseStructure.move({ projectId, caseId: loginId, expectedSuitePath: null, expectedSortPosition: 0, targetSuitePath: "auth", beforeCaseId: null });
    await owner.testCaseStructure.move({ projectId, caseId: premiumId, expectedSuitePath: null, expectedSortPosition: 0, targetSuitePath: "auth", beforeCaseId: loginId });
    const list = await owner.testCaseStructure.list({ projectId });
    expect(list.cases.filter(c => c.suitePath === "auth").map(c => c.id)).toEqual([premiumId, loginId]);
    await expect(owner.testCaseStructure.move({ projectId, caseId: loginId, expectedSuitePath: null, expectedSortPosition: 0, targetSuitePath: "other", beforeCaseId: null })).rejects.toThrow("Refresh");
    await expect(owner.testCases.setSuite({ id: loginId, suitePath: "other", expectedSuitePath: null })).rejects.toThrow("Refresh");
    await expect(owner.testCaseStructure.move({ projectId, caseId: checkoutId, expectedSuitePath: null, expectedSortPosition: 0, targetSuitePath: "auth", beforeCaseId: "not-a-case" })).rejects.toThrow("Refresh");
    expect((await owner.testCaseStructure.list({ projectId })).cases.find(c => c.id === checkoutId)?.suitePath).toBeNull();
  });

  it("enforces project isolation and an acyclic prerequisite graph", async () => {
    const external = (await prisma.testCase.create({ data: { projectId: otherProjectId, title: "External", testType: "FUNCTIONAL" } })).id;
    await expect(viewer.testCaseStructure.setPrerequisites({ projectId, dependentId: premiumId, prerequisiteIds: [loginId], expectedPrerequisiteIds: [] })).rejects.toThrow();
    await expect(owner.testCaseStructure.setPrerequisites({ projectId, dependentId: premiumId, prerequisiteIds: [external], expectedPrerequisiteIds: [] })).rejects.toThrow("same project");
    await expect(prisma.testCasePrerequisite.create({ data: { projectId, dependentId: premiumId, prerequisiteId: external, createdById: "fixture" } })).rejects.toThrow();
    await owner.testCaseStructure.setPrerequisites({ projectId, dependentId: premiumId, prerequisiteIds: [loginId], expectedPrerequisiteIds: [] });
    await expect(owner.testCaseStructure.setPrerequisites({ projectId, dependentId: premiumId, prerequisiteIds: [], expectedPrerequisiteIds: [] })).rejects.toThrow("Refresh");
    await expect(owner.testCaseStructure.setPrerequisites({ projectId, dependentId: loginId, prerequisiteIds: [premiumId], expectedPrerequisiteIds: [] })).rejects.toThrow("cycle");
    expect((await owner.testCaseStructure.list({ projectId })).prerequisites).toContainEqual({ dependentId: premiumId, prerequisiteId: loginId });
    await expect(owner.testCases.delete({ id: loginId })).rejects.toThrow("prerequisite");
  });

  it("auto-includes prerequisites and gates execution against the frozen run graph", async () => {
    const { testRunId } = await owner.manualExecution.start({ projectId, testCaseIds: [premiumId] });
    const run = await owner.manualExecution.getForExecution({ testRunId });
    expect(run.cases.map(c => c.testCaseId)).toEqual([loginId, premiumId]);
    expect(run.cases[1]?.prerequisiteIds).toEqual([loginId]);
    await expect(owner.manualExecution.recordResult({ testRunId, testCaseId: premiumId, status: "PASS" })).rejects.toThrow("prerequisite");
    await owner.manualExecution.recordResult({ testRunId, testCaseId: loginId, status: "PASS" });
    await owner.manualExecution.recordResult({ testRunId, testCaseId: premiumId, status: "PASS" });
    await expect(owner.manualExecution.recordResult({ testRunId, testCaseId: loginId, status: "FAIL" })).rejects.toThrow("dependent");
    // Later graph edits affect only new runs, not this run's frozen rules.
    await owner.testCaseStructure.setPrerequisites({ projectId, dependentId: premiumId, prerequisiteIds: [], expectedPrerequisiteIds: [loginId] });
    expect((await owner.manualExecution.getForExecution({ testRunId })).cases[1]?.prerequisiteIds).toEqual([loginId]);
    const next = await owner.manualExecution.start({ projectId, testCaseIds: [premiumId] });
    expect((await owner.manualExecution.getForExecution({ testRunId: next.testRunId })).cases.map(c => c.testCaseId)).toEqual([premiumId]);
  });
});
