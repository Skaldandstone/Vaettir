import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { prisma } from "@vaettir/db";
import { appRouter } from "./router.js";

const stamp = `defect-map-${Date.now()}`;
const now = "2026-10-02T10:00:00Z";
const batch = {
  sources: [
    {
      provider: "sentry" as const,
      scope: "app",
      status: "available" as const,
      observedAt: now,
    },
    {
      provider: "jira" as const,
      scope: "team",
      status: "available" as const,
      observedAt: now,
    },
  ],
  signals: [
    {
      provider: "sentry" as const,
      scope: "app",
      externalId: "crash-1",
      groupId: "group-1",
      title: "Synthetic checkout exception",
      occurrences: 10,
      windowStart: "2026-10-01T10:00:00Z",
      windowEnd: now,
      lastSeen: now,
      component: "checkout",
      release: "v1",
      environment: "production",
      taskRefs: [
        { provider: "jira" as const, scope: "team", externalId: "QA-1" },
      ],
    },
  ],
  tasks: [
    {
      provider: "jira" as const,
      scope: "team",
      externalId: "QA-1",
      title: "Synthetic fix",
      status: "open" as const,
      observedAt: now,
      component: "checkout",
      release: "v1",
      environment: "production",
    },
  ],
};

describe("reviewed defect map", () => {
  let projectId: string;
  let orgId: string;
  let otherOrgId: string;
  let actorId: string;
  let owner: ReturnType<typeof appRouter.createCaller>;
  let viewer: ReturnType<typeof appRouter.createCaller>;
  let outsider: ReturnType<typeof appRouter.createCaller>;
  const userIds: string[] = [];
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
    if (
      !["localhost", "127.0.0.1"].includes(url.hostname) ||
      !/test/i.test(url.pathname) ||
      url.searchParams.has("host")
    )
      throw new Error("Synthetic disposable loopback database required");
    const tier = await prisma.planTier.findUniqueOrThrow({
      where: { key: "free" },
    });
    const org = await prisma.organization.create({
      data: { name: stamp, slug: stamp, planTierId: tier.id },
    });
    const other = await prisma.organization.create({
      data: {
        name: `${stamp}-other`,
        slug: `${stamp}-other`,
        planTierId: tier.id,
      },
    });
    orgId = org.id;
    otherOrgId = other.id;
    projectId = (
      await prisma.project.create({
        data: {
          organizationId: orgId,
          name: "Synthetic crash mapping",
          slug: stamp,
        },
      })
    ).id;
    for (const [suffix, organizationId, role] of [
      ["owner", orgId, "OWNER"],
      ["viewer", orgId, "VIEWER"],
      ["outside", otherOrgId, "OWNER"],
    ] as const) {
      const user = await prisma.user.create({
        data: {
          clerkUserId: `${stamp}-${suffix}`,
          email: `${stamp}-${suffix}@example.com`,
          memberships: { create: { organizationId, role } },
        },
        include: { memberships: true },
      });
      userIds.push(user.id);
      const caller = appRouter.createCaller({ prisma, user });
      if (suffix === "owner") {
        actorId = user.id;
        owner = caller;
      } else if (suffix === "viewer") viewer = caller;
      else outsider = caller;
    }
  });
  afterAll(async () => {
    if (orgId)
      await prisma.project.deleteMany({
        where: { organizationId: { in: [orgId, otherOrgId] } },
      });
    if (orgId)
      await prisma.membership.deleteMany({
        where: { organizationId: { in: [orgId, otherOrgId] } },
      });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    if (orgId)
      await prisma.organization.deleteMany({
        where: { id: { in: [orgId, otherOrgId] } },
      });
  });
  const importBatch = async (input = batch) => {
    const preview = await owner.defectMap.previewImport({
      projectId,
      batch: input,
      approveMetadataRead: true,
    });
    return owner.defectMap.approveImport({
      projectId,
      batch: input,
      approveMetadataRead: true,
      approveImport: true,
      version: preview.version,
      previewHash: preview.previewHash,
      requestId: randomUUID(),
    });
  };
  it("previews without writes and requires explicit unchanged review hash", async () => {
    const preview = await owner.defectMap.previewImport({
      projectId,
      batch,
      approveMetadataRead: true,
    });
    expect(preview.map.clusters).toHaveLength(1);
    expect(await prisma.defectMapState.count({ where: { projectId } })).toBe(0);
    await expect(
      owner.defectMap.approveImport({
        projectId,
        batch,
        approveMetadataRead: true,
        approveImport: true,
        version: preview.version,
        previewHash: "a".repeat(64),
        requestId: randomUUID(),
      }),
    ).rejects.toThrow("changed");
    const saved = await importBatch();
    expect(saved.appliedVersion).toBe(1);
    expect((await viewer.defectMap.get({ projectId })).map.suggested).toBe(1);
  });
  it("denies foreign tenants and fresh viewer/read-only/revoked access even with cached owner context", async () => {
    await expect(outsider.defectMap.get({ projectId })).rejects.toThrow();
    await expect(
      viewer.defectMap.previewImport({
        projectId,
        batch,
        approveMetadataRead: true,
      }),
    ).rejects.toThrow();
    await prisma.membership.update({
      where: {
        organizationId_userId: { organizationId: orgId, userId: actorId },
      },
      data: { seatType: "READ_ONLY" },
    });
    await expect(importBatch()).rejects.toThrow("access changed");
    await prisma.membership.update({
      where: {
        organizationId_userId: { organizationId: orgId, userId: actorId },
      },
      data: { role: "VIEWER", seatType: "FULL" },
    });
    await expect(importBatch()).rejects.toThrow("access changed");
    await prisma.membership.update({
      where: {
        organizationId_userId: { organizationId: orgId, userId: actorId },
      },
      data: { role: "OWNER" },
    });
  });
  it("identical reruns do not duplicate records or advance baseline; retries survive later writes", async () => {
    const preview = await owner.defectMap.previewImport({
      projectId,
      batch,
      approveMetadataRead: true,
    });
    const input = {
      projectId,
      batch,
      approveMetadataRead: true as const,
      approveImport: true as const,
      version: preview.version,
      previewHash: preview.previewHash,
      requestId: randomUUID(),
    };
    const saved = await owner.defectMap.approveImport(input);
    expect(saved.appliedVersion).toBe(1);
    const map = await owner.defectMap.get({ projectId });
    const cluster = map.map.clusters[0]!;
    await owner.defectMap.decideLink({
      projectId,
      version: map.version,
      requestId: randomUUID(),
      clusterId: cluster.id,
      taskKey: cluster.links[0]!.taskKey,
      status: "confirmed",
    });
    expect(await owner.defectMap.approveImport(input)).toEqual({
      appliedVersion: 1,
      retried: true,
    });
    expect(
      (await owner.defectMap.get({ projectId })).document.signals,
    ).toHaveLength(1);
  });
  it("preserves human links, marks only changed evidence stale and refuses stale concurrent edits", async () => {
    const before = await owner.defectMap.get({ projectId });
    const cluster = before.map.clusters[0]!;
    expect(cluster.links[0]?.stale).toBe(false);
    await importBatch({
      ...batch,
      signals: [{ ...batch.signals[0]!, occurrences: 14 }],
    });
    const changed = await owner.defectMap.get({ projectId });
    expect(changed.map.clusters[0]?.links[0]?.status).toBe("confirmed");
    expect(changed.map.clusters[0]?.links[0]?.stale).toBe(true);
    await expect(
      owner.defectMap.decideLink({
        projectId,
        version: before.version,
        requestId: randomUUID(),
        clusterId: cluster.id,
        taskKey: cluster.links[0]!.taskKey,
        status: "rejected",
      }),
    ).rejects.toThrow("changed");
  });
  it("retains missing/unavailable inputs and rejections on partial reruns", async () => {
    const before = await owner.defectMap.get({ projectId });
    const preview = await owner.defectMap.previewImport({
      projectId,
      batch: {
        sources: [
          {
            ...batch.sources[0]!,
            status: "unavailable",
            observedAt: "2026-10-02T12:00:00Z",
          },
        ],
        signals: [],
        tasks: [],
      },
      approveMetadataRead: true,
    });
    const input = {
      sources: [
        {
          ...batch.sources[0]!,
          status: "unavailable" as const,
          observedAt: "2026-10-02T12:00:00Z",
        },
      ],
      signals: [],
      tasks: [],
    };
    await owner.defectMap.approveImport({
      projectId,
      batch: input,
      approveMetadataRead: true,
      approveImport: true,
      version: preview.version,
      previewHash: preview.previewHash,
      requestId: randomUUID(),
    });
    const after = await owner.defectMap.get({ projectId });
    expect(after.document.signals).toEqual(before.document.signals);
    expect(after.document.decisions).toEqual(before.document.decisions);
    expect(after.map.clusters[0]?.unavailable).toBe(true);
  });
  it("serializes simultaneous approvals and rejects request-ID payload reuse", async () => {
    const changedBatch = {
      ...batch,
      sources: batch.sources.map((source) => ({
        ...source,
        observedAt: "2026-10-02T13:00:00Z",
      })),
    };
    const preview = await owner.defectMap.previewImport({
      projectId,
      batch: changedBatch,
      approveMetadataRead: true,
    });
    const input = {
      projectId,
      batch: changedBatch,
      approveMetadataRead: true as const,
      approveImport: true as const,
      version: preview.version,
      previewHash: preview.previewHash,
      requestId: randomUUID(),
    };
    const results = await Promise.allSettled([
      owner.defectMap.approveImport(input),
      owner.defectMap.approveImport({ ...input, requestId: randomUUID() }),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const altered = { ...input, batch: { ...changedBatch, signals: [] } };
    await expect(owner.defectMap.approveImport(altered)).rejects.toThrow();
  });
  it("refuses reparented baseline exposure and suspended workspace access", async () => {
    await prisma.organization.update({
      where: { id: orgId },
      data: { suspendedAt: new Date() },
    });
    await expect(owner.defectMap.get({ projectId })).rejects.toThrow();
    await prisma.organization.update({
      where: { id: orgId },
      data: { suspendedAt: null },
    });
    await prisma.project.update({
      where: { id: projectId },
      data: { organizationId: otherOrgId },
    });
    await expect(outsider.defectMap.get({ projectId })).rejects.toThrow(
      "previous workspace",
    );
    await prisma.project.update({
      where: { id: projectId },
      data: { organizationId: orgId },
    });
  });
});
