import { randomUUID } from "node:crypto";
import { beforeEach, describe, it, expect } from "vitest";
import { prisma, type PrismaClient, type Prisma } from "@vaettir/db";
import { appRouter } from "./router.js";
import { writeFolderRecovery } from "./services/caseFolderRecovery.js";

describe("non-destructive reviewed folder recovery (authored; morning validation pending)", () => {
  let owner: ReturnType<typeof appRouter.createCaller>,
    outsider: typeof owner,
    projectId: string,
    foreignProjectId: string,
    actorId: string,
    orgId: string;
  beforeEach(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
    if (
      !["localhost", "127.0.0.1"].includes(url.hostname) ||
      !url.pathname.includes("test") ||
      url.searchParams.has("host")
    )
      throw Error("Isolated loopback test DB required");
    const tier = await prisma.planTier.findUniqueOrThrow({
      where: { key: "free" },
    });
    async function setup() {
      const key = `folder-recovery-${randomUUID()}`;
      const org = await prisma.organization.create({
        data: { name: key, slug: key, planTierId: tier.id },
      });
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
      const caller = appRouter.createCaller({ prisma, user });
      const project = await caller.project.create({
        organizationId: org.id,
        name: key,
      });
      return { caller, project, user, org };
    }
    const a = await setup(),
      b = await setup();
    owner = a.caller;
    outsider = b.caller;
    projectId = a.project.id;
    foreignProjectId = b.project.id;
    actorId = a.user.id;
    orgId = a.org.id;
  });
  async function renamed(count = 1) {
    const cases = await Promise.all(
      Array.from({ length: count }, (_, i) =>
        owner.testCases.create({
          projectId,
          title: `Exact retained case ${i}`,
          suitePath: "Old/Login",
          testType: "FUNCTIONAL",
          given: ["Exact Given"],
          when: ["Exact When"],
          then: ["Exact Then"],
          steps: [
            {
              action: "Exact structured action",
              expectedResult: "Exact structured result",
            },
          ],
        }),
      ),
    );
    const preview = await owner.caseFolders.preview({
      projectId,
      action: "RENAME",
      fromPath: "Old",
      toPath: "New",
    });
    const result = await owner.caseFolders.write({
      projectId,
      action: "RENAME",
      fromPath: "Old",
      toPath: "New",
      expectedHash: preview.expectedHash,
      requestId: randomUUID(),
      confirmed: true,
      reason: "Synthetic exact rename",
    });
    return { cases, originalReceiptId: result.receiptId };
  }
  async function approved(originalReceiptId: string) {
    const preview = await owner.caseFolders.recoveryPreview({
      projectId,
      originalReceiptId,
    });
    return {
      projectId,
      originalReceiptId,
      expectedHash: preview.expectedHash,
      requestId: randomUUID(),
      confirmed: true as const,
      reason: "Reviewed original placement recovery",
    };
  }
  it("restores original placement as a new version and inverse receipt without changing any procedure or frozen run evidence", async () => {
    const fixture = await renamed();
    const tc = fixture.cases[0]!;
    const applied = await prisma.testCase.findUniqueOrThrow({
      where: { id: tc.id },
      include: { steps: true, versions: { orderBy: { versionNumber: "asc" } } },
    });
    const run = await owner.manualExecution.start({
      projectId,
      testCaseIds: [tc.id],
    });
    const frozen = (await owner.manualExecution.getForExecution(run))
      .executionContext;
    const original = await prisma.caseFolderWrite.findUniqueOrThrow({
      where: { id: fixture.originalReceiptId },
    });
    const input = await approved(fixture.originalReceiptId);
    const result = await owner.caseFolders.recoveryWrite(input);
    expect(result.destinationPath).toBe("Old");
    const restored = await prisma.testCase.findUniqueOrThrow({
      where: { id: tc.id },
      include: { steps: true, versions: { orderBy: { versionNumber: "asc" } } },
    });
    expect(restored).toMatchObject({
      id: applied.id,
      displayId: applied.displayId,
      caseNumber: applied.caseNumber,
      suitePath: "Old/Login",
      sortPosition: applied.sortPosition,
      given: applied.given,
      when: applied.when,
      then: applied.then,
      background: applied.background,
      steps: applied.steps,
    });
    expect(restored.versions.slice(0, applied.versions.length)).toEqual(
      applied.versions,
    );
    expect(restored.versions.length).toBe(applied.versions.length + 1);
    expect(
      (await owner.manualExecution.getForExecution(run)).executionContext,
    ).toEqual(frozen);
    expect(
      await prisma.caseFolderWrite.findUniqueOrThrow({
        where: { id: original.id },
      }),
    ).toEqual(original);
    expect(
      (
        await prisma.caseFolderWrite.findUniqueOrThrow({
          where: { id: result.receiptId },
        })
      ).receipt,
    ).toMatchObject({
      schemaVersion: 2,
      action: "RESTORE",
      originalReceiptId: original.id,
      moves: [
        {
          id: tc.id,
          fromSuitePath: "New/Login",
          toSuitePath: "Old/Login",
          priorVersion: 2,
          newVersion: 3,
        },
      ],
    });
  });
  it("refuses changed own content, identity/order/archive/source or subtree membership after the original operation", async () => {
    const fixture = await renamed();
    const tc = fixture.cases[0]!;
    const input = await approved(fixture.originalReceiptId);
    await prisma.testCase.update({
      where: { id: tc.id },
      data: { sortPosition: 99 },
    });
    await expect(owner.caseFolders.recoveryWrite(input)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(
      (await prisma.testCase.findUniqueOrThrow({ where: { id: tc.id } }))
        .suitePath,
    ).toBe("New/Login");
    await prisma.testCase.update({
      where: { id: tc.id },
      data: { sortPosition: 0 },
    });
    await expect(
      owner.caseFolders.recoveryPreview({
        projectId,
        originalReceiptId: fixture.originalReceiptId,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" }); // Even a reverted edit has a new applied timestamp.
    const added = await owner.testCases.create({
      projectId,
      title: "Later added case",
      suitePath: "New/Login",
      testType: "FUNCTIONAL",
      steps: [{ action: "Retained later procedure" }],
    });
    await expect(
      owner.caseFolders.recoveryPreview({
        projectId,
        originalReceiptId: fixture.originalReceiptId,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      (await prisma.testCase.findUniqueOrThrow({ where: { id: added.id } }))
        .suitePath,
    ).toBe("New/Login");
  });
  it("refuses later folder changes and destination collisions instead of silently merging", async () => {
    const fixture = await renamed();
    const preview = await owner.caseFolders.preview({
      projectId,
      action: "CREATE",
      toPath: "Old",
    });
    await owner.caseFolders.write({
      projectId,
      action: "CREATE",
      toPath: "Old",
      expectedHash: preview.expectedHash,
      requestId: randomUUID(),
      confirmed: true,
      reason: "Later intentional folder",
    });
    await expect(
      owner.caseFolders.recoveryPreview({
        projectId,
        originalReceiptId: fixture.originalReceiptId,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await owner.caseFolders.list({ projectId })).paths).toContain(
      "Old",
    );
    expect(
      (
        await prisma.testCase.findUniqueOrThrow({
          where: { id: fixture.cases[0]!.id },
        })
      ).suitePath,
    ).toBe("New/Login");
  });
  it.each([
    "own procedure without updatedAt",
    "archive state",
    "source provenance",
  ])("refuses an independently changed %s applied baseline", async (kind) => {
    const fixture = await renamed();
    const tc = fixture.cases[0]!;
    const input = await approved(fixture.originalReceiptId);
    if (kind === "own procedure without updatedAt")
      await prisma.$executeRaw`UPDATE "TestCase" SET title='Later synthetic body edit' WHERE id=${tc.id} AND "projectId"=${projectId}`;
    if (kind === "archive state")
      await prisma.testCase.update({
        where: { id: tc.id },
        data: { archived: true },
      });
    if (kind === "source provenance")
      await prisma.testCaseSource.create({
        data: {
          testCaseId: tc.id,
          framework: "synthetic",
          filePath: "NewLaterSource",
        },
      });
    await expect(owner.caseFolders.recoveryWrite(input)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(
      (await prisma.testCase.findUniqueOrThrow({ where: { id: tc.id } }))
        .suitePath,
    ).toBe("New/Login");
    expect(
      await prisma.caseFolderWrite.count({
        where: { projectId, requestId: input.requestId },
      }),
    ).toBe(0);
  });
  it("restores the exact null manual placement and retains original source-derived provenance", async () => {
    const tc = await owner.testCases.create({
      projectId,
      title: "Source-derived original",
      testType: "FUNCTIONAL",
      steps: [{ action: "Retain original source-derived action" }],
    });
    const source = await prisma.testCaseSource.create({
      data: {
        testCaseId: tc.id,
        filePath: "Old/Hardware",
        framework: "synthetic",
      },
    });
    const preview = await owner.caseFolders.preview({
      projectId,
      action: "RENAME",
      fromPath: "Old",
      toPath: "New",
    });
    const moved = await owner.caseFolders.write({
      projectId,
      action: "RENAME",
      fromPath: "Old",
      toPath: "New",
      expectedHash: preview.expectedHash,
      requestId: randomUUID(),
      confirmed: true,
      reason: "Source-derived synthetic move",
    });
    await owner.caseFolders.recoveryWrite(await approved(moved.receiptId));
    expect(
      (await prisma.testCase.findUniqueOrThrow({ where: { id: tc.id } }))
        .suitePath,
    ).toBeNull();
    expect(
      await prisma.testCaseSource.findUniqueOrThrow({
        where: { id: source.id },
      }),
    ).toEqual(source);
  });
  it("recovers one exact lost-response identity, rejects altered approval and rechecks revoked or foreign access before receipt recovery", async () => {
    const fixture = await renamed();
    const input = await approved(fixture.originalReceiptId);
    const [a, b] = await Promise.all([
      owner.caseFolders.recoveryWrite(input),
      owner.caseFolders.recoveryWrite(input),
    ]);
    expect(a.receiptId).toBe(b.receiptId);
    expect([a.recovered, b.recovered].sort()).toEqual([false, true]);
    expect(await owner.caseFolders.recoveryWrite(input)).toEqual({
      ...a,
      recovered: true,
    });
    await expect(
      owner.caseFolders.recoveryWrite({ ...input, reason: "Changed approval" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      outsider.caseFolders.recoveryPreview({
        projectId: foreignProjectId,
        originalReceiptId: fixture.originalReceiptId,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      outsider.caseFolders.recoveryWrite(input),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await prisma.membership.update({
      where: {
        organizationId_userId: { organizationId: orgId, userId: actorId },
      },
      data: { seatType: "READ_ONLY" },
    });
    await expect(owner.caseFolders.recoveryWrite(input)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
  it("rejects an incomplete legacy receipt rather than fabricate an applied-state baseline", async () => {
    const fixture = await renamed();
    const source = await prisma.caseFolderWrite.findUniqueOrThrow({
      where: { id: fixture.originalReceiptId },
    });
    const legacy = JSON.parse(JSON.stringify(source.receipt)) as {
      moves: Array<Record<string, unknown>>;
    };
    delete legacy.moves[0]!.appliedCaseHash;
    const row = await prisma.caseFolderWrite.create({
      data: {
        projectId,
        actorId,
        requestId: randomUUID(),
        inputHash: "a".repeat(64),
        receipt: legacy as unknown as Prisma.InputJsonValue,
      },
    });
    await expect(
      owner.caseFolders.recoveryPreview({
        projectId,
        originalReceiptId: row.id,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      (
        await prisma.testCase.findUniqueOrThrow({
          where: { id: fixture.cases[0]!.id },
        })
      ).suitePath,
    ).toBe("New/Login");
  });
  it("refuses recovered receipt identities after organization reparenting despite fresh access in both tenants", async () => {
    const fixture = await renamed();
    const input = await approved(fixture.originalReceiptId);
    await owner.caseFolders.recoveryWrite(input);
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
      await expect(
        owner.caseFolders.recoveryWrite(input),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        owner.caseFolders.recoveryPreview({
          projectId,
          originalReceiptId: fixture.originalReceiptId,
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(await owner.caseFolders.recoveryOptions({ projectId })).toEqual(
        [],
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
  it("rolls back all inverse placements and snapshots when a later append fails", async () => {
    const fixture = await renamed(2);
    const input = await approved(fixture.originalReceiptId);
    const ids = fixture.cases.map((c) => c.id);
    const before = await prisma.testCase.findMany({
      where: { id: { in: ids } },
      include: { versions: { orderBy: { versionNumber: "asc" } } },
      orderBy: { id: "asc" },
    });
    let append = 0;
    const failing = prisma.$extends({
      query: {
        testCaseVersion: {
          async create({ args, query }) {
            if (++append === 2)
              throw Error("Synthetic inverse snapshot failure");
            return query(args);
          },
        },
      },
    });
    await expect(
      writeFolderRecovery(failing as unknown as PrismaClient, actorId, input),
    ).rejects.toThrow("Synthetic inverse snapshot failure");
    expect(append).toBe(2);
    expect(
      await prisma.testCase.findMany({
        where: { id: { in: ids } },
        include: { versions: { orderBy: { versionNumber: "asc" } } },
        orderBy: { id: "asc" },
      }),
    ).toEqual(before);
    expect(
      await prisma.caseFolderWrite.count({
        where: { projectId, requestId: input.requestId },
      }),
    ).toBe(0);
  });
});
