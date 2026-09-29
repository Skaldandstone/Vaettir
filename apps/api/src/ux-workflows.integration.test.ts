import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@vaettir/db";
import { appRouter } from "./router.js";

// These fixtures intentionally stay in the disposable DB for inspection.
const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
const isolated =
  url &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  /test/i.test(url.pathname) &&
  !url.searchParams.has("host");
describe.skipIf(!isolated)("assistive UX persistence and authorization", () => {
  let owner: ReturnType<typeof appRouter.createCaller>;
  let viewer: ReturnType<typeof appRouter.createCaller>;
  let projectId: string;
  let otherProjectId: string;
  let caseId: string;
  let secondCaseId: string;
  const key = `ux-${Date.now()}`;

  beforeAll(async () => {
    const tier = await prisma.planTier.findUniqueOrThrow({
      where: { key: "free" },
    });
    const org = await prisma.organization.create({
      data: { name: key, slug: key, planTierId: tier.id },
    });
    const user = await prisma.user.create({
      data: {
        email: `${key}@example.com`,
        clerkUserId: key,
        memberships: { create: { organizationId: org.id, role: "OWNER" } },
      },
      include: { memberships: true },
    });
    const readUser = await prisma.user.create({
      data: {
        email: `${key}-viewer@example.com`,
        clerkUserId: `${key}-viewer`,
        memberships: { create: { organizationId: org.id, role: "VIEWER" } },
      },
      include: { memberships: true },
    });
    owner = appRouter.createCaller({ prisma, user });
    viewer = appRouter.createCaller({ prisma, user: readUser });
    const project = await owner.project.create({
      organizationId: org.id,
      name: "HIL bench",
      qualityProfile: {
        objective: "Verify supply stability",
        systemScope: "BOTH",
      },
    });
    projectId = project.id;
    const other = await prisma.project.create({
      data: {
        name: "Other project",
        slug: `${key}-other`,
        organizationId: org.id,
      },
    });
    otherProjectId = other.id;
    const testCase = await owner.testCases.create({
      projectId,
      title: "Verify power rail",
      testType: "INSTRUMENTATION",
      validationDomain: "HIL",
      verificationProfile: {
        setup: "Attach bench supply",
        acceptanceCriteria: "4.8 to 5.2 V",
        safety: "Disconnect on overheating",
        instruments: "Calibrated DMM",
      },
      steps: [{ action: "Measure rail", expectedResult: "4.8 to 5.2 V" }],
    });
    caseId = testCase.id;
    secondCaseId = (
      await owner.testCases.create({
        projectId,
        title: "Verify safe shutdown",
        testType: "FUNCTIONAL",
        steps: [
          { action: "Disconnect supply", expectedResult: "Safe shutdown" },
        ],
      })
    ).id;
  });

  it("roundtrips project and physical test profiles including a version snapshot", async () => {
    expect(
      (await owner.project.byId({ id: projectId })).qualityProfile.systemScope,
    ).toBe("BOTH");
    const testCase = await owner.testCases.byId({ id: caseId });
    expect(testCase.validationDomain).toBe("HIL");
    expect(testCase.verificationProfile.safety).toBe(
      "Disconnect on overheating",
    );
    const version = await prisma.testCaseVersion.findFirstOrThrow({
      where: { testCaseId: caseId },
    });
    expect(version.validationDomain).toBe("HIL");
  });

  it("serializes duplicate recordings, retains readings and refuses out-of-range Pass", async () => {
    const run = await owner.manualExecution.start({
      projectId,
      testCaseIds: [caseId, secondCaseId],
    });
    const input = {
      testRunId: run.testRunId,
      testCaseId: caseId,
      status: "PASS" as const,
      observations: {
        measurements: [
          {
            name: "Rail",
            value: 5,
            unit: "V",
            lowerLimit: 4.8,
            upperLimit: 5.2,
          },
        ],
      },
    };
    await Promise.all([
      owner.manualExecution.recordResult(input),
      owner.manualExecution.recordResult(input),
    ]);
    expect(
      await prisma.testResult.count({
        where: { testRunId: run.testRunId, testCaseId: caseId },
      }),
    ).toBe(1);
    const execution = await owner.manualExecution.getForExecution({
      testRunId: run.testRunId,
    });
    expect(
      execution.cases[0]?.currentResult?.observations.measurements[0]?.value,
    ).toBe(5);
    await expect(
      owner.manualExecution.recordResult({
        ...input,
        observations: {
          measurements: [
            { name: "Rail", value: 6, unit: "V", upperLimit: 5.2 },
          ],
        },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      viewer.manualExecution.recordResult(input),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(
      (await owner.manualExecution.complete({ testRunId: run.testRunId }))
        .status,
    ).toBe("PARTIAL");
    await expect(
      owner.manualExecution.recordResult(input),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("hides and restores frameworks only in the selected project", async () => {
    const framework = await owner.compliance.createFramework({
      key,
      name: "Fixture framework",
    });
    await expect(
      viewer.compliance.setFrameworkVisibility({
        projectId,
        frameworkId: framework.id,
        hidden: true,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await owner.compliance.setFrameworkVisibility({
      projectId,
      frameworkId: framework.id,
      hidden: true,
    });
    expect(
      (await owner.compliance.listFrameworks({ projectId })).some(
        (f) => f.id === framework.id,
      ),
    ).toBe(false);
    expect(
      (
        await owner.compliance.listFrameworks({ projectId: otherProjectId })
      ).some((f) => f.id === framework.id),
    ).toBe(true);
    expect(
      await prisma.complianceFramework.findUnique({
        where: { id: framework.id },
      }),
    ).not.toBeNull();
    await owner.compliance.setFrameworkVisibility({
      projectId,
      frameworkId: framework.id,
      hidden: false,
    });
    expect(
      (await owner.compliance.listFrameworks({ projectId })).some(
        (f) => f.id === framework.id,
      ),
    ).toBe(true);
  });

  it("atomically creates a release with goals and plans without stealing assigned plans", async () => {
    const planType = await prisma.testPlanType.findFirstOrThrow();
    const plan = await prisma.testPlan.create({
      data: { projectId, testPlanTypeId: planType.id, name: "Bench plan" },
    });
    const release = await owner.releases.create({
      projectId,
      name: "Pilot",
      testPlanIds: [plan.id],
      goals: ["Pilot/manufacturing build"],
    });
    expect((await owner.releases.byId({ id: release.id })).goals).toEqual([
      "Pilot/manufacturing build",
    ]);
    expect(
      (await prisma.testPlan.findUniqueOrThrow({ where: { id: plan.id } }))
        .releaseId,
    ).toBe(release.id);
    await expect(
      owner.releases.create({
        projectId,
        name: "Must not exist",
        testPlanIds: [plan.id],
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      owner.releases.create({
        projectId: otherProjectId,
        name: "Wrong project",
        testPlanIds: [plan.id],
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      await prisma.release.count({
        where: { projectId, name: "Must not exist" },
      }),
    ).toBe(0);
  });
});
