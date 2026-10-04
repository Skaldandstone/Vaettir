// Authored source only. New migrated owned loopback database required in morning.
import { randomUUID } from "node:crypto";
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { Prisma, prisma } from "@vaettir/db";
import { resolveReportReleaseScope } from "./services/reportReleaseScope.js";
import { hardDeleteOrganization } from "./services/orgHardDelete.js";
describe("current native release-plan report membership", () => {
  const tag = `release-scope-${randomUUID()}`,
    orgIds: string[] = [],
    projectIds: string[] = [];
  let typeId: string, actorId: string;
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
    if (
      !["localhost", "127.0.0.1"].includes(url.hostname) ||
      !/test/i.test(url.pathname) ||
      url.searchParams.has("host")
    )
      throw Error("Owned disposable loopback test database required");
    const tier = await prisma.planTier.findUniqueOrThrow({
      where: { key: "free" },
    });
    for (let index = 0; index < 2; index++) {
      const org = await prisma.organization.create({
        data: {
          name: `${tag}-${index}`,
          slug: `${tag}-${index}`,
          planTierId: tier.id,
        },
      });
      orgIds.push(org.id);
      const project = await prisma.project.create({
        data: { organizationId: org.id, name: tag, slug: tag },
      });
      projectIds.push(project.id);
    }
    const user = await prisma.user.create({
      data: {
        clerkUserId: tag,
        email: `${tag}@example.com`,
        memberships: {
          create: {
            organizationId: orgIds[0]!,
            role: "OWNER",
            seatType: "FULL",
          },
        },
      },
    });
    actorId = user.id;
    typeId = (await prisma.testPlanType.findFirstOrThrow()).id;
  });
  afterAll(async () => {
    // Explicitly remove only our malformed synthetic cross-project FK rows before
    // original-org erasure; no unrelated/customer cleanup or guard bypass.
    await prisma.testPlan.deleteMany({
      where: { projectId: { in: projectIds } },
    });
    for (const id of orgIds) {
      const org = await prisma.organization.findUniqueOrThrow({
        where: { id },
      });
      if (!org.slug.startsWith(tag)) throw Error("Fixture ownership mismatch");
      await hardDeleteOrganization(
        prisma,
        id,
        actorId,
        "Owned native release scope fixture erasure",
      );
    }
    await prisma.user.deleteMany({ where: { id: actorId } });
  });
  async function release(count: number, name = "Synthetic native release") {
    const item = await prisma.release.create({
      data: { projectId: projectIds[0]!, name },
    });
    if (count)
      await prisma.testPlan.createMany({
        data: Array.from({ length: count }, (_, index) => ({
          projectId: projectIds[0]!,
          releaseId: item.id,
          name: `Native plan ${index}`,
          testPlanTypeId: typeId,
        })),
      });
    return item;
  }
  async function resolve(releaseId: string, projectId = projectIds[0]!) {
    return prisma.$transaction(
      async (tx) => {
        // Synthetic caller models the parent report capture's authorized project
        // lock. Helper is deliberately not an independent authorization endpoint.
        await tx.$executeRaw(
          Prisma.sql`SET LOCAL statement_timeout = '8000ms'`,
        );
        await tx.$queryRaw`SELECT id FROM "Project" WHERE id=${projectId} FOR UPDATE`;
        return resolveReportReleaseScope(tx, projectId, releaseId);
      },
      { isolationLevel: "RepeatableRead", timeout: 20000 },
    );
  }
  it("returns exact zero membership without expanding to all project plans", async () => {
    const item = await release(0),
      unrelated = await release(1);
    const value = await resolve(item.id);
    expect(value.planIds).toEqual([]);
    expect(value.releaseId).toBe(item.id);
    expect(value.limitations.join(" ")).toContain("no native linked plans");
    expect(value.limitations.join(" ")).not.toContain(unrelated.id);
  });
  it("returns all200 linked native IDs deterministically and refuses201", async () => {
    const exact = await release(200),
      over = await release(201);
    const expected = await prisma.testPlan.findMany({
      where: { projectId: projectIds[0], releaseId: exact.id },
      orderBy: { id: "asc" },
      select: { id: true },
    });
    expect((await resolve(exact.id)).planIds).toEqual(
      expected.map((row) => row.id),
    );
    await expect(resolve(over.id)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });
  it("rejects foreign missing and unsupported identities without names or provider inference", async () => {
    const foreign = await prisma.release.create({
      data: {
        projectId: projectIds[1]!,
        name: "FOREIGN LABEL MUST NOT APPEAR",
      },
    });
    await expect(resolve(foreign.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(resolve("missing-native-release")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(resolve("branch/main")).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });
  it("refuses contaminated cross-project FK links rather than returning a smaller certified scope", async () => {
    const item = await release(1);
    await prisma.testPlan.create({
      data: {
        projectId: projectIds[1]!,
        releaseId: item.id,
        name: "FOREIGN PLAN BODY MUST NOT APPEAR",
        testPlanTypeId: typeId,
      },
    });
    await expect(resolve(item.id)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });
  it("reflects native link changes on a new read while previously returned scope stays unchanged", async () => {
    const first = await release(1),
      second = await release(0);
    const old = await resolve(first.id),
      planId = old.planIds[0]!;
    await prisma.testPlan.update({
      where: { id: planId },
      data: { releaseId: second.id },
    });
    expect((await resolve(first.id)).planIds).toEqual([]);
    expect((await resolve(second.id)).planIds).toEqual([planId]);
    expect(old.planIds).toEqual([planId]);
    expect(old.limitations.join(" ")).toContain(
      "Historic run release certification is unavailable",
    );
  });
  it("bounds Unicode name materialization and marks excerpts without splitting pairs", async () => {
    const item = await release(
      0,
      "a".repeat(239) + "😀" + "suffix".repeat(100),
    );
    const value = await resolve(item.id);
    expect(value.releaseName).toBe("a".repeat(239));
    expect(value.releaseNameIsExcerpt).toBe(true);
    expect(value.limitations.join(" ")).toContain("display excerpt");
  });
});
