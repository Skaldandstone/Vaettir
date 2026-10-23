// Synthetic integration coverage requires an owned migrated loopback test DB.
import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Prisma, prisma, type PrismaClient } from "@vaettir/db";
import { caseFoldersRouter } from "./routers/caseFolders.js";
import {
  writeFolderCopy,
  previewFolderCopy,
} from "./services/caseFolderCopy.js";
import { hardDeleteOrganization } from "./services/orgHardDelete.js";
import { qualityProfileHash } from "./services/qualityExperienceProfile.js";

describe("atomic reviewed internal prerequisite folder copy (owned synthetic DB)", () => {
  const tag = `internal-copy-${randomUUID()}`;
  let organizationId: string,
    actorId: string,
    clerkActorId: string,
    projectId: string,
    foreignProjectId: string;
  let caller: ReturnType<typeof caseFoldersRouter.createCaller>;
  beforeAll(() => {
    const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
    if (
      !["localhost", "127.0.0.1"].includes(url.hostname) ||
      !/test/i.test(url.pathname) ||
      url.searchParams.has("host")
    )
      throw Error("Owned disposable loopback test DB required");
  });
  beforeEach(async () => {
    organizationId = "";
    actorId = "";
    const tier = await prisma.planTier.findUniqueOrThrow({
        where: { key: "free" },
      }),
      slug = `${tag}-${randomUUID()}`;
    organizationId = (
      await prisma.organization.create({
        data: { name: slug, slug, planTierId: tier.id },
      })
    ).id;
    clerkActorId = `${tag}-${randomUUID()}`;
    const user = await prisma.user.create({
      data: {
        clerkUserId: clerkActorId,
        email: `${clerkActorId}@example.com`,
        memberships: {
          create: { organizationId, role: "OWNER", seatType: "FULL" },
        },
      },
      include: { memberships: true },
    });
    actorId = user.id;
    caller = caseFoldersRouter.createCaller({ prisma, user });
    projectId = (
      await prisma.project.create({
        data: { organizationId, name: tag, slug: `${tag}-${randomUUID()}` },
      })
    ).id;
    foreignProjectId = (
      await prisma.project.create({
        data: {
          organizationId,
          name: "Other synthetic project",
          slug: `${tag}-${randomUUID()}`,
        },
      })
    ).id;
  });
  afterEach(async () => {
    if (!organizationId) return;
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (org) {
      if (!org.slug.startsWith(tag)) throw Error("Fixture ownership mismatch");
      if (!actorId)
        throw Error(
          "Owned fixture actor unavailable; preserve partial setup for inspection",
        );
      const receipt = await hardDeleteOrganization(
        prisma,
        organizationId,
        actorId,
        "Owned internal prerequisite synthetic fixture cleanup",
      );
      expect(
        (
          await prisma.organizationDeletionLog.deleteMany({
            where: {
              id: receipt.deletionLogId,
              organizationId,
              organizationSlug: org.slug,
              deletedById: actorId,
            },
          })
        ).count,
      ).toBe(1);
    }
    if (!actorId) return;
    await prisma.user.deleteMany({
      where: { id: actorId, clerkUserId: { startsWith: tag } },
    });
  });
  async function source(title: string, path = "Source") {
    return prisma.testCase.create({
      data: {
        projectId,
        title,
        suitePath: path,
        testType: "FUNCTIONAL",
        given: ["Original Given"],
        when: ["Original When"],
        then: ["Original Then"],
        steps: {
          create: {
            order: 0,
            action: "Original action",
            expectedResult: "Original expected result",
          },
        },
      },
    });
  }
  async function edge(dependentId: string, prerequisiteId: string) {
    return prisma.testCasePrerequisite.create({
      data: { projectId, dependentId, prerequisiteId, createdById: actorId },
    });
  }
  const scope = () => ({
    projectId,
    fromPath: "Source",
    toPath: "Copy",
    copyInternalPrerequisites: true as const,
  });
  async function approved() {
    const p = await caller.copyPreview(scope());
    return {
      ...scope(),
      expectedHash: p.expectedHash,
      expectedPrerequisiteHash: p.prerequisiteReviewHash!,
      expectedInternalPrerequisites: p.internalPrerequisites.map(
        ({ dependentId, prerequisiteId }) => ({ dependentId, prerequisiteId }),
      ),
      expectedScope: { organizationId, clerkActorId },
      requestId: randomUUID(),
      confirmed: true as const,
      reason: "Reviewed complete source graph and fresh identity remapping",
    };
  }
  async function noWrites() {
    expect(
      await prisma.testCase.count({
        where: { projectId, suitePath: { startsWith: "Copy" } },
      }),
    ).toBe(0);
    expect(
      await prisma.caseFolderWrite.count({
        where: { projectId, receipt: { path: ["action"], equals: "COPY" } },
      }),
    ).toBe(0);
  }

  it("reviews every internal edge then clones all endpoints atomically, preserves sources and replays exact identities/history once", async () => {
    const a = await source("Login"),
      b = await source("Premium activity", "Source/Premium"),
      c = await source("Report", "Source/Premium/Reports"),
      isolated = await source("Independent");
    await edge(b.id, a.id);
    await edge(c.id, b.id);
    const sourceEdges = await prisma.testCasePrerequisite.findMany({
      where: { projectId },
      orderBy: [{ dependentId: "asc" }, { prerequisiteId: "asc" }],
    });
    const originalCases = await prisma.testCase.findMany({
      where: { projectId },
      include: { steps: true, versions: true },
      orderBy: { id: "asc" },
    });
    await expect(
      caller.copyPreview({ projectId, fromPath: "Source", toPath: "Copy" }),
    ).rejects.toThrow("prerequisite");
    const preview = await caller.copyPreview(scope());
    expect(preview.caseCount).toBe(4);
    expect(preview.internalPrerequisites).toHaveLength(2);
    expect(preview.internalPrerequisites).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          dependentDisplayId: b.displayId,
          prerequisiteDisplayId: a.displayId,
        }),
      ]),
    );
    const input = await approved(),
      counter = (
        await prisma.project.findUniqueOrThrow({ where: { id: projectId } })
      ).nextCaseNumber;
    const [first, retry] = await Promise.all([
      caller.copyWrite(input),
      caller.copyWrite(input),
    ]);
    expect(first.receiptId).toBe(retry.receiptId);
    expect(first.copiedPrerequisites).toEqual(retry.copiedPrerequisites);
    expect(first.copies).toHaveLength(4);
    expect(
      (await prisma.project.findUniqueOrThrow({ where: { id: projectId } }))
        .nextCaseNumber,
    ).toBe(counter + 4);
    const map = new Map(first.copies.map((copy) => [copy.sourceId, copy]));
    expect(first.copiedPrerequisites).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceDependentId: b.id,
          sourcePrerequisiteId: a.id,
          dependentId: map.get(b.id)!.caseId,
          prerequisiteId: map.get(a.id)!.caseId,
          dependentDisplayId: map.get(b.id)!.displayId,
          prerequisiteDisplayId: map.get(a.id)!.displayId,
        }),
      ]),
    );
    expect(
      await prisma.testCasePrerequisite.findMany({
        where: { dependentId: { in: [a.id, b.id, c.id, isolated.id] } },
        orderBy: [{ dependentId: "asc" }, { prerequisiteId: "asc" }],
      }),
    ).toEqual(sourceEdges);
    expect(
      await prisma.testCase.findMany({
        where: { id: { in: [a.id, b.id, c.id, isolated.id] } },
        include: { steps: true, versions: true },
        orderBy: { id: "asc" },
      }),
    ).toEqual(originalCases);
    const copiedIds = first.copies.map((copy) => copy.caseId),
      links = await prisma.testCasePrerequisite.findMany({
        where: { dependentId: { in: copiedIds } },
      });
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(copiedIds).toContain(link.prerequisiteId);
      expect(link.createdById).toBe(actorId);
    }
    expect(
      await prisma.testCaseVersion.count({
        where: { testCaseId: { in: copiedIds } },
      }),
    ).toBe(4);
    const receipt = await prisma.caseFolderWrite.findUniqueOrThrow({
      where: { id: first.receiptId },
    });
    expect(receipt.receipt).toMatchObject({
      schemaVersion: 4,
      copiedPrerequisites: first.copiedPrerequisites,
      prerequisiteReviewHash: input.expectedPrerequisiteHash,
    });
    expect(
      await prisma.auditLog.count({
        where: { projectId, entityType: "TestCasePrerequisiteCopy" },
      }),
    ).toBe(1);
    await expect(
      caller.copyWrite({
        ...input,
        copyInternalPrerequisites: undefined,
        expectedPrerequisiteHash: undefined,
        expectedInternalPrerequisites: undefined,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("refuses outgoing and incoming external links without revealing or omitting the external case", async () => {
    const a = await source("Selected"),
      outside = await source("PRIVATE OUTSIDE TITLE", "Elsewhere");
    for (const pair of [
      [a.id, outside.id],
      [outside.id, a.id],
    ]) {
      await edge(pair[0]!, pair[1]!);
      try {
        await caller.copyPreview(scope());
        throw Error("Expected refusal");
      } catch (error) {
        expect(String(error)).toContain("complete selected subtree");
        expect(String(error)).not.toContain(outside.displayId);
        expect(String(error)).not.toContain(outside.id);
        expect(String(error)).not.toContain("PRIVATE OUTSIDE TITLE");
      }
      await prisma.testCasePrerequisite.deleteMany({ where: { projectId } });
    }
    await noWrites();
  });
  it("rejects self/cycle graphs and keeps composite cross-project FK enforcement", async () => {
    const a = await source("A"),
      b = await source("B"),
      foreign = await prisma.testCase.create({
        data: {
          projectId: foreignProjectId,
          title: "Private other project",
          testType: "FUNCTIONAL",
        },
      });
    await expect(edge(a.id, foreign.id)).rejects.toThrow();
    await expect(edge(a.id, a.id)).rejects.toThrow(
      "TestCasePrerequisite_not_self",
    );
    // Exercise the service guard against impossible legacy/adapter data without
    // disabling the database's self-edge constraint or persisting invalid rows.
    let selfRead = false;
    const selfEdgeRead = prisma.$extends({
      query: {
        testCasePrerequisite: {
          async findMany({ args, query }) {
            const rows = await query(args);
            if (args.take !== 2501) return rows;
            selfRead = true;
            return [
              ...rows,
              {
                projectId,
                dependentId: a.id,
                prerequisiteId: a.id,
                createdById: actorId,
                createdAt: new Date(),
              },
            ];
          },
        },
      },
    });
    await expect(
      previewFolderCopy(
        selfEdgeRead as unknown as PrismaClient,
        actorId,
        scope(),
      ),
    ).rejects.toThrow("cyclic");
    expect(selfRead).toBe(true);
    await prisma.testCasePrerequisite.deleteMany({ where: { projectId } });
    await edge(a.id, b.id);
    await edge(b.id, a.id);
    await expect(caller.copyPreview(scope())).rejects.toThrow("cyclic");
    await noWrites();
  });
  it("binds exact reviewed graph CAS and sees incoming links committed before source locks", async () => {
    const a = await source("A"),
      b = await source("B"),
      outside = await source("Outside", "Elsewhere");
    await edge(b.id, a.id);
    const input = await approved();
    await prisma.testCasePrerequisite.deleteMany({ where: { projectId } });
    await expect(caller.copyWrite(input)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await edge(b.id, a.id);
    let inserted = false;
    const raced = prisma.$extends({
      query: {
        testCase: {
          async findMany({ args, query }) {
            const rows = await query(args);
            if (
              !inserted &&
              args.where?.projectId === projectId &&
              args.select?.id &&
              Object.keys(args.select).length === 1 &&
              args.take === 51
            ) {
              inserted = true;
              await edge(outside.id, a.id);
            }
            return rows;
          },
        },
      },
    });
    await expect(
      writeFolderCopy(raced as unknown as PrismaClient, actorId, input),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(inserted).toBe(true);
    await noWrites();
  });
  it("rolls back fresh case counters, procedure versions, folder state and all edges when relationship insertion fails", async () => {
    const a = await source("A"),
      b = await source("B");
    await edge(b.id, a.id);
    const input = await approved(),
      counter = (
        await prisma.project.findUniqueOrThrow({ where: { id: projectId } })
      ).nextCaseNumber;
    const failing = prisma.$extends({
      query: {
        testCasePrerequisite: {
          async createMany() {
            throw Error("Synthetic remap failure");
          },
        },
      },
    });
    await expect(
      writeFolderCopy(failing as unknown as PrismaClient, actorId, input),
    ).rejects.toThrow("Synthetic remap failure");
    expect(
      (await prisma.project.findUniqueOrThrow({ where: { id: projectId } }))
        .nextCaseNumber,
    ).toBe(counter);
    await noWrites();
    expect(
      await prisma.auditLog.count({
        where: {
          projectId,
          entityType: { in: ["TestCaseClone", "TestCasePrerequisiteCopy"] },
        },
      }),
    ).toBe(0);
    expect(
      await prisma.testCaseVersion.count({
        where: { testCase: { projectId, suitePath: { startsWith: "Copy" } } },
      }),
    ).toBe(0);
    expect((await caller.list({ projectId })).paths).not.toContain("Copy");
  });
  it("holds source FK and touching edge locks against independent incoming insertion and edge deletion during remapping", async () => {
    const a = await source("A"),
      b = await source("B"),
      outside = await source("Outside", "Elsewhere");
    await edge(b.id, a.id);
    const input = await approved();
    let probed = false;
    const locked = prisma.$extends({
      query: {
        testCasePrerequisite: {
          async findMany({ args, query }) {
            const rows = await query(args);
            if (!probed && args.take === 2501) {
              probed = true;
              // Independent transactions have exact local lock limits, not sleeps
              // or elapsed-time guesses. The authorized copy already owns its locks.
              await expect(
                prisma.$transaction(
                  async (tx) => {
                    await tx.$executeRaw`SET LOCAL lock_timeout = '100ms'`;
                    await tx.$executeRaw`INSERT INTO "TestCasePrerequisite" ("projectId", "dependentId", "prerequisiteId", "createdById") VALUES (${projectId}, ${outside.id}, ${a.id}, ${actorId})`;
                  },
                  { timeout: 2000 },
                ),
              ).rejects.toMatchObject({
                code: "P2010",
                meta: { code: "55P03" },
              });
              await expect(
                prisma.$transaction(
                  async (tx) => {
                    await tx.$executeRaw`SET LOCAL lock_timeout = '100ms'`;
                    await tx.$executeRaw`DELETE FROM "TestCasePrerequisite" WHERE "projectId"=${projectId} AND "dependentId"=${b.id} AND "prerequisiteId"=${a.id}`;
                  },
                  { timeout: 2000 },
                ),
              ).rejects.toMatchObject({
                code: "P2010",
                meta: { code: "55P03" },
              });
            }
            return rows;
          },
        },
      },
    });
    const result = await writeFolderCopy(
      locked as unknown as PrismaClient,
      actorId,
      input,
    );
    expect(probed).toBe(true);
    expect(result.copiedPrerequisites).toHaveLength(1);
    expect(
      await prisma.testCasePrerequisite.count({
        where: { projectId, dependentId: outside.id },
      }),
    ).toBe(0);
    expect(
      await prisma.testCasePrerequisite.count({
        where: { projectId, dependentId: b.id, prerequisiteId: a.id },
      }),
    ).toBe(1);
  });
  it("retains original v3 receipt and hash for absent opt-in, while accepted v4 replay is historical and never restores later deleted links", async () => {
    await source("Independent");
    const p = await caller.copyPreview({
      projectId,
      fromPath: "Source",
      toPath: "Legacy",
    });
    const input = {
      projectId,
      fromPath: "Source",
      toPath: "Legacy",
      expectedHash: p.expectedHash,
      requestId: randomUUID(),
      confirmed: true as const,
      reason: "Exact legacy input",
    };
    const first = await caller.copyWrite(input),
      receipt = await prisma.caseFolderWrite.findUniqueOrThrow({
        where: { id: first.receiptId },
      });
    expect(receipt.inputHash).toBe(qualityProfileHash(input));
    expect(receipt.receipt).toMatchObject({ schemaVersion: 3 });
    expect(receipt.receipt).not.toHaveProperty("copiedPrerequisites");
    expect(await caller.copyWrite(input)).toEqual({
      ...first,
      recovered: true,
    });
    const a = await source("Login"),
      b = await source("Premium");
    await edge(b.id, a.id);
    const approvedInput = await approved(),
      copied = await caller.copyWrite(approvedInput);
    await prisma.testCasePrerequisite.deleteMany({
      where: { dependentId: { in: copied.copies.map((c) => c.caseId) } },
    });
    const replay = await caller.copyWrite(approvedInput);
    expect(replay.copiedPrerequisites).toEqual(copied.copiedPrerequisites);
    expect(
      await prisma.testCasePrerequisite.count({
        where: { dependentId: { in: copied.copies.map((c) => c.caseId) } },
      }),
    ).toBe(0);
  });
  it("refuses revoked-seat replay and unsupported tampered mapping without recreating records", async () => {
    const a = await source("A"),
      b = await source("B");
    await edge(b.id, a.id);
    const input = await approved(),
      result = await caller.copyWrite(input);
    await prisma.membership.update({
      where: { organizationId_userId: { organizationId, userId: actorId } },
      data: { seatType: "READ_ONLY" },
    });
    await expect(caller.copyWrite(input)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await prisma.membership.update({
      where: { organizationId_userId: { organizationId, userId: actorId } },
      data: { seatType: "FULL" },
    });
    const receipt = await prisma.caseFolderWrite.findUniqueOrThrow({
        where: { id: result.receiptId },
      }),
      body = receipt.receipt as Prisma.JsonObject;
    const tampered = {
      ...body,
      copiedPrerequisites: result.copiedPrerequisites.map((edge) => ({
        ...edge,
        prerequisiteId: a.id,
      })),
    };
    await expect(
      prisma.caseFolderWrite.update({
        where: { id: result.receiptId },
        data: {
          receipt: tampered,
        },
      }),
    ).rejects.toThrow("append-only");
    expect(
      await prisma.caseFolderWrite.findUniqueOrThrow({
        where: { id: result.receiptId },
      }),
    ).toEqual(receipt);
    let tamperedRead = false;
    const corruptRead = prisma.$extends({
      query: {
        caseFolderWrite: {
          async findUnique({ args, query }) {
            const row = await query(args);
            if (row?.id !== result.receiptId) return row;
            tamperedRead = true;
            return { ...row, receipt: tampered };
          },
        },
      },
    });
    await expect(
      writeFolderCopy(corruptRead as unknown as PrismaClient, actorId, input),
    ).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(tamperedRead).toBe(true);
    expect(
      await prisma.caseFolderWrite.findUniqueOrThrow({
        where: { id: result.receiptId },
      }),
    ).toEqual(receipt);
    expect(await caller.copyWrite(input)).toEqual({
      ...result,
      recovered: true,
    });
    expect(
      await prisma.testCase.count({
        where: { projectId, suitePath: { startsWith: "Copy" } },
      }),
    ).toBe(2);
  });
  it("refuses accepted graph replay after same-project reparent even when the actor owns both organizations", async () => {
    const a = await source("A"),
      b = await source("B");
    await edge(b.id, a.id);
    const reviewedInput = await approved();
    const { expectedScope: originalScope, ...input } = reviewedInput;
    const original = await caller.copyWrite(input);
    const tier = await prisma.planTier.findUniqueOrThrow({
      where: { key: "free" },
    });
    const slug = `${tag}-${randomUUID()}`;
    const other = await prisma.organization.create({
      data: { name: slug, slug, planTierId: tier.id },
    });
    try {
      await prisma.membership.create({
        data: {
          organizationId: other.id,
          userId: actorId,
          role: "OWNER",
          seatType: "FULL",
        },
      });
      await prisma.project.update({
        where: { id: projectId },
        data: { organizationId: other.id },
      });
      await expect(caller.copyWrite(input)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      // Explicit old scope is rejected before input-hash/receipt replay too.
      await expect(
        caller.copyWrite({ ...input, expectedScope: originalScope }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    } finally {
      await prisma.project.update({
        where: { id: projectId },
        data: { organizationId },
      });
      const receipt = await hardDeleteOrganization(
        prisma,
        other.id,
        actorId,
        "Owned reparent fixture cleanup",
      );
      expect(
        (
          await prisma.organizationDeletionLog.deleteMany({
            where: {
              id: receipt.deletionLogId,
              organizationId: other.id,
              organizationSlug: other.slug,
              deletedById: actorId,
            },
          })
        ).count,
      ).toBe(1);
    }
    expect(await caller.copyWrite(input)).toEqual({
      ...original,
      recovered: true,
    });
  });
});
