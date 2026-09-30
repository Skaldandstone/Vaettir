import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@vaettir/db";
import { reportsRouter } from "./reports.js";

const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
const disposable = url && ["localhost", "127.0.0.1"].includes(url.hostname) && /test/i.test(url.pathname) && !url.searchParams.has("host");

describe.skipIf(!disposable)("project report isolation and evidence totals", () => {
  const key = `report-${Date.now()}`;
  let orgA = "", orgB = "", projectA = "", projectB = "", ownerId = "", outsiderId = "", caseId = "", planId = "", planTypeId = "", requirementId = "";
  let caller: ReturnType<typeof reportsRouter.createCaller>;
  let outsider: ReturnType<typeof reportsRouter.createCaller>;

  beforeAll(async () => {
    const tier = await prisma.planTier.findUniqueOrThrow({ where: { key: "free" } });
    const [a, b] = await Promise.all(["a", "b"].map(suffix => prisma.organization.create({ data: { name: `${key}-${suffix}`, slug: `${key}-${suffix}`, planTierId: tier.id } })));
    orgA = a.id; orgB = b.id;
    const [pa, pb] = await Promise.all([
      prisma.project.create({ data: { organizationId: orgA, name: "Report project", slug: "report" } }),
      prisma.project.create({ data: { organizationId: orgB, name: "Other tenant", slug: "other" } }),
    ]);
    projectA = pa.id; projectB = pb.id;
    const [owner, other] = await Promise.all([
      prisma.user.create({ data: { clerkUserId: `${key}-owner`, email: `${key}-owner@example.com`, memberships: { create: { organizationId: orgA, role: "VIEWER" } } }, include: { memberships: true } }),
      prisma.user.create({ data: { clerkUserId: `${key}-other`, email: `${key}-other@example.com`, memberships: { create: { organizationId: orgB, role: "VIEWER" } } }, include: { memberships: true } }),
    ]);
    ownerId = owner.id; outsiderId = other.id;
    caller = reportsRouter.createCaller({ prisma, user: owner });
    outsider = reportsRouter.createCaller({ prisma, user: other });
    const active = await prisma.testCase.create({ data: { projectId: projectA, title: "Login", testType: "FUNCTIONAL", given: [], when: [], then: [], tags: [], priority: "HIGH", riskAssessedAt: new Date(), riskScore: 80, riskSeverity: "HIGH" } });
    caseId = active.id;
    await prisma.testCase.create({ data: { projectId: projectA, title: "Old", testType: "FUNCTIONAL", given: [], when: [], then: [], tags: [], archived: true } });
    await prisma.testCaseSource.create({ data: { testCaseId: caseId, filePath: "tests/login.spec.ts", framework: "playwright" } });
    // A separate tenant's records must never appear in either totals or run references.
    await prisma.testCase.create({ data: { projectId: projectB, title: "Private", testType: "FUNCTIONAL", given: [], when: [], then: [], tags: [] } });
    const type = await prisma.testPlanType.create({ data: { key, name: "Report test type", category: "CUSTOM", fieldSchema: {} } });
    planTypeId = type.id;
    planId = (await prisma.testPlan.create({ data: { projectId: projectA, testPlanTypeId: planTypeId, name: "Acceptance" } })).id;
    requirementId = (await prisma.requirement.create({ data: { projectId: projectA, title: "Sign in" } })).id;
    await prisma.acceptanceCriterion.create({ data: { testPlanId: planId, requirementId, description: "Login succeeds", status: "MET" } });
    await prisma.acceptanceCriterion.create({ data: { testPlanId: planId, description: "General plan gate", status: "PENDING" } });
    await prisma.testRun.create({ data: { projectId: projectA, ciProvider: "synthetic", commitSha: "abc", branch: "main", status: "FAILED", startedAt: new Date(), results: { create: [
      { testCaseId: caseId, status: "PASS" }, { externalTestId: "unknown", status: "FAIL" }, { externalTestId: "blocked", status: "BLOCKED" },
    ] } } });
    await prisma.testRun.create({ data: { projectId: projectA, ciProvider: "synthetic", commitSha: "old", branch: "main", status: "PASSED", startedAt: new Date(Date.now() - 60 * 86_400_000), results: { create: [{ testCaseId: caseId, status: "PASS" }] } } });
    await prisma.testRun.create({ data: { projectId: projectB, ciProvider: "synthetic", commitSha: "private", branch: "private", status: "FAILED", startedAt: new Date(), results: { create: [{ status: "FAIL" }] } } });
  });

  afterAll(async () => {
    if (!orgA || !orgB) return;
    await prisma.testResult.deleteMany({ where: { testRun: { projectId: { in: [projectA, projectB] } } } });
    await prisma.testRun.deleteMany({ where: { projectId: { in: [projectA, projectB] } } });
    await prisma.testCaseSource.deleteMany({ where: { testCaseId: caseId } });
    await prisma.acceptanceCriterion.deleteMany({ where: { testPlanId: planId } });
    await prisma.testPlan.deleteMany({ where: { id: planId } });
    await prisma.testPlanType.deleteMany({ where: { id: planTypeId } });
    await prisma.requirement.deleteMany({ where: { id: requirementId } });
    await prisma.testCase.deleteMany({ where: { projectId: { in: [projectA, projectB] } } });
    await prisma.project.deleteMany({ where: { id: { in: [projectA, projectB] } } });
    await prisma.membership.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, outsiderId] } } });
    await prisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
  });

  it("keeps current inventory separate from the execution window and excludes other tenants", async () => {
    const report = await caller.overview({ projectId: projectA, windowDays: 30 });
    expect(report.inventory).toMatchObject({ active: 1, archived: 1, withSource: 1, riskAssessed: 1 });
    expect(report.inventory.byPriority).toEqual([{ key: "HIGH", count: 1 }]);
    expect(report.requirements).toMatchObject({ total: 1, withCriteria: 1, linkedCriteria: 1, criteria: [{ key: "MET", count: 1 }, { key: "PENDING", count: 1 }] });
    expect(report.execution).toMatchObject({ runs: 1, results: 3, matchedResults: 1 });
    expect(report.execution.byResultStatus).toEqual([{ key: "BLOCKED", count: 1 }, { key: "FAIL", count: 1 }, { key: "PASS", count: 1 }]);
    expect(report.recentRuns).toHaveLength(1);
    expect(report.recentRuns[0]?.commitSha).toBe("abc");
    const all = await caller.overview({ projectId: projectA, windowDays: null });
    expect(all.execution).toMatchObject({ runs: 2, results: 4, matchedResults: 2 });
  });

  it("rejects another tenant and an unknown project before aggregating", async () => {
    await expect(outsider.overview({ projectId: projectA, windowDays: 30 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.overview({ projectId: projectB, windowDays: 30 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.overview({ projectId: "missing", windowDays: 30 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
