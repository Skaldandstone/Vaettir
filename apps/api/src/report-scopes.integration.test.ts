import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@vaettir/db";
import { appRouter } from "./router.js";
import { hardDeleteOrganization } from "./services/orgHardDelete.js";

const definition = {
  audience: "quality" as const,
  windowDays: 30 as const,
  sections: [
    "inventory",
    "execution",
    "traceability",
    "automation",
    "defects",
  ] as const,
  summary: "",
  risks: "",
  nextActions: "",
};
describe("recorded scope frozen reports (disposable database)", () => {
  let owner: ReturnType<typeof appRouter.createCaller>, outsider: typeof owner;
  let projectId: string,
    otherProjectId: string,
    planId: string,
    runId: string,
    caseId: string;
  const orgIds: string[] = [],
    userIds: string[] = [];
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
    for (const suffix of ["owner", "other"]) {
      const key = `report-scope-${randomUUID()}`;
      const org = await prisma.organization.create({
        data: { name: key, slug: key, planTierId: tier.id },
      });
      orgIds.push(org.id);
      const user = await prisma.user.create({
        data: {
          clerkUserId: key,
          email: `${key}@example.com`,
          memberships: { create: { organizationId: org.id, role: "OWNER" } },
        },
        include: { memberships: true },
      });
      userIds.push(user.id);
      const project = await prisma.project.create({
        data: { organizationId: org.id, name: key, slug: key },
      });
      const caller = appRouter.createCaller({ prisma, user });
      if (suffix === "owner") {
        owner = caller;
        projectId = project.id;
      } else {
        outsider = caller;
        otherProjectId = project.id;
      }
    }
    const type = await prisma.testPlanType.findFirstOrThrow();
    const plan = await prisma.testPlan.create({
      data: {
        projectId,
        name: "Synthetic PC protocol",
        testPlanTypeId: type.id,
      },
    });
    planId = plan.id;
    const ids: string[] = [];
    for (const title of ["Executed", "Blocked", "Not recorded"])
      ids.push(
        (
          await prisma.testCase.create({
            data: {
              projectId,
              testPlanId: planId,
              title,
              testType: "FUNCTIONAL",
              given: [],
              when: [],
              then: [],
              tags: [],
              priority: "HIGH",
            },
          })
        ).id,
      );
    caseId = ids[0]!;
    const run = await prisma.testRun.create({
      data: {
        projectId,
        ciProvider: "manual",
        branch: "manual",
        commitSha: "manual",
        status: "PARTIAL",
        startedAt: new Date("2020-01-15T23:59:59.999Z"),
        manualTestCaseIds: ids,
        executionContext: {
          version: 1,
          plan: { testPlanId: planId },
          configuration: { platform: "PC", environment: "lab", build: "v1" },
        },
      },
    });
    runId = run.id;
    await prisma.testResult.createMany({
      data: [
        { testRunId: runId, testCaseId: ids[0], status: "PASS" },
        { testRunId: runId, testCaseId: ids[1], status: "BLOCKED" },
        {
          testRunId: runId,
          testCaseId: null,
          externalTestId: "unmapped",
          status: "FAIL",
        },
      ],
    });
    await prisma.testRun.create({
      data: {
        projectId,
        ciProvider: "manual",
        branch: "manual",
        commitSha: "manual",
        startedAt: new Date("2020-01-16T00:00:00Z"),
        executionContext: {
          version: 1,
          configuration: { platform: "PC", environment: "lab", build: "v1" },
        },
      },
    });
  });
  afterAll(async () => {
    for (const id of orgIds)
      await hardDeleteOrganization(
        prisma,
        id,
        userIds[0]!,
        "Disposable synthetic report-scope fixture cleanup",
      );
    await prisma.organizationDeletionLog.deleteMany({
      where: { organizationId: { in: orgIds }, deletedById: { in: userIds } },
    });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });
  const capture = (executionScope: {
    planId?: string;
    runId?: string;
    platform?: string;
    environment?: string;
    build?: string;
  }) =>
    owner.reportSnapshots.preview({
      projectId,
      requestId: randomUUID(),
      title: "Scoped review",
      definition: {
        ...definition,
        sections: [...definition.sections],
        dateInterval: { start: "2020-01-15", end: "2020-01-15" },
        executionScope,
      },
    });
  it("selects the inclusive UTC boundary and preserves blocked/unmatched/unrecorded denominators", async () => {
    const row = await capture({
      planId,
      platform: "PC",
      environment: "lab",
      build: "v1",
    });
    expect(row.payload.windowEnd).toBe("2020-01-15T23:59:59.999Z");
    expect(row.payload.scope?.contributingRunIds).toEqual([runId]);
    expect(row.payload.inventory.active).toBe(3);
    expect(row.payload.execution).toMatchObject({
      runs: 1,
      results: 3,
      matchedResults: 2,
      unmatchedResults: 1,
      distinctCases: 1,
      highPriorityCases: 3,
      highPriorityExecuted: 1,
      plannedCaseRunPairs: 3,
      notRecordedCaseRunPairs: 1,
    });
    expect(row.payload.execution.outcomes).toEqual([
      { key: "BLOCKED", count: 1 },
      { key: "FAIL", count: 1 },
      { key: "PASS", count: 1 },
    ]);
    expect(row.payload.defects).toBeNull();
    expect(row.payload.limitations.join(" ")).toContain("excluded");
  });
  it("AND filters do not guess a missing configuration or equate CI commit with manual sentinel", async () => {
    expect(
      (await capture({ runId, platform: "Mobile" })).payload.execution.runs,
    ).toBe(0);
    expect(
      (await capture({ runId, build: "manual" })).payload.execution.runs,
    ).toBe(0);
    const ci = await prisma.testRun.create({
      data: {
        projectId,
        ciProvider: "synthetic-ci",
        commitSha: "ci-commit",
        branch: "main",
        startedAt: new Date("2020-01-15T09:00:00Z"),
      },
    });
    expect(
      (await capture({ runId: ci.id, build: "ci-commit" })).payload.execution
        .runs,
    ).toBe(1);
    expect(
      (await capture({ runId: ci.id, build: "ci-commit", platform: "PC" }))
        .payload.execution.runs,
    ).toBe(0);
  });
  it("plan's active case scope includes never recorded cases even when no runs match", async () => {
    const row = await capture({ planId, platform: "Mobile" });
    expect(row.payload.inventory.active).toBe(3);
    expect(row.payload.execution.distinctCases).toBe(0);
    expect(row.payload.execution.runs).toBe(0);
  });
  it("freezes exact scope through retries/approval and rejects changed request reuse", async () => {
    const input = {
      projectId,
      requestId: randomUUID(),
      title: "Exact private capture",
      definition: {
        ...definition,
        sections: [...definition.sections],
        dateInterval: { start: "2020-01-15", end: "2020-01-15" },
        executionScope: { runId },
      },
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
      owner.reportSnapshots.preview({
        ...input,
        definition: {
          ...input.definition,
          executionScope: { runId, platform: "PC" },
        },
      }),
    ).rejects.toThrow("changed");
    const approved = await owner.reportSnapshots.approve({
      projectId,
      previewId: first.id,
      approveSharing: true,
    });
    expect(approved.payload).toEqual({ ...first.payload, state: "approved" });
    expect((await capture({ planId })).payload.automationChange).toBeNull();
  });
  it("authorizes choices, exact run and plan identities against the same project", async () => {
    const choices = await owner.reportSnapshots.scopeOptions({ projectId });
    expect(choices.runs.find((row) => row.id === runId)).toMatchObject({
      platform: "PC",
      environment: "lab",
      build: "v1",
    });
    await expect(
      outsider.reportSnapshots.scopeOptions({ projectId }),
    ).rejects.toThrow();
    await expect(
      outsider.reportSnapshots.preview({
        projectId: otherProjectId,
        requestId: randomUUID(),
        title: "foreign",
        definition: {
          ...definition,
          sections: [...definition.sections],
          executionScope: { runId },
        },
      }),
    ).rejects.toThrow("Run not found");
    await expect(
      outsider.reportSnapshots.preview({
        projectId: otherProjectId,
        requestId: randomUUID(),
        title: "foreign",
        definition: {
          ...definition,
          sections: [...definition.sections],
          executionScope: { planId },
        },
      }),
    ).rejects.toThrow("Plan not found");
  });
  it("scoped requirements exclude unlinked project requirements rather than inventing coverage", async () => {
    await prisma.caseTraceabilityState.create({
      data: { projectId, organizationId: orgIds[0]! },
    });
    const requirement = await prisma.requirement.create({
      data: { projectId, title: "Explicitly tested requirement" },
    });
    await prisma.requirement.create({
      data: { projectId, title: "Unlinked project requirement" },
    });
    await prisma.caseTraceabilityLink.create({
      data: {
        id: randomUUID(),
        projectId,
        caseId,
        provider: "native",
        providerOrigin: "https://synthetic.invalid",
        nativeId: requirement.id,
        kind: "feature",
        title: requirement.title,
        requirementId: requirement.id,
        createdById: userIds[0]!,
        updatedById: userIds[0]!,
      },
    });
    const scoped = await capture({ runId });
    expect(scoped.payload.traceability).toEqual({
      requirements: 1,
      coveredRequirements: 1,
      links: 1,
      casesWithLinks: 1,
    });
    const project = await owner.reportSnapshots.preview({
      projectId,
      requestId: randomUUID(),
      title: "Whole project",
      definition: { ...definition, sections: [...definition.sections] },
    });
    expect(project.payload.traceability.requirements).toBe(2);
  });
  it("locates an identical approved scope across intervening unrelated reports", async () => {
    const plan = await capture({ planId });
    const approved = await owner.reportSnapshots.approve({
      projectId,
      previewId: plan.id,
      approveSharing: true,
    });
    const different = await capture({ runId });
    await owner.reportSnapshots.approve({
      projectId,
      previewId: different.id,
      approveSharing: true,
    });
    const next = await capture({ planId });
    expect(next.payload.automationChange?.baselineId).toBe(approved.id);
    expect(next.payload.automationChange?.commonCases).toBe(3);
  });
  it("drills down frozen counts and labels after later case/result edits without recomputing", async () => {
    const preview = await capture({ runId });
    const original = await prisma.testCase.findUniqueOrThrow({
      where: { id: caseId },
    });
    const before = await owner.reportSnapshots.evidence({
      projectId,
      id: preview.id,
      kind: "cases",
      page: 0,
    });
    expect(before.complete).toBe(true);
    expect(before.total).toBe(3);
    const captured = before.items.find((c) => c.id === caseId)!;
    expect(captured.outcomes).toEqual([{ key: "PASS", count: 1 }]);
    try {
      await prisma.testCase.update({
        where: { id: caseId },
        data: {
          priority: "LOW",
          automationStatus: "AUTOMATED",
          title: "Changed after capture",
        },
      });
      await prisma.testResult.updateMany({
        where: { testRunId: runId, testCaseId: caseId },
        data: { status: "FAIL" },
      });
      const after = await owner.reportSnapshots.evidence({
        projectId,
        id: preview.id,
        kind: "cases",
        page: 0,
      });
      expect(after.items.find((c) => c.id === caseId)).toEqual(captured);
      const runs = await owner.reportSnapshots.evidence({
        projectId,
        id: preview.id,
        kind: "runs",
        page: 0,
      });
      expect(runs.items[0]).toMatchObject({
        id: runId,
        plannedCases: 3,
        notRecordedCases: 1,
        outcomes: [
          { key: "BLOCKED", count: 1 },
          { key: "FAIL", count: 1 },
          { key: "PASS", count: 1 },
        ],
      });
      expect(
        (await owner.reportSnapshots.get({ projectId, id: preview.id })).payload
          .execution.distinctCases,
      ).toBe(1);
    } finally {
      await prisma.testCase.update({
        where: { id: caseId },
        data: {
          priority: original.priority,
          automationStatus: original.automationStatus,
          title: original.title,
        },
      });
      await prisma.testResult.updateMany({
        where: { testRunId: runId, testCaseId: caseId },
        data: { status: "PASS" },
      });
    }
  });
  it("authorizes Viewer evidence at read time; private previews and foreign snapshots never leak", async () => {
    const key = `report-viewer-${randomUUID()}`;
    const user = await prisma.user.create({
      data: {
        clerkUserId: key,
        email: `${key}@example.com`,
        memberships: {
          create: {
            organizationId: orgIds[0]!,
            role: "VIEWER",
            seatType: "READ_ONLY",
          },
        },
      },
      include: { memberships: true },
    });
    userIds.push(user.id);
    const viewer = appRouter.createCaller({ prisma, user });
    const preview = await capture({ runId });
    await expect(
      viewer.reportSnapshots.evidence({
        projectId,
        id: preview.id,
        kind: "cases",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const approved = await owner.reportSnapshots.approve({
      projectId,
      previewId: preview.id,
      approveSharing: true,
    });
    expect(
      (
        await viewer.reportSnapshots.evidence({
          projectId,
          id: approved.id,
          kind: "cases",
        })
      ).total,
    ).toBe(3);
    await expect(
      outsider.reportSnapshots.evidence({
        projectId,
        id: approved.id,
        kind: "cases",
      }),
    ).rejects.toBeDefined();
    await expect(
      outsider.reportSnapshots.evidence({
        projectId: otherProjectId,
        id: approved.id,
        kind: "runs",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await prisma.membership.delete({
      where: {
        organizationId_userId: { organizationId: orgIds[0]!, userId: user.id },
      },
    });
    await expect(
      viewer.reportSnapshots.evidence({
        projectId,
        id: approved.id,
        kind: "cases",
      }),
    ).rejects.toBeDefined();
  });
  it("legacy facts remain unavailable and disappeared/foreign records cannot become native links", async () => {
    const preview = await capture({ runId });
    const legacy = { ...preview.payload };
    delete legacy.evidence;
    legacy.cohort = [
      { id: caseId, status: "MANUAL" },
      { id: "removed-synthetic-native", status: "MANUAL" },
    ];
    legacy.scope = {
      ...legacy.scope!,
      contributingRunIds: [runId, "removed-run-native"],
    };
    await prisma.projectReportSnapshot.update({
      where: { id: preview.id },
      data: { payload: legacy },
    });
    const cases = await owner.reportSnapshots.evidence({
      projectId,
      id: preview.id,
      kind: "cases",
    });
    expect(cases.complete).toBe(false);
    expect(cases.items[0]).toMatchObject({
      id: caseId,
      outcomes: null,
      priority: null,
    });
    expect(cases.items[1]).toMatchObject({
      id: null,
      available: false,
      outcomes: null,
    });
    expect(JSON.stringify(cases)).not.toContain("removed-synthetic-native");
    const runs = await owner.reportSnapshots.evidence({
      projectId,
      id: preview.id,
      kind: "runs",
    });
    expect(runs.items[1]).toMatchObject({
      id: null,
      available: false,
      startedAt: null,
      outcomes: null,
    });
    expect(JSON.stringify(runs)).not.toContain("removed-run-native");
    const foreign = await prisma.testCase.create({
      data: {
        projectId: otherProjectId,
        title: "Foreign synthetic",
        testType: "FUNCTIONAL",
        given: [],
        when: [],
        then: [],
        tags: [],
      },
    });
    legacy.cohort = [{ id: foreign.id, status: "MANUAL" }];
    await prisma.projectReportSnapshot.update({
      where: { id: preview.id },
      data: { payload: legacy },
    });
    const hidden = await owner.reportSnapshots.evidence({
      projectId,
      id: preview.id,
      kind: "cases",
    });
    expect(hidden.items[0]?.id).toBeNull();
    expect(JSON.stringify(hidden)).not.toContain(foreign.id);
  });
  it("pages only captured identities, not cases added after capture", async () => {
    await prisma.testCase.createMany({
      data: Array.from({ length: 55 }, (_, index) => ({
        projectId,
        testPlanId: planId,
        title: `Synthetic paging ${index}`,
        testType: "FUNCTIONAL" as const,
        given: [],
        when: [],
        then: [],
        tags: [],
      })),
    });
    const preview = await capture({ planId });
    const one = await owner.reportSnapshots.evidence({
      projectId,
      id: preview.id,
      kind: "cases",
      page: 0,
    });
    const two = await owner.reportSnapshots.evidence({
      projectId,
      id: preview.id,
      kind: "cases",
      page: 1,
    });
    expect(one.total).toBe(58);
    expect(one.items).toHaveLength(50);
    expect(two.items).toHaveLength(8);
    expect(new Set([...one.items, ...two.items].map((c) => c.id)).size).toBe(
      58,
    );
    await prisma.testCase.create({
      data: {
        projectId,
        testPlanId: planId,
        title: "Added after capture",
        testType: "FUNCTIONAL",
        given: [],
        when: [],
        then: [],
        tags: [],
      },
    });
    expect(
      (
        await owner.reportSnapshots.evidence({
          projectId,
          id: preview.id,
          kind: "cases",
          page: 1,
        })
      ).items,
    ).toEqual(two.items);
    await expect(
      owner.reportSnapshots.evidence({
        projectId,
        id: preview.id,
        kind: "cases",
        page: 401,
      }),
    ).rejects.toBeDefined();
  });
  it("rechecks suspension and project ownership before returning captured links", async () => {
    const preview = await capture({ runId });
    try {
      await prisma.organization.update({
        where: { id: orgIds[0]! },
        data: { suspendedAt: new Date() },
      });
      await expect(
        owner.reportSnapshots.evidence({
          projectId,
          id: preview.id,
          kind: "runs",
        }),
      ).rejects.toBeDefined();
    } finally {
      await prisma.organization.update({
        where: { id: orgIds[0]! },
        data: { suspendedAt: null },
      });
    }
    try {
      await prisma.project.update({
        where: { id: projectId },
        data: { organizationId: orgIds[1]! },
      });
      await expect(
        owner.reportSnapshots.evidence({
          projectId,
          id: preview.id,
          kind: "cases",
        }),
      ).rejects.toBeDefined();
    } finally {
      await prisma.project.update({
        where: { id: projectId },
        data: { organizationId: orgIds[0]! },
      });
    }
    expect(
      (
        await owner.reportSnapshots.evidence({
          projectId,
          id: preview.id,
          kind: "runs",
        })
      ).items[0]?.id,
    ).toBe(runId);
  });
  it("rejects oversized provider metadata before evidence materialization and leaves no receipt", async () => {
    const requestId = randomUUID();
    try {
      await prisma.testRun.update({
        where: { id: runId },
        data: { ciProvider: "x".repeat(201) },
      });
      await expect(
        owner.reportSnapshots.preview({
          projectId,
          requestId,
          title: "Oversized provider",
          definition: {
            ...definition,
            sections: [...definition.sections],
            dateInterval: { start: "2020-01-15", end: "2020-01-15" },
            executionScope: { runId },
          },
        }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(
        await prisma.projectReportSnapshot.count({
          where: { projectId, title: "Oversized provider" },
        }),
      ).toBe(0);
    } finally {
      await prisma.testRun.update({
        where: { id: runId },
        data: { ciProvider: "manual" },
      });
    }
  });
});
