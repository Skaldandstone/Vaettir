import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { prisma } from "@vaettir/db";
import {
  encodeCaseProcedureExport,
  decodeCaseProcedureExport,
} from "@vaettir/core";
import { appRouter } from "./router.js";

const stamp = `procedure-export-${Date.now()}`;
describe("tenant-safe case procedure export", () => {
  const projects: string[] = [];
  const organizations: string[] = [];
  const users: string[] = [];
  let firstCase: string;
  let secondCase: string;
  let foreignCase: string;
  let viewer: ReturnType<typeof appRouter.createCaller>;
  let outsider: ReturnType<typeof appRouter.createCaller>;
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
    if (
      !["localhost", "127.0.0.1"].includes(url.hostname) ||
      !/test/i.test(url.pathname) ||
      url.searchParams.has("host")
    )
      throw new Error("Disposable synthetic loopback database required");
    const tier = await prisma.planTier.findUniqueOrThrow({
      where: { key: "free" },
    });
    for (let index = 0; index < 2; index++) {
      const org = await prisma.organization.create({
        data: {
          name: `${stamp}-${index}`,
          slug: `${stamp}-${index}`,
          planTierId: tier.id,
        },
      });
      organizations.push(org.id);
      const project = await prisma.project.create({
        data: {
          name: "Synthetic procedure export",
          slug: `${stamp}-${index}`,
          organizationId: org.id,
        },
      });
      projects.push(project.id);
      const user = await prisma.user.create({
        data: {
          clerkUserId: `${stamp}-${index}`,
          email: `${stamp}-${index}@example.com`,
          memberships: {
            create: {
              organizationId: org.id,
              role: "VIEWER",
              seatType: "READ_ONLY",
            },
          },
        },
        include: { memberships: true },
      });
      users.push(user.id);
      const caller = appRouter.createCaller({ prisma, user });
      if (index === 0) viewer = caller;
      else outsider = caller;
    }
    for (const [index, projectId] of [
      projects[0]!,
      projects[0]!,
      projects[1]!,
    ].entries()) {
      const item = await prisma.testCase.create({
        data: {
          projectId,
          title: `Synthetic procedure ${index}`,
          background: "  exact\n背景 ",
          given: ["a|b"],
          when: ["action\nline"],
          then: ["outcome"],
          tags: ["a|b"],
          testType: "UNIT",
          automationStatus: "AUTOMATED",
          suitePath: "fixture/suite",
          validationDomain: "HIL",
          verificationProfile: { setup: "Synthetic rig" },
          steps: {
            create: {
              order: 0,
              action: "Exact action",
              expectedResult: "Exact result",
              mediaAttachmentIds: [],
            },
          },
        },
      });
      if (index === 0) firstCase = item.id;
      else if (index === 1) secondCase = item.id;
      else foreignCase = item.id;
    }
    await prisma.testCasePrerequisite.create({
      data: {
        projectId: projects[0]!,
        dependentId: firstCase,
        prerequisiteId: secondCase,
        createdById: users[0]!,
      },
    });
  });
  afterAll(async () => {
    if (projects.length) {
      await prisma.testCasePrerequisite.deleteMany({
        where: { projectId: { in: projects } },
      });
      await prisma.testCaseStep.deleteMany({
        where: { testCase: { projectId: { in: projects } } },
      });
      await prisma.testCaseAttachment.deleteMany({
        where: { testCase: { projectId: { in: projects } } },
      });
      await prisma.testCase.deleteMany({
        where: { projectId: { in: projects } },
      });
      // Erase only this suite's disposable libraries and retained snapshots.
      for (const organizationId of organizations) await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT set_config('vaettir.shared_library_erasure',${organizationId},true)`;
        await tx.sharedStepGroupRevision.deleteMany({ where: { group: { project: { organizationId } } } });
        await tx.sharedStepGroup.deleteMany({ where: { project: { organizationId } } });
      });
      await prisma.project.deleteMany({ where: { id: { in: projects } } });
    }
    if (users.length) {
      await prisma.membership.deleteMany({ where: { userId: { in: users } } });
      await prisma.user.deleteMany({ where: { id: { in: users } } });
    }
    if (organizations.length)
      await prisma.organization.deleteMany({
        where: { id: { in: organizations } },
      });
  });
  const request = () => ({
    projectId: projects[0]!,
    ids: [firstCase, secondCase],
    scope: "selected" as const,
    includeArchived: false,
  });

  it("allows an authorized read-only viewer to preserve exact procedures, metadata and selected order", async () => {
    const bundle = await viewer.testCases.exportProcedure({
      ...request(),
      ids: [secondCase, firstCase],
    });
    expect(bundle.cases.map((item) => item.id)).toEqual([
      secondCase,
      firstCase,
    ]);
    expect(bundle.cases[1]).toMatchObject({
      given: ["a|b"],
      when: ["action\nline"],
      background: "  exact\n背景 ",
      testType: "UNIT",
      automationStatus: "AUTOMATED",
      suitePath: "fixture/suite",
      validationDomain: "HIL",
      verificationProfile: { setup: "Synthetic rig" },
    });
    expect(bundle.cases[1]!.displayId).not.toBe("");
    expect(bundle.cases[1]!.prerequisites[0]!.id).toBe(secondCase);
    expect(
      decodeCaseProcedureExport(encodeCaseProcedureExport(bundle)),
    ).toEqual(bundle);
  });
  it("denies a foreign tenant and mixed foreign case IDs without partial exports", async () => {
    await expect(
      outsider.testCases.exportProcedure(request()),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      viewer.testCases.exportProcedure({
        ...request(),
        ids: [firstCase, foreignCase],
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(
      viewer.testCases.exportProcedure({
        ...request(),
        ids: [firstCase, firstCase],
      }),
    ).rejects.toThrow();
  });
  it("preserves reviewed archived scope and fails visibly when selection is unavailable", async () => {
    await prisma.testCase.update({
      where: { id: secondCase },
      data: { archived: true },
    });
    try {
      await expect(
        viewer.testCases.exportProcedure(request()),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(
        (
          await viewer.testCases.exportProcedure({
            ...request(),
            includeArchived: true,
          })
        ).cases[1]!.archived,
      ).toBe(true);
    } finally {
      await prisma.testCase.update({
        where: { id: secondCase },
        data: { archived: false },
      });
    }
  });
  it("does not export foreign shared-library contents or foreign case media", async () => {
    const group = await prisma.sharedStepGroup.create({
      data: {
        projectId: projects[1]!,
        name: "Foreign synthetic library",
        steps: [
          {
            order: 0,
            action: "Foreign synthetic content",
            expectedActionOrData: null,
            expectedResult: null,
            expectedResponse: null,
          },
        ],
      },
    });
    await prisma.testCase.update({
      where: { id: firstCase },
      data: { sharedStepGroupId: group.id },
    });
    try {
      await expect(
        viewer.testCases.exportProcedure(request()),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    } finally {
      await prisma.testCase.update({
        where: { id: firstCase },
        data: { sharedStepGroupId: null },
      });
    }
    const media = await prisma.testCaseAttachment.create({
      data: {
        testCaseId: foreignCase,
        fileName: "foreign-fixture.png",
        contentType: "image/png",
        storageUrl: "https://example.test/synthetic",
        sizeBytes: 12,
      },
    });
    await prisma.testCaseStep.updateMany({
      where: { testCaseId: firstCase },
      data: { mediaAttachmentIds: [media.id] },
    });
    try {
      await expect(
        viewer.testCases.exportProcedure(request()),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    } finally {
      await prisma.testCaseStep.updateMany({
        where: { testCaseId: firstCase },
        data: { mediaAttachmentIds: [] },
      });
    }
  });
});
