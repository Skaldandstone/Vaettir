import { test as base, expect } from "@playwright/test";
import { setupClerkTestingToken } from "@clerk/testing/playwright";
import { prisma } from "@vaettir/db";
import { randomUUID } from "node:crypto";
import { hardDeleteOrganization } from "../../api/src/services/orgHardDelete";
import { assertTestEnvironment } from "./test-environment";

export const test = base.extend<{ isolatedOrg: string; clerkTestToken: void }>({
  clerkTestToken: [async ({ page }, use) => {
    await setupClerkTestingToken({ page });
    await use();
  }, { auto: true }],
  isolatedOrg: [async ({ browserName: _browserName }, use, info) => {
    assertTestEnvironment();
    if (info.project.name === "signed-out") { await use(""); return; }
    const clerkUserId = process.env.CLERK_TEST_USER_ID;
    const email = process.env.CLERK_TEST_EMAIL?.toLowerCase();
    if (!clerkUserId || !email) throw new Error("Set CLERK_TEST_USER_ID and CLERK_TEST_EMAIL for a dedicated, verified test identity.");
    const existing = await prisma.user.findUnique({ where: { clerkUserId }, include: { memberships: true } });
    if (existing && (existing.memberships.length || existing.email !== email)) {
      throw new Error("Test identity is not isolated. Refusing to alter existing organizations.");
    }
    const user = existing ?? await prisma.user.create({ data: { clerkUserId, email } });
    const suffix = randomUUID();
    const tier = await prisma.planTier.findUniqueOrThrow({ where: { key: "private-beta" } });
    const org = await prisma.organization.create({ data: {
      name: "Disposable beta fixture", slug: "e2e-" + suffix, planTierId: tier.id,
      releaseGatePolicy: "HARD_BLOCK", memberships: { create: { userId: user.id, role: "OWNER", seatType: "FULL" } },
    } });
    let controlId: string | undefined;
    try {
      const project = await prisma.project.create({ data: { organizationId: org.id, name: "Beta fixture", slug: "beta-fixture" } });
      await prisma.project.create({ data: { organizationId: org.id, name: "Automation fixture", slug: "automation-fixture" } });
      const release = await prisma.release.create({ data: { projectId: project.id, name: "v2.4", status: "BLOCKED" } });
      await prisma.release.create({ data: { projectId: project.id, name: "v2.3", status: "SHIPPED" } });
      const planType = await prisma.testPlanType.findFirstOrThrow({ where: { isBuiltIn: true } });
      const plan = await prisma.testPlan.create({ data: { projectId: project.id, releaseId: release.id, name: "Fixture regression", testPlanTypeId: planType.id,
        acceptanceCriteria: { create: { description: "All authentication cases pass", status: "NOT_MET" } },
      } });
      const titles = ["Preparing an immutable submission preview succeeds", "A wrong password is rejected without creating a session", "A one-time code is required"];
      const cases = [];
      for (const title of titles) cases.push(await prisma.testCase.create({ data: {
        projectId: project.id, testPlanId: plan.id, title, testType: "FUNCTIONAL", given: ["a test account"],
        when: ["the sample action runs"], then: ["the expected result is recorded"], tags: ["fixture"],
      } }));
      const firstCase = cases[0]!;
      const secondCase = cases[1]!;
      await prisma.testRun.create({ data: {
        projectId: project.id, ciProvider: "github-actions", commitSha: "e2e-fixture", branch: "fixture", startedAt: new Date(),
        finishedAt: new Date(), status: "FAILED", results: { create: [
          { testCaseId: firstCase.id, status: "PASS" }, { testCaseId: secondCase.id, status: "FAIL", errorMessage: "Synthetic fixture failure" },
          { externalTestId: "unmatched-fixture", status: "PASS" },
        ] },
      } });
      for (const relatedFilePath of ["totp.ts", "connectorFallback.ts"]) await prisma.riskFlag.create({ data: {
        releaseId: release.id, severity: "HIGH", source: "MANUAL_FLAG", description: "Fixture risk: " + relatedFilePath, relatedFilePath,
      } });
      await prisma.reverseEngineerJob.create({ data: { projectId: project.id, inputType: "PASTE", inputRef: "fixture.spec.ts", status: "SUCCEEDED", resultTestCaseIds: [firstCase.id] } });
      const framework = await prisma.complianceFramework.findUniqueOrThrow({ where: { key: "soc2" } });
      const control = await prisma.complianceControl.create({ data: { frameworkId: framework.id, code: "E2E-" + suffix, title: "Fixture access review" } });
      controlId = control.id;
      await prisma.testCaseComplianceControl.create({ data: { testCaseId: firstCase.id, controlId } });
      await prisma.auditLog.create({ data: { organizationId: org.id, projectId: project.id, actorId: user.id, entityType: "TestCase", entityId: firstCase.id, action: "CREATE", summary: "Created fixture case" } });
      await use(org.id);
    } finally {
      await hardDeleteOrganization(prisma, org.id, user.id, "Isolated browser fixture cleanup");
      await prisma.organizationDeletionLog.deleteMany({ where: { organizationId: org.id } });
      if (controlId) await prisma.complianceControl.delete({ where: { id: controlId } });
      if (!existing) await prisma.user.delete({ where: { id: user.id } });
    }
  }, { auto: true }],
});
export { expect };
