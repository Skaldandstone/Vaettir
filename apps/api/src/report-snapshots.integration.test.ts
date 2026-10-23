import { createHash, randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { prisma, type Prisma } from "@vaettir/db";
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
  // Authored source only, UNEXECUTED 2026-10-04.
  it("captures complete release planned scope, keeps empty releases empty and retains captured membership after native unlink", async () => {
    const type = await prisma.testPlanType.findFirstOrThrow();
    const release = await prisma.release.create({
      data: { projectId, name: `${stamp} release` },
    });
    const empty = await prisma.release.create({
      data: { projectId, name: `${stamp} empty release` },
    });
    let planId: string | undefined;
    try {
      const plan = await prisma.testPlan.create({
        data: {
          projectId,
          releaseId: release.id,
          testPlanTypeId: type.id,
          name: `${stamp} saved planned cases`,
          executionTemplate: {
            version: 1,
            testCaseIds: [caseId],
            configurations: [],
          },
        },
      });
      planId = plan.id;
      const capture = await owner.reportSnapshots.preview({
        projectId,
        requestId: randomUUID(),
        title: "Synthetic release cohort",
        definition: {
          ...definition,
          executionScope: { releaseId: release.id },
        },
      });
      expect(capture.payload.inventory.active).toBe(1);
      expect(capture.payload.execution.runs).toBe(0);
      expect(capture.payload.scope).toMatchObject({
        filters: { releaseId: release.id },
        releasePlanIds: [plan.id],
        releaseName: release.name,
      });
      const none = await owner.reportSnapshots.preview({
        projectId,
        requestId: randomUUID(),
        title: "Synthetic empty release cohort",
        definition: { ...definition, executionScope: { releaseId: empty.id } },
      });
      expect(none.payload.inventory.active).toBe(0);
      expect(none.payload.execution.runs).toBe(0);
      expect(none.payload.scope?.releasePlanIds).toEqual([]);
      await expect(
        owner.reportSnapshots.preview({
          projectId,
          requestId: randomUUID(),
          title: "Incompatible native scopes",
          definition: {
            ...definition,
            executionScope: { releaseId: empty.id, planId: plan.id },
          },
        }),
      ).rejects.toThrow("does not currently belong");
      await prisma.testPlan.update({
        where: { id: plan.id },
        data: { releaseId: null },
      });
      const retained = await owner.reportSnapshots.get({
        projectId,
        id: capture.id,
      });
      expect(retained.payload.scope?.releasePlanIds).toEqual([plan.id]);
      expect(retained.payload.inventory.active).toBe(1);
      const current = await owner.reportSnapshots.preview({
        projectId,
        requestId: randomUUID(),
        title: "Synthetic changed release cohort",
        definition: {
          ...definition,
          executionScope: { releaseId: release.id },
        },
      });
      expect(current.payload.inventory.active).toBe(0);
    } finally {
      if (planId)
        await prisma.testPlan.deleteMany({ where: { id: planId, projectId } });
      await prisma.release.deleteMany({
        where: { id: { in: [release.id, empty.id] }, projectId },
      });
    }
  });
  it("catalog browses all pages, filters approved metadata and never exposes private or original-foreign snapshots", async () => {
    const search = `${stamp} catalog`;
    const base = await owner.reportSnapshots.preview({
      projectId,
      requestId: randomUUID(),
      title: `${search} private`,
      definition,
    });
    const ids: string[] = [];
    const makeId = (suffix: string) =>
      createHash("sha256").update(`${search}-${suffix}`).digest("hex");
    try {
      for (let i = 0; i < 45; i++) {
        const id = makeId(String(i));
        ids.push(id);
        await prisma.projectReportSnapshot.create({
          data: {
            id,
            projectId,
            organizationId: orgId,
            createdById: ownerId,
            inputHash: randomUUID(),
            title: `${search} ${String(i).padStart(2, "0")}`,
            asOf: new Date(base.payload.asOf),
            payload: {
              ...base.payload,
              state: "approved",
              definition: {
                ...definition,
                audience: ["quality", "engineering", "stakeholders"][i % 3],
                templateId: "quality-status",
              },
            } as Prisma.InputJsonValue,
          },
        });
      }
      for (const [suffix, organizationId] of [
        ["literal", orgId],
        ["foreign", otherOrgId],
      ] as const) {
        const id = makeId(suffix);
        ids.push(id);
        await prisma.projectReportSnapshot.create({
          data: {
            id,
            projectId,
            organizationId,
            createdById: ownerId,
            inputHash: randomUUID(),
            title: `${search} ${suffix}%_`,
            asOf: new Date(base.payload.asOf),
            payload: {
              ...base.payload,
              state: "approved",
            } as Prisma.InputJsonValue,
          },
        });
      }
      const pages = await Promise.all(
        [0, 1, 2].map((page) =>
          viewer.reportSnapshots.catalog({
            projectId,
            search,
            page,
            sort: "title-asc",
          }),
        ),
      );
      expect(pages.map((page) => page.items.length)).toEqual([20, 20, 6]);
      expect(pages.map((page) => page.total)).toEqual([46, 46, 46]);
      const all = pages.flatMap((page) => page.items);
      expect(new Set(all.map((row) => row.id)).size).toBe(46);
      expect(
        all.every((row) => row.id !== base.id && row.id !== makeId("foreign")),
      ).toBe(true);
      expect(all[0]?.title).toBe(`${search} 00`);
      expect(
        (
          await viewer.reportSnapshots.catalog({
            projectId,
            search,
            audience: "quality",
          })
        ).total,
      ).toBe(15);
      expect(
        (
          await viewer.reportSnapshots.catalog({
            projectId,
            search,
            purpose: "quality-status",
          })
        ).total,
      ).toBe(45);
      expect(
        (
          await viewer.reportSnapshots.catalog({
            projectId,
            search,
            purpose: "custom",
          })
        ).total,
      ).toBe(1);
      const literal = await viewer.reportSnapshots.catalog({
        projectId,
        search: "literal%_",
      });
      expect(literal.items.map((row) => row.id)).toEqual([makeId("literal")]);
      const day = base.payload.asOf.slice(0, 10);
      expect(
        (
          await viewer.reportSnapshots.catalog({
            projectId,
            search,
            capturedInterval: { start: day, end: day },
          })
        ).total,
      ).toBe(46);
      expect(Object.keys(all[0]!).sort()).toEqual(
        ["asOf", "audience", "id", "purpose", "title"].sort(),
      );
      await expect(
        other.reportSnapshots.catalog({ projectId, search }),
      ).rejects.toThrow();
    } finally {
      await prisma.projectReportSnapshot.deleteMany({
        where: { projectId, id: { in: [...ids, base.id] } },
      });
    }
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
  it("catalog rejects suspended or revoked membership using the original caller", async () => {
    await prisma.organization.update({
      where: { id: orgId },
      data: { suspendedAt: new Date() },
    });
    try {
      await expect(
        viewer.reportSnapshots.catalog({ projectId }),
      ).rejects.toThrow();
    } finally {
      await prisma.organization.update({
        where: { id: orgId },
        data: { suspendedAt: null },
      });
    }
    const member = await prisma.membership.findFirstOrThrow({
      where: { organizationId: orgId, role: "VIEWER" },
    });
    await prisma.membership.delete({ where: { id: member.id } });
    try {
      await expect(
        viewer.reportSnapshots.catalog({ projectId }),
      ).rejects.toThrow();
    } finally {
      await prisma.membership.create({ data: member });
    }
  });
  it("compares only approved original-tenant captures under current membership, without private payload or invented zero evidence", async () => {
    // Authored tonight; execution is deferred to morning validation.
    const base = await owner.reportSnapshots.preview({
      projectId,
      requestId: randomUUID(),
      title: "Private comparison fixture",
      definition,
    });
    const ids = ["before", "after", "original-foreign"].map((suffix) =>
      createHash("sha256").update(`${stamp}-compare-${suffix}`).digest("hex"),
    );
    try {
      for (let i = 0; i < ids.length; i++) {
        const asOf = new Date(`2026-10-0${i + 1}T12:00:00.000Z`);
        await prisma.projectReportSnapshot.create({
          data: {
            id: ids[i]!,
            projectId,
            organizationId: i === 2 ? otherOrgId : orgId,
            createdById: ownerId,
            inputHash: randomUUID(),
            title: `Synthetic comparison ${i}`,
            asOf,
            payload: {
              ...base.payload,
              state: "approved",
              asOf: asOf.toISOString(),
              windowStart: "2026-09-01T00:00:00.000Z",
              windowEnd: "2026-09-30T23:59:59.999Z",
              definition: {
                ...definition,
                summary: "Do not export private author commentary",
              },
              execution: { ...base.payload.execution, results: i + 1 },
            } as unknown as Prisma.InputJsonValue,
          },
        });
      }
      const input = { projectId, baselineId: ids[0]!, targetId: ids[1]! };
      const compared = await viewer.reportSnapshots.compare(input);
      expect(
        compared.rows.find((row) => row.label === "Recorded results")?.delta,
      ).toBe(1);
      expect(compared.sameExecutionWindow).toBe(true);
      expect(JSON.stringify(compared)).not.toContain(
        "Do not export private author commentary",
      );
      expect(JSON.stringify(compared)).not.toContain(caseId);
      await expect(
        viewer.reportSnapshots.compare({ ...input, baselineId: base.id }),
      ).rejects.toThrow();
      await expect(
        viewer.reportSnapshots.compare({ ...input, targetId: ids[2]! }),
      ).rejects.toThrow();
      await expect(other.reportSnapshots.compare(input)).rejects.toThrow();
      await expect(
        viewer.reportSnapshots.compare({
          ...input,
          baselineId: ids[1]!,
          targetId: ids[0]!,
        }),
      ).rejects.toThrow();
      const member = await prisma.membership.findFirstOrThrow({
        where: { organizationId: orgId, role: "VIEWER" },
      });
      await prisma.membership.delete({ where: { id: member.id } });
      try {
        await expect(viewer.reportSnapshots.compare(input)).rejects.toThrow();
      } finally {
        await prisma.membership.create({ data: member });
      }
    } finally {
      await prisma.projectReportSnapshot.deleteMany({
        where: { id: { in: [...ids, base.id] }, projectId },
      });
    }
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
    const recovered = await viewer.reportSnapshots.get({
      projectId,
      id: result.id,
    });
    expect(recovered.payload).toEqual(result.payload);
    expect(recovered).toMatchObject({
      id: result.id,
      projectId,
      organizationId: orgId,
    });
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
