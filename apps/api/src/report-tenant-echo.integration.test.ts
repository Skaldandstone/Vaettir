// Authored only. Do not execute outside an owned migrated loopback test DB.
import { createHash, randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { prisma, type Prisma } from "@vaettir/db";
import { reportSnapshotsRouter } from "./routers/reportSnapshots.js";
import { hardDeleteOrganization } from "./services/orgHardDelete.js";
describe("report metadata response current original-tenant echoes", () => {
  const tag = `report-echo-${randomUUID()}`,
    orgs: string[] = [];
  let projectId: string,
    actorId: string,
    caller: ReturnType<typeof reportSnapshotsRouter.createCaller>;
  const ids = ["before", "after", "foreign"].map((key) =>
    createHash("sha256").update(`${tag}-${key}`).digest("hex"),
  );
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
    if (
      !["localhost", "127.0.0.1"].includes(url.hostname) ||
      !/test/i.test(url.pathname) ||
      url.searchParams.has("host")
    )
      throw Error("Owned disposable loopback DB required");
    const tier = await prisma.planTier.findUniqueOrThrow({
      where: { key: "free" },
    });
    for (let i = 0; i < 2; i++)
      orgs.push(
        (
          await prisma.organization.create({
            data: {
              name: `${tag}-${i}`,
              slug: `${tag}-${i}`,
              planTierId: tier.id,
            },
          })
        ).id,
      );
    const user = await prisma.user.create({
      data: {
        email: `${tag}@example.com`,
        clerkUserId: tag,
        memberships: {
          create: orgs.map((organizationId) => ({
            organizationId,
            role: "OWNER" as const,
            seatType: "FULL" as const,
          })),
        },
      },
      include: { memberships: true },
    });
    actorId = user.id;
    caller = reportSnapshotsRouter.createCaller({ prisma, user });
    projectId = (
      await prisma.project.create({
        data: {
          organizationId: orgs[0]!,
          name: "Synthetic report echoes",
          slug: tag,
        },
      })
    ).id;
    const definition = {
      audience: "stakeholders" as const,
      windowDays: 30 as const,
      sections: ["inventory", "execution"] as ("inventory" | "execution")[],
      summary: "Private author text should not be projected",
      risks: "",
      nextActions: "",
    };
    const preview = await caller.preview({
      projectId,
      requestId: randomUUID(),
      title: "Synthetic preview",
      definition,
    });
    for (let i = 0; i < ids.length; i++) {
      const asOf = new Date(`2026-10-0${i + 1}T12:00:00Z`);
      await prisma.projectReportSnapshot.create({
        data: {
          id: ids[i]!,
          projectId,
          organizationId: orgs[i === 2 ? 1 : 0]!,
          createdById: actorId,
          inputHash: randomUUID(),
          title: `Synthetic capture ${i}`,
          asOf,
          payload: {
            ...preview.payload,
            state: "approved",
            asOf: asOf.toISOString(),
            windowStart: "2026-09-01T00:00:00.000Z",
            windowEnd: "2026-09-30T23:59:59.999Z",
          } as unknown as Prisma.InputJsonValue,
        },
      });
    }
  });
  afterAll(async () => {
    if (projectId) {
      const project = await prisma.project.findUniqueOrThrow({
        where: { id: projectId },
        select: { slug: true, organizationId: true },
      });
      if (project.slug !== tag || !orgs.includes(project.organizationId))
        throw Error("Fixture project ownership mismatch");
      // Explicit owned cleanup; the existing erasure helper currently does not
      // include report snapshots. Do not make this fixture a production erasure
      // acceptance claim or remove records from unrelated projects/organizations.
      await prisma.projectReportSnapshot.deleteMany({
        where: { projectId, organizationId: { in: orgs } },
      });
    }
    for (const id of orgs) {
      const org = await prisma.organization.findUniqueOrThrow({
        where: { id },
        select: { slug: true },
      });
      if (!org.slug.startsWith(tag)) throw Error("Fixture ownership mismatch");
      await hardDeleteOrganization(
        prisma,
        id,
        actorId,
        "Owned report tenant echo fixtures",
      );
    }
    // Retain the dedicated synthetic actor referenced by the durable deletion receipts.
    for (const organizationId of orgs)
      expect(await prisma.organizationDeletionLog.count({ where: { organizationId, deletedById: actorId } })).toBe(1);
  });
  it("echoes server-authorized org/project identity without leaking private catalog content", async () => {
    const catalog = await caller.catalog({ projectId });
    expect(catalog.organizationId).toBe(orgs[0]);
    expect(catalog.projectId).toBe(projectId);
    expect(catalog.items.map((row) => row.id)).not.toContain(ids[2]);
    expect(JSON.stringify(catalog)).not.toContain("Private author text");
    const comparison = await caller.compare({
      projectId,
      baselineId: ids[0]!,
      targetId: ids[1]!,
    });
    expect(comparison.organizationId).toBe(orgs[0]);
    expect(comparison.projectId).toBe(projectId);
    expect(comparison.baseline.id).toBe(ids[0]);
    expect(comparison.target.id).toBe(ids[1]);
    await expect(
      caller.compare({ projectId, baselineId: ids[0]!, targetId: ids[2]! }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("never reuses the original tenant's capture after same-project reparent, even for a dual-org actor", async () => {
    await prisma.project.update({
      where: { id: projectId },
      data: { organizationId: orgs[1]! },
    });
    try {
      const catalog = await caller.catalog({ projectId });
      expect(catalog.organizationId).toBe(orgs[1]);
      expect(catalog.items.map((row) => row.id)).not.toContain(ids[0]);
      expect(catalog.items.map((row) => row.id)).not.toContain(ids[1]);
      await expect(
        caller.compare({ projectId, baselineId: ids[0]!, targetId: ids[1]! }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    } finally {
      await prisma.project.update({
        where: { id: projectId },
        data: { organizationId: orgs[0]! },
      });
    }
    await prisma.organization.update({
      where: { id: orgs[0]! },
      data: { suspendedAt: new Date() },
    });
    try {
      await expect(caller.catalog({ projectId })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(
        caller.compare({ projectId, baselineId: ids[0]!, targetId: ids[1]! }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    } finally {
      await prisma.organization.update({
        where: { id: orgs[0]! },
        data: { suspendedAt: null },
      });
    }
  });
});
