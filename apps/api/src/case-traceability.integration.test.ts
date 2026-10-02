import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@vaettir/db";
import { caseTraceabilityRouter } from "./routers/caseTraceability.js";
import { testCasesRouter } from "./routers/testCases.js";
import { requirementsRouter } from "./routers/requirements.js";

describe("manually confirmed case traceability", () => {
  const stamp = `case-trace-${Date.now()}`;
  let projectId: string,
    otherProjectId: string,
    orgId: string,
    otherOrgId: string,
    caseId: string,
    secondCaseId: string,
    requirementId: string,
    foreignRequirementId: string,
    actorId: string;
  const actors: string[] = [];
  let owner: ReturnType<typeof caseTraceabilityRouter.createCaller>,
    viewer: ReturnType<typeof caseTraceabilityRouter.createCaller>,
    outsider: ReturnType<typeof caseTraceabilityRouter.createCaller>;
  let ownerCases: ReturnType<typeof testCasesRouter.createCaller>;
  let ownerRequirements: ReturnType<typeof requirementsRouter.createCaller>;
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
    if (
      !["127.0.0.1", "localhost"].includes(url.hostname) ||
      !/test/i.test(url.pathname) ||
      url.searchParams.has("host")
    )
      throw Error("Use a synthetic disposable loopback database");
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
          name: "Synthetic feature coverage",
          slug: stamp,
        },
      })
    ).id;
    otherProjectId = (
      await prisma.project.create({
        data: {
          organizationId: otherOrgId,
          name: "Other",
          slug: `${stamp}-other`,
        },
      })
    ).id;
    const cases = await Promise.all(
      ["Premium login", "Failed payment"].map((title) =>
        prisma.testCase.create({
          data: {
            projectId,
            title,
            testType: "FUNCTIONAL",
            given: [],
            when: [],
            then: [],
            tags: [],
          },
        }),
      ),
    );
    [caseId, secondCaseId] = cases.map((row) => row.id) as [string, string];
    requirementId = (
      await prisma.requirement.create({
        data: { projectId, title: "Premium users can sign in" },
      })
    ).id;
    foreignRequirementId = (
      await prisma.requirement.create({
        data: { projectId: otherProjectId, title: "Private other requirement" },
      })
    ).id;
    for (const [suffix, organizationId, role] of [
      ["owner", orgId, "OWNER"],
      ["viewer", orgId, "VIEWER"],
      ["outsider", otherOrgId, "OWNER"],
    ] as const) {
      const user = await prisma.user.create({
        data: {
          email: `${stamp}-${suffix}@example.com`,
          clerkUserId: `${stamp}-${suffix}`,
          memberships: { create: { organizationId, role } },
        },
        include: { memberships: true },
      });
      actors.push(user.id);
      const caller = caseTraceabilityRouter.createCaller({ prisma, user });
      if (suffix === "owner") {
        owner = caller;
        actorId = user.id;
        ownerCases = testCasesRouter.createCaller({ prisma, user });
        ownerRequirements = requirementsRouter.createCaller({ prisma, user });
      } else if (suffix === "viewer") viewer = caller;
      else outsider = caller;
    }
  });
  afterAll(async () => {
    if (!orgId) return;
    const scoped = { organizationId: { in: [orgId, otherOrgId] } };
    await prisma.caseTraceabilityState.deleteMany({
      where: { projectId: { in: [projectId, otherProjectId] } },
    });
    await prisma.auditLog.deleteMany({ where: scoped });
    await prisma.testCase.deleteMany({
      where: { projectId: { in: [projectId, otherProjectId] } },
    });
    await prisma.requirement.deleteMany({
      where: { projectId: { in: [projectId, otherProjectId] } },
    });
    await prisma.project.deleteMany({ where: scoped });
    await prisma.membership.deleteMany({ where: scoped });
    await prisma.user.deleteMany({ where: { id: { in: actors } } });
    await prisma.organization.deleteMany({
      where: { id: { in: [orgId, otherOrgId] } },
    });
  });
  const target = {
    provider: "jira" as const,
    nativeId: "PREM-42",
    kind: "feature" as const,
    title: "Premium login feature",
    url: "https://one.example.com/browse/PREM-42",
  };
  const input = async (selected = target, selectedCase = caseId) => ({
    projectId,
    caseId: selectedCase,
    version: (await owner.forCase({ projectId, caseId: selectedCase })).version,
    requestId: randomUUID(),
    target: selected,
    approveLink: true as const,
  });

  it("distinguishes native IDs by exact provider origin and provides reciprocal same-project case queries", async () => {
    await owner.save(await input());
    await owner.save(
      await input({ ...target, url: "https://two.example.com/browse/PREM-42" }),
    );
    await owner.save(await input(target, secondCaseId));
    expect((await owner.forCase({ projectId, caseId })).links).toHaveLength(2);
    const reverse = await viewer.forTarget({
      projectId,
      provider: "jira",
      providerOrigin: "https://one.example.com",
      nativeId: "PREM-42",
    });
    expect(reverse.cases.map((row) => row.caseId).sort()).toEqual(
      [caseId, secondCaseId].sort(),
    );
    expect(reverse.indicatesExecutionPassed).toBe(false);
    expect(
      (
        await viewer.forTarget({
          projectId,
          provider: "jira",
          providerOrigin: "https://two.example.com",
          nativeId: "PREM-42",
        })
      ).total,
    ).toBe(1);
    await expect(
      outsider.forTarget({
        projectId,
        provider: "jira",
        providerOrigin: "https://one.example.com",
        nativeId: "PREM-42",
      }),
    ).rejects.toThrow();
  });
  it("preserves identities on identical saves and returns durable retries after subsequent edits", async () => {
    const savedInput = await input();
    const before = await owner.forCase({ projectId, caseId });
    const saved = await owner.save(savedInput);
    expect(saved.appliedVersion).toBe(before.version);
    await owner.save(
      await input({ ...target, title: "Reviewed premium feature name" }),
    );
    expect(await owner.save(savedInput)).toEqual({
      appliedVersion: before.version,
      retried: true,
    });
    await expect(
      owner.save({
        ...savedInput,
        target: { ...target, title: "Changed reused request" },
      }),
    ).rejects.toThrow("changed");
    const after = await owner.forCase({ projectId, caseId });
    expect(after.links).toHaveLength(2);
    expect(
      after.links.find(
        (row) => row.providerOrigin === "https://one.example.com",
      )?.id,
    ).toBe(
      before.links.find(
        (row) => row.providerOrigin === "https://one.example.com",
      )?.id,
    );
  });
  it("retains removal tombstones and restores only with an explicit reviewed save", async () => {
    const before = await owner.forCase({ projectId, caseId });
    const link = before.links.find(
      (row) => row.providerOrigin === "https://two.example.com",
    )!;
    const removal = {
      projectId,
      caseId,
      version: before.version,
      requestId: randomUUID(),
      linkId: link.id,
      approveRemove: true as const,
    };
    await owner.remove(removal);
    expect(
      (await owner.forCase({ projectId, caseId })).links.find(
        (row) => row.id === link.id,
      )?.removedAt,
    ).not.toBeNull();
    expect(
      (
        await owner.forTarget({
          projectId,
          provider: "jira",
          providerOrigin: "https://two.example.com",
          nativeId: "PREM-42",
        })
      ).total,
    ).toBe(0);
    expect((await owner.remove(removal)).retried).toBe(true);
    await owner.save(
      await input({ ...target, url: "https://two.example.com/browse/PREM-42" }),
    );
    const restored = await owner.forCase({ projectId, caseId });
    expect(restored.links).toHaveLength(2);
    expect(
      restored.links.find((row) => row.id === link.id)?.removedAt,
    ).toBeNull();
  });
  it("requires a same-project local requirement at API and database layers", async () => {
    const version = (await owner.forCase({ projectId, caseId })).version;
    await expect(
      owner.save({
        projectId,
        caseId,
        version,
        requestId: randomUUID(),
        approveLink: true,
        target: {
          provider: "requirement",
          nativeId: foreignRequirementId,
          kind: "requirement",
        },
      }),
    ).rejects.toThrow("same project");
    await owner.save({
      projectId,
      caseId,
      version,
      requestId: randomUUID(),
      approveLink: true,
      target: {
        provider: "requirement",
        nativeId: requirementId,
        kind: "requirement",
      },
    });
    const link = (await owner.forCase({ projectId, caseId })).links.find(
      (row) => row.provider === "requirement",
    )!;
    expect(link.title).toBe("Premium users can sign in");
    await expect(
      prisma.caseTraceabilityLink.create({
        data: {
          id: randomUUID(),
          projectId,
          caseId,
          provider: "requirement",
          providerOrigin: "vaettir",
          nativeId: foreignRequirementId,
          kind: "requirement",
          title: "Must fail",
          requirementId: foreignRequirementId,
          createdById: actorId,
          updatedById: actorId,
        },
      }),
    ).rejects.toThrow();
    expect(
      (
        await owner.forTarget({
          projectId,
          provider: "requirement",
          providerOrigin: "vaettir",
          nativeId: requirementId,
        })
      ).total,
    ).toBe(1);
  });
  it("keeps documentation section anchors and rejects credential-bearing or executable URLs without writes", async () => {
    const version = (await owner.forCase({ projectId, caseId })).version;
    for (const url of [
      "javascript:alert(1)",
      "https://user:secret@example.com/wiki",
      "https://example.com/wiki?token=private",
      "http://example.com/wiki",
    ])
      await expect(
        owner.save({
          ...(await input()),
          target: {
            ...target,
            provider: "wiki",
            nativeId: "wiki42",
            kind: "document",
            url,
          },
        }),
      ).rejects.toThrow();
    expect((await owner.forCase({ projectId, caseId })).version).toBe(version);
    await owner.save({
      ...(await input()),
      target: {
        provider: "notion",
        nativeId: "page-block-42",
        kind: "document",
        title: "Premium rules",
        url: "https://docs.example.com/premium#acceptance-criteria",
      },
    });
    expect(
      (await owner.forCase({ projectId, caseId })).links.find(
        (row) => row.provider === "notion",
      )?.url,
    ).toBe("https://docs.example.com/premium#acceptance-criteria");
  });
  it("rejects stale concurrent review and foreign test-case identities", async () => {
    const selected = await input({
      ...target,
      nativeId: "PREM-99",
      title: "New feature",
      url: "https://one.example.com/browse/PREM-99",
    });
    const results = await Promise.allSettled([
      owner.save(selected),
      owner.save({ ...selected, requestId: randomUUID() }),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    await expect(
      owner.remove({
        projectId,
        caseId,
        version: selected.version,
        requestId: randomUUID(),
        linkId: (await owner.forCase({ projectId, caseId })).links[0]!.id,
        approveRemove: true,
      }),
    ).rejects.toThrow("changed");
    await expect(
      owner.forCase({ projectId: otherProjectId, caseId }),
    ).rejects.toThrow();
  });
  it("denies viewer, read-only and freshly revoked writer access using the live membership", async () => {
    await expect(viewer.save(await input())).rejects.toThrow();
    await prisma.membership.update({
      where: {
        organizationId_userId: { organizationId: orgId, userId: actorId },
      },
      data: { seatType: "READ_ONLY" },
    });
    await expect(owner.save(await input())).rejects.toThrow("access changed");
    await prisma.membership.update({
      where: {
        organizationId_userId: { organizationId: orgId, userId: actorId },
      },
      data: { seatType: "FULL", role: "VIEWER" },
    });
    await expect(owner.save(await input())).rejects.toThrow("access changed");
    await prisma.membership.update({
      where: {
        organizationId_userId: { organizationId: orgId, userId: actorId },
      },
      data: { role: "OWNER" },
    });
    await prisma.organization.update({
      where: { id: orgId },
      data: { suspendedAt: new Date() },
    });
    await expect(owner.forCase({ projectId, caseId })).rejects.toThrow();
    await prisma.organization.update({
      where: { id: orgId },
      data: { suspendedAt: null },
    });
  });
  it("denies exposure of retained links after project reparenting", async () => {
    await prisma.project.update({
      where: { id: projectId },
      data: { organizationId: otherOrgId },
    });
    await expect(outsider.forCase({ projectId, caseId })).rejects.toThrow(
      "previous workspace",
    );
    await prisma.project.update({
      where: { id: projectId },
      data: { organizationId: orgId },
    });
  });
  it("replays an applied receipt after lost-response and access-revocation recovery without overwriting later edits", async () => {
    const selected = await input({
      ...target,
      nativeId: "PREM-RECOVERY",
      title: "Confirmed recovery coverage",
      url: "https://one.example.com/browse/PREM-RECOVERY",
    });
    const applied = await owner.save(selected);
    await prisma.membership.update({
      where: {
        organizationId_userId: { organizationId: orgId, userId: actorId },
      },
      data: { role: "VIEWER" },
    });
    await expect(owner.save(selected)).rejects.toThrow("access changed");
    await prisma.membership.update({
      where: {
        organizationId_userId: { organizationId: orgId, userId: actorId },
      },
      data: { role: "OWNER" },
    });
    await owner.save(
      await input({ ...selected.target, title: "Later human correction" }),
    );
    expect(await owner.save(selected)).toEqual({
      appliedVersion: applied.appliedVersion,
      retried: true,
    });
    expect(
      (await owner.forCase({ projectId, caseId })).links.find(
        (row) => row.nativeId === "PREM-RECOVERY",
      )?.title,
    ).toBe("Later human correction");
  });
  it("explains retained-reference deletion guards without erasing active or removed-link evidence", async () => {
    const current = await owner.forCase({ projectId, caseId });
    const link = current.links.find((row) => row.provider === "requirement")!;
    await owner.remove({
      projectId,
      caseId,
      version: current.version,
      requestId: randomUUID(),
      linkId: link.id,
      approveRemove: true,
    });
    await expect(
      ownerRequirements.delete({ id: requirementId }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(ownerCases.delete({ id: caseId })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(
      await prisma.requirement.findUnique({ where: { id: requirementId } }),
    ).not.toBeNull();
    expect(
      await prisma.testCase.findUnique({ where: { id: caseId } }),
    ).not.toBeNull();
    expect(
      (await owner.forCase({ projectId, caseId })).links.find(
        (row) => row.id === link.id,
      )?.removedAt,
    ).not.toBeNull();
  });
});
