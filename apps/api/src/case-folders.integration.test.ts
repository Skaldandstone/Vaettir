import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { prisma, type PrismaClient } from "@vaettir/db";
import { appRouter } from "./router.js";
import { writeCaseFolderChange } from "./services/caseFolders.js";
import {
  previewOrgHardDelete,
  hardDeleteOrganization,
} from "./services/orgHardDelete.js";

describe("independent and reviewed populated folder lifecycle (owned synthetic DB)", () => {
  const owned: Array<{
    organizationId: string;
    slug: string;
    actorId?: string;
    receipts: string[];
  }> = [];
  let owner: ReturnType<typeof appRouter.createCaller>,
    outsider: typeof owner,
    projectId: string,
    foreignProjectId: string,
    orgId: string,
    actorId: string;
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
    if (
      !["127.0.0.1", "localhost"].includes(url.hostname) ||
      !url.pathname.includes("test") ||
      url.searchParams.has("host")
    )
      throw Error("Isolated loopback test DB required");
    const tier = await prisma.planTier.findUniqueOrThrow({
      where: { key: "free" },
    });
    async function setup(suffix: string) {
      const key = `folder-${suffix}-${randomUUID()}`;
      const org = await prisma.organization.create({
        data: { name: key, slug: key, planTierId: tier.id },
      });
      const fixture: (typeof owned)[number] = {
        organizationId: org.id,
        slug: key,
        receipts: [],
      };
      owned.push(fixture);
      const user = await prisma.user.create({
        data: {
          email: `${key}@example.com`,
          clerkUserId: key,
          memberships: {
            create: { organizationId: org.id, role: "OWNER", seatType: "FULL" },
          },
        },
        include: { memberships: true },
      });
      fixture.actorId = user.id;
      const caller = appRouter.createCaller({ prisma, user });
      const project = await caller.project.create({
        organizationId: org.id,
        name: key,
      });
      return { caller, project, org, user };
    }
    const a = await setup("owner"),
      b = await setup("foreign");
    owner = a.caller;
    outsider = b.caller;
    projectId = a.project.id;
    foreignProjectId = b.project.id;
    orgId = a.org.id;
    actorId = a.user.id;
  });
  afterAll(async () => {
    for (const fixture of owned) {
      const org = await prisma.organization.findUnique({
        where: { id: fixture.organizationId },
      });
      if (!fixture.actorId)
        throw Error(
          "Owned folder lifecycle actor unavailable; preserve partial setup",
        );
      if (org) {
        if (org.slug !== fixture.slug)
          throw Error("Owned folder lifecycle scope mismatch");
        const receipt = await hardDeleteOrganization(
          prisma,
          org.id,
          fixture.actorId,
          "Owned folder lifecycle fixture cleanup",
        );
        fixture.receipts.push(receipt.deletionLogId);
      }
      for (const receiptId of fixture.receipts) {
        expect(
          (
            await prisma.organizationDeletionLog.deleteMany({
              where: {
                id: receiptId,
                organizationId: fixture.organizationId,
                organizationSlug: fixture.slug,
                deletedById: fixture.actorId,
              },
            })
          ).count,
        ).toBe(1);
      }
    }
    for (const fixture of owned)
      expect(
        (
          await prisma.user.deleteMany({
            where: { id: fixture.actorId, clerkUserId: fixture.slug },
          })
        ).count,
      ).toBe(1);
  });
  async function request(
    action: "CREATE" | "RENAME" | "MOVE",
    toPath: string,
    fromPath?: string,
  ) {
    const input = {
      projectId,
      action,
      toPath,
      ...(fromPath ? { fromPath } : {}),
    };
    const preview = await owner.caseFolders.preview(input);
    return {
      ...input,
      expectedHash: preview.expectedHash,
      confirmed: true as const,
      requestId: randomUUID(),
      reason: "Synthetic reviewed folder change",
    };
  }
  it("creates persistent empty folders without placeholder cases and recovers one actor-bound request", async () => {
    const count = await prisma.testCase.count({ where: { projectId } });
    const input = await request("CREATE", "Empty");
    const first = await owner.caseFolders.write(input);
    expect(await owner.caseFolders.write(input)).toEqual({
      ...first,
      recovered: true,
    });
    expect((await owner.caseFolders.list({ projectId })).paths).toContain(
      "Empty",
    );
    expect(await prisma.testCase.count({ where: { projectId } })).toBe(count);
    await expect(
      owner.caseFolders.write({
        ...input,
        reason: "Different reviewed content",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const originalFolder = (
      await owner.caseFolders.list({ projectId })
    ).folders.find((f) => f.path === "Empty")!;
    await owner.caseFolders.write(
      await request("RENAME", "EmptyRenamed", "Empty"),
    );
    await owner.caseFolders.write(await request("CREATE", "Empty"));
    const folders = (await owner.caseFolders.list({ projectId })).folders;
    expect(folders.find((f) => f.path === "EmptyRenamed")?.id).toBe(
      originalFolder.id,
    );
    expect(folders.find((f) => f.path === "Empty")?.id).not.toBe(
      originalFolder.id,
    );
  });
  it("renames populated nested suites atomically without changing IDs, order, original procedures or historical versions", async () => {
    const tc = await owner.testCases.create({
      projectId,
      title: "Exact login procedure",
      testType: "FUNCTIONAL",
      suitePath: "Original/Login",
      given: ["Original setup"],
      when: ["Original action"],
      then: ["Original result"],
    });
    await prisma.testCase.update({
      where: { id: tc.id },
      data: { sortPosition: 7 },
    });
    const before = await prisma.testCase.findUniqueOrThrow({
      where: { id: tc.id },
      include: { versions: true },
    });
    const run = await owner.manualExecution.start({
      projectId,
      testCaseIds: [tc.id],
    });
    const frozen = (await owner.manualExecution.getForExecution(run))
      .executionContext;
    const input = await request("RENAME", "Renamed", "Original");
    const preview = await owner.caseFolders.preview({
      projectId,
      action: "RENAME",
      fromPath: "Original",
      toPath: "Renamed",
    });
    expect(preview.caseCount).toBe(1);
    const result = await owner.caseFolders.write(input);
    const after = await prisma.testCase.findUniqueOrThrow({
      where: { id: tc.id },
      include: { versions: { orderBy: { versionNumber: "asc" } } },
    });
    expect(after).toMatchObject({
      id: before.id,
      displayId: before.displayId,
      caseNumber: before.caseNumber,
      sortPosition: 7,
      suitePath: "Renamed/Login",
      given: before.given,
      when: before.when,
      then: before.then,
    });
    expect(after.versions.slice(0, before.versions.length)).toEqual(
      [...before.versions].sort((a, b) => a.versionNumber - b.versionNumber),
    );
    expect(after.versions.length).toBe(before.versions.length + 1);
    expect(
      (await owner.manualExecution.getForExecution(run)).executionContext,
    ).toEqual(frozen);
    const saved = await prisma.caseFolderWrite.findUniqueOrThrow({
      where: { id: result.receiptId },
    });
    expect(saved.receipt).toMatchObject({
      fromPath: "Original",
      toPath: "Renamed",
      moves: [
        {
          id: tc.id,
          fromSuitePath: "Original/Login",
          toSuitePath: "Renamed/Login",
          sortPosition: 7,
          newVersion: before.versions.length + 1,
        },
      ],
    });
  });
  it("refuses descendant cycles, destination merging and stale human edits without partial case changes", async () => {
    await expect(
      owner.caseFolders.preview({
        projectId,
        action: "MOVE",
        fromPath: "Renamed",
        toPath: "Renamed/Login/Renamed",
      }),
    ).rejects.toThrow("descendants");
    await owner.caseFolders.write(await request("CREATE", "Occupied"));
    await expect(
      owner.caseFolders.preview({
        projectId,
        action: "RENAME",
        fromPath: "Renamed",
        toPath: "Occupied",
      }),
    ).rejects.toThrow("Destination");
    const input = await request("RENAME", "FreshName", "Renamed");
    const tc = await prisma.testCase.findFirstOrThrow({
      where: { projectId, suitePath: "Renamed/Login" },
    });
    if (tc.suitePath === null)
      throw Error("Owned populated folder placement is unavailable");
    const current = await owner.testCases.byId({ id: tc.id });
    await owner.testCases.update({
      id: tc.id,
      title: "Later human edit",
      testType: tc.testType,
      given: tc.given,
      when: tc.when,
      then: tc.then,
      // Full-content authoring carries the exact current placement; this edit
      // intentionally changes only the title before stale folder approval.
      suitePath: tc.suitePath,
      expectedCaseRevision: current.caseRevision,
    });
    await expect(owner.caseFolders.write(input)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(
      (await prisma.testCase.findUniqueOrThrow({ where: { id: tc.id } }))
        .suitePath,
    ).toBe("Renamed/Login");
    expect(
      await prisma.caseFolderWrite.count({
        where: { projectId, requestId: input.requestId },
      }),
    ).toBe(0);
  });
  it("moves archived/source-derived cases without changing source provenance and refuses oversized atomic subtrees", async () => {
    const tc = await owner.testCases.create({
      projectId,
      title: "Source-derived archived fixture",
      testType: "FUNCTIONAL",
      steps: [{ action: "Exact source-derived procedure" }],
    });
    const source = await prisma.testCaseSource.create({
      data: {
        testCaseId: tc.id,
        filePath: "Legacy/Console",
        framework: "synthetic",
      },
    });
    await prisma.testCase.update({
      where: { id: tc.id },
      data: { archived: true },
    });
    const preview = await owner.caseFolders.preview({
      projectId,
      action: "MOVE",
      fromPath: "Legacy",
      toPath: "Empty/Legacy",
    });
    expect(preview).toMatchObject({ caseCount: 1, archivedCaseCount: 1 });
    await owner.caseFolders.write(
      await request("MOVE", "Empty/Legacy", "Legacy"),
    );
    expect(
      await prisma.testCaseSource.findUniqueOrThrow({
        where: { id: source.id },
      }),
    ).toEqual(source);
    expect(
      await prisma.testCase.findUniqueOrThrow({ where: { id: tc.id } }),
    ).toMatchObject({ suitePath: "Empty/Legacy/Console", archived: true });
    await prisma.testCase.createMany({
      data: Array.from({ length: 1001 }, (_, i) => ({
        projectId,
        title: `Bounded subtree fixture ${i}`,
        testType: "FUNCTIONAL" as const,
        given: ["Setup"],
        when: ["Action"],
        then: ["Result"],
        tags: [],
        suitePath: "Oversized",
      })),
    });
    await expect(
      owner.caseFolders.preview({
        projectId,
        action: "RENAME",
        fromPath: "Oversized",
        toPath: "NoPartial",
      }),
    ).rejects.toThrow("1,000");
    expect(
      await prisma.testCase.count({
        where: { projectId, suitePath: "Oversized" },
      }),
    ).toBe(1001);
    expect(
      await prisma.testCase.count({
        where: { projectId, suitePath: "NoPartial" },
      }),
    ).toBe(0);
  });
  it("serializes identical concurrent receipts once and refuses fresh foreign or revoked access", async () => {
    const input = await request("CREATE", "Parallel");
    const results = await Promise.all([
      owner.caseFolders.write(input),
      owner.caseFolders.write(input),
    ]);
    expect(new Set(results.map((r) => r.receiptId)).size).toBe(1);
    await expect(
      outsider.caseFolders.list({ projectId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(outsider.caseFolders.write(input)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await prisma.membership.update({
      where: {
        organizationId_userId: { organizationId: orgId, userId: actorId },
      },
      data: { seatType: "READ_ONLY" },
    });
    try {
      await expect(owner.caseFolders.write(input)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    } finally {
      await prisma.membership.update({
        where: {
          organizationId_userId: { organizationId: orgId, userId: actorId },
        },
        data: { seatType: "FULL" },
      });
    }
  });
  it("refuses a reparented project after review even when the actor now has both organization memberships", async () => {
    const input = await request("CREATE", "ReparentReview");
    const foreign = await prisma.project.findUniqueOrThrow({
      where: { id: foreignProjectId },
    });
    await prisma.membership.create({
      data: {
        organizationId: foreign.organizationId,
        userId: actorId,
        role: "OWNER",
        seatType: "FULL",
      },
    });
    try {
      await prisma.project.update({
        where: { id: projectId },
        data: { organizationId: foreign.organizationId },
      });
      await expect(owner.caseFolders.write(input)).rejects.toMatchObject({
        code: "CONFLICT",
      });
      expect(
        await prisma.caseFolderWrite.count({
          where: { projectId, requestId: input.requestId },
        }),
      ).toBe(0);
      expect((await owner.caseFolders.list({ projectId })).paths).not.toContain(
        "ReparentReview",
      );
    } finally {
      await prisma.project.update({
        where: { id: projectId },
        data: { organizationId: orgId },
      });
      await prisma.membership.delete({
        where: {
          organizationId_userId: {
            organizationId: foreign.organizationId,
            userId: actorId,
          },
        },
      });
    }
  });
  it("rolls back every placement and version if a later history append fails", async () => {
    const cases = await Promise.all(
      [0, 1].map((i) =>
        owner.testCases.create({
          projectId,
          title: `Atomic failure fixture ${i}`,
          testType: "FUNCTIONAL",
          suitePath: "Rollback",
          steps: [{ action: "Original retained step" }],
        }),
      ),
    );
    const before = await prisma.testCase.findMany({
      where: { id: { in: cases.map((c) => c.id) } },
      include: { versions: { orderBy: { versionNumber: "asc" } } },
      orderBy: { id: "asc" },
    });
    const input = await request("RENAME", "NeverPartial", "Rollback");
    let creates = 0;
    const failing = prisma.$extends({
      query: {
        testCaseVersion: {
          async create({ args, query }) {
            if (++creates === 2)
              throw Error("Synthetic second snapshot refusal");
            return query(args);
          },
        },
      },
    });
    await expect(
      writeCaseFolderChange(failing as unknown as PrismaClient, actorId, input),
    ).rejects.toThrow("Synthetic second snapshot refusal");
    expect(creates).toBe(2);
    expect(
      await prisma.testCase.findMany({
        where: { id: { in: cases.map((c) => c.id) } },
        include: { versions: { orderBy: { versionNumber: "asc" } } },
        orderBy: { id: "asc" },
      }),
    ).toEqual(before);
    expect(
      await prisma.caseFolderWrite.count({
        where: { projectId, requestId: input.requestId },
      }),
    ).toBe(0);
    expect((await owner.caseFolders.list({ projectId })).paths).not.toContain(
      "NeverPartial",
    );
  });
  it("rejects oversized legacy procedure content before loading and appending case snapshots", async () => {
    const tc = await owner.testCases.create({
      projectId,
      title: "Bounded legacy body",
      testType: "FUNCTIONAL",
      suitePath: "LargeBody",
      steps: [{ action: "Synthetic original" }],
    });
    await prisma.testCase.update({
      where: { id: tc.id },
      data: { background: "x".repeat(8 * 1024 * 1024 + 1) },
    });
    const input = await request("RENAME", "NoLargeBodyMove", "LargeBody");
    const versionCount = await prisma.testCaseVersion.count({
      where: { testCaseId: tc.id },
    });
    await expect(owner.caseFolders.write(input)).rejects.toThrow("8 MiB");
    expect(
      (await prisma.testCase.findUniqueOrThrow({ where: { id: tc.id } }))
        .suitePath,
    ).toBe("LargeBody");
    expect(
      await prisma.testCaseVersion.count({ where: { testCaseId: tc.id } }),
    ).toBe(versionCount);
    expect(
      await prisma.caseFolderWrite.count({
        where: { projectId, requestId: input.requestId },
      }),
    ).toBe(0);
  });
  it("retains immutable placement receipts and erases only their explicit synthetic organization scope", async () => {
    const row = await prisma.caseFolderWrite.findFirstOrThrow({
      where: { projectId },
    });
    await expect(
      prisma.caseFolderWrite.update({
        where: { id: row.id },
        data: { receipt: { replaced: true } },
      }),
    ).rejects.toThrow("append-only");
    await expect(
      prisma.caseFolderWrite.delete({ where: { id: row.id } }),
    ).rejects.toThrow("append-only");
    const foreign = await outsider.caseFolders.preview({
      projectId: foreignProjectId,
      action: "CREATE",
      toPath: "Foreign",
    });
    await outsider.caseFolders.write({
      projectId: foreignProjectId,
      action: "CREATE",
      toPath: "Foreign",
      expectedHash: foreign.expectedHash,
      requestId: randomUUID(),
      confirmed: true,
      reason: "Foreign sentinel",
    });
    const sentinel = await prisma.caseFolderWrite.findMany({
      where: { projectId: foreignProjectId },
    });
    const preview = await previewOrgHardDelete(prisma, orgId);
    expect(preview.rowCounts.CaseFolderWrite).toBeGreaterThan(0);
    const deletion = await hardDeleteOrganization(
      prisma,
      orgId,
      actorId,
      "Explicit isolated folder fixture erasure",
    );
    const fixture = owned.find((entry) => entry.organizationId === orgId);
    if (!fixture || fixture.actorId !== actorId)
      throw Error("Owned erasure receipt scope mismatch");
    fixture.receipts.push(deletion.deletionLogId);
    expect(
      await prisma.caseFolderWrite.findMany({
        where: { projectId: foreignProjectId },
      }),
    ).toEqual(sentinel);
  });
});
