import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { prisma } from "@vaettir/db";
import { appRouter } from "./router.js";

const stamp = `report-snapshot-${Date.now()}`;
const definition = {
  audience: "stakeholders" as const,
  windowDays: 30 as const,
  sections: ["inventory", "execution", "traceability", "automation"] as (
    "inventory" | "execution" | "traceability" | "automation"
  )[],
  summary: "Synthetic review",
  risks: "No runtime claim",
  nextActions: "Confirm gaps",
};
describe("frozen reviewed reports", () => {
  let projectId: string;
  let orgId: string;
  let otherOrgId: string;
  let ownerId: string;
  let caseId: string;
  let owner: ReturnType<typeof appRouter.createCaller>;
  let viewer: ReturnType<typeof appRouter.createCaller>;
  let other: ReturnType<typeof appRouter.createCaller>;
  const users: string[] = [];
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
    orgId = (
      await prisma.organization.create({
        data: { name: stamp, slug: stamp, planTierId: tier.id },
      })
    ).id;
    otherOrgId = (
      await prisma.organization.create({
        data: {
          name: `${stamp}-other`,
          slug: `${stamp}-other`,
          planTierId: tier.id,
        },
      })
    ).id;
    projectId = (
      await prisma.project.create({
        data: {
          organizationId: orgId,
          name: "Synthetic intelligence",
          slug: stamp,
        },
      })
    ).id;
    for (const [suffix, organizationId, role] of [
      ["owner", orgId, "OWNER"],
      ["viewer", orgId, "VIEWER"],
      ["other", otherOrgId, "OWNER"],
    ] as const) {
      const user = await prisma.user.create({
        data: {
          clerkUserId: `${stamp}-${suffix}`,
          email: `${stamp}-${suffix}@example.com`,
          memberships: { create: { organizationId, role } },
        },
        include: { memberships: true },
      });
      users.push(user.id);
      const caller = appRouter.createCaller({ prisma, user });
      if (suffix === "owner") {
        owner = caller;
        ownerId = user.id;
      } else if (suffix === "viewer") viewer = caller;
      else other = caller;
    }
    caseId = (
      await prisma.testCase.create({
        data: {
          projectId,
          title: "Synthetic critical checkout",
          testType: "FUNCTIONAL",
          given: [],
          when: [],
          then: [],
          tags: [],
          priority: "HIGH",
          automationStatus: "MANUAL",
        },
      })
    ).id;
    const run = await prisma.testRun.create({
      data: {
        projectId,
        ciProvider: "synthetic",
        branch: "fixture",
        commitSha: "fixture",
        startedAt: new Date(),
        status: "PARTIAL",
      },
    });
    await prisma.testResult.create({
      data: { testRunId: run.id, testCaseId: caseId, status: "SKIP" },
    });
  });
  afterAll(async () => {
    if (projectId) {
      await prisma.testResult.deleteMany({ where: { testRun: { projectId } } });
      await prisma.testRun.deleteMany({ where: { projectId } });
      await prisma.testCase.deleteMany({ where: { projectId } });
      await prisma.project.deleteMany({ where: { id: projectId } });
    }
    await prisma.membership.deleteMany({ where: { userId: { in: users } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    if (orgId)
      await prisma.organization.deleteMany({
        where: { id: { in: [orgId, otherOrgId] } },
      });
  });
  const preview = () =>
    owner.reportSnapshots.preview({
      projectId,
      requestId: randomUUID(),
      title: "Stakeholder review",
      definition,
    });
  it("denies foreign tenants and viewer writes; private preview is not shared", async () => {
    await expect(other.reportSnapshots.list({ projectId })).rejects.toThrow();
    await expect(
      viewer.reportSnapshots.preview({
        projectId,
        requestId: randomUUID(),
        title: "Denied",
        definition,
      }),
    ).rejects.toThrow();
    const draft = await preview();
    expect(await viewer.reportSnapshots.list({ projectId })).toHaveLength(0);
    await expect(
      viewer.reportSnapshots.get({ projectId, id: draft.id }),
    ).rejects.toThrow();
    expect(
      (await owner.reportSnapshots.get({ projectId, id: draft.id })).payload
        .state,
    ).toBe("preview");
  });
  it("preview retries freeze exact payload and reject changed request reuse", async () => {
    const input = {
      projectId,
      requestId: randomUUID(),
      title: "Durable",
      definition,
    };
    const first = await owner.reportSnapshots.preview(input);
    await prisma.testCase.update({
      where: { id: caseId },
      data: { automationStatus: "AUTOMATED" },
    });
    expect((await owner.reportSnapshots.preview(input)).payload).toEqual(
      first.payload,
    );
    await expect(
      owner.reportSnapshots.preview({ ...input, title: "Changed" }),
    ).rejects.toThrow("changed");
    await prisma.testCase.update({
      where: { id: caseId },
      data: { automationStatus: "MANUAL" },
    });
  });
  it("approval is immutable/idempotent and SKIP is not executed coverage", async () => {
    const draft = await preview();
    expect(draft.payload.execution.highPriorityCases).toBe(1);
    expect(draft.payload.execution.highPriorityExecuted).toBe(0);
    expect(draft.payload.execution.results).toBe(1);
    const result = await owner.reportSnapshots.approve({
      projectId,
      previewId: draft.id,
      approveSharing: true,
    });
    expect(result.payload.state).toBe("approved");
    expect(result.payload.asOf).toBe(draft.payload.asOf);
    expect(
      (
        await owner.reportSnapshots.approve({
          projectId,
          previewId: draft.id,
          approveSharing: true,
        })
      ).id,
    ).toBe(result.id);
    await prisma.testCase.update({
      where: { id: caseId },
      data: { automationStatus: "AUTOMATED", title: "New human title" },
    });
    expect(
      (await viewer.reportSnapshots.get({ projectId, id: result.id })).payload,
    ).toEqual(result.payload);
    await expect(
      other.reportSnapshots.get({ projectId, id: result.id }),
    ).rejects.toThrow();
  });
  it("automation gains compare stable identities and expose denominator drift", async () => {
    const added = await prisma.testCase.create({
      data: {
        projectId,
        title: "New automatic case",
        testType: "UNIT",
        given: [],
        when: [],
        then: [],
        tags: [],
        automationStatus: "AUTOMATED",
      },
    });
    const next = await preview();
    expect(next.payload.automationChange).toMatchObject({
      commonCases: 1,
      becameAutomated: 1,
      noLongerAutomated: 0,
      addedCases: 1,
      removedCases: 0,
    });
    await prisma.testCase.delete({ where: { id: added.id } });
  });
  it("definitions are private, reusable and protected by compare-and-swap", async () => {
    const saved = await owner.reportSnapshots.saveDefinition({
      projectId,
      requestId: randomUUID(),
      name: "Weekly",
      definition,
    });
    expect(
      await viewer.reportSnapshots.definitions({ projectId }),
    ).toHaveLength(0);
    const [row] = await owner.reportSnapshots.definitions({ projectId });
    expect(row?.id).toBe(saved.id);
    const draft = await owner.reportSnapshots.preview({
      projectId,
      requestId: randomUUID(),
      title: "Reusable",
      definition,
      definitionId: saved.id,
    });
    expect(draft.payload.definition).toEqual(definition);
    const update = {
      projectId,
      requestId: randomUUID(),
      id: saved.id,
      version: 1,
      name: "Weekly revised",
      definition,
    };
    const applied = await owner.reportSnapshots.saveDefinition(update);
    expect(await owner.reportSnapshots.saveDefinition(update)).toEqual(applied);
    await owner.reportSnapshots.saveDefinition({
      ...update,
      requestId: randomUUID(),
      version: 2,
      name: "Later human edit",
    });
    expect(await owner.reportSnapshots.saveDefinition(update)).toEqual(applied);
    expect(
      (await owner.reportSnapshots.definitions({ projectId }))[0]?.name,
    ).toBe("Later human edit");
    await expect(
      owner.reportSnapshots.saveDefinition({
        projectId,
        requestId: randomUUID(),
        id: saved.id,
        version: 1,
        name: "Stale",
        definition,
      }),
    ).rejects.toThrow("changed");
  });
  it("fresh authorization defeats cached owner and preserves recovery state", async () => {
    const draft = await preview();
    await prisma.membership.update({
      where: {
        organizationId_userId: { organizationId: orgId, userId: ownerId },
      },
      data: { role: "VIEWER" },
    });
    await expect(
      owner.reportSnapshots.approve({
        projectId,
        previewId: draft.id,
        approveSharing: true,
      }),
    ).rejects.toThrow("access changed");
    await prisma.membership.delete({
      where: {
        organizationId_userId: { organizationId: orgId, userId: ownerId },
      },
    });
    await expect(
      owner.reportSnapshots.get({ projectId, id: draft.id }),
    ).rejects.toThrow();
    await prisma.membership.create({
      data: { organizationId: orgId, userId: ownerId, role: "OWNER" },
    });
    await prisma.membership.update({
      where: {
        organizationId_userId: { organizationId: orgId, userId: ownerId },
      },
      data: { seatType: "READ_ONLY" },
    });
    await expect(
      owner.reportSnapshots.approve({
        projectId,
        previewId: draft.id,
        approveSharing: true,
      }),
    ).rejects.toThrow("access changed");
    await prisma.membership.update({
      where: {
        organizationId_userId: { organizationId: orgId, userId: ownerId },
      },
      data: { seatType: "FULL" },
    });
    expect(
      (
        await owner.reportSnapshots.approve({
          projectId,
          previewId: draft.id,
          approveSharing: true,
        })
      ).payload.state,
    ).toBe("approved");
    await prisma.organization.update({
      where: { id: orgId },
      data: { suspendedAt: new Date() },
    });
    await expect(viewer.reportSnapshots.list({ projectId })).rejects.toThrow();
    await prisma.organization.update({
      where: { id: orgId },
      data: { suspendedAt: null },
    });
  });
  it("workspace reparenting does not expose retained definitions or snapshot notes", async () => {
    const draft = await preview();
    await prisma.membership.create({
      data: { organizationId: otherOrgId, userId: ownerId, role: "OWNER" },
    });
    const fresh = appRouter.createCaller({
      prisma,
      user: await prisma.user.findUniqueOrThrow({
        where: { id: ownerId },
        include: { memberships: true },
      }),
    });
    await prisma.project.update({
      where: { id: projectId },
      data: { organizationId: otherOrgId },
    });
    expect(await fresh.reportSnapshots.definitions({ projectId })).toHaveLength(
      0,
    );
    expect(await fresh.reportSnapshots.list({ projectId })).toHaveLength(0);
    await expect(
      fresh.reportSnapshots.get({ projectId, id: draft.id }),
    ).rejects.toThrow();
    await expect(
      fresh.reportSnapshots.approve({
        projectId,
        previewId: draft.id,
        approveSharing: true,
      }),
    ).rejects.toThrow();
    await prisma.caseTraceabilityState.create({
      data: { projectId, organizationId: orgId },
    });
    await expect(
      fresh.reportSnapshots.preview({
        projectId,
        requestId: randomUUID(),
        title: "Wrong workspace",
        definition,
      }),
    ).rejects.toThrow("previous workspace");
    await prisma.caseTraceabilityState.delete({ where: { projectId } });
    await prisma.defectMapState.create({
      data: {
        projectId,
        organizationId: orgId,
        document: { signals: [], tasks: [], decisions: [] },
      },
    });
    await expect(
      fresh.reportSnapshots.preview({
        projectId,
        requestId: randomUUID(),
        title: "Wrong evidence workspace",
        definition,
      }),
    ).rejects.toThrow("previous workspace");
    await prisma.project.update({
      where: { id: projectId },
      data: { organizationId: orgId },
    });
    await prisma.membership.delete({
      where: {
        organizationId_userId: { organizationId: otherOrgId, userId: ownerId },
      },
    });
  });
});
