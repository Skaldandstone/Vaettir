import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, it, expect } from "vitest";
import { prisma, type PrismaClient } from "@vaettir/db";
import { appRouter } from "./router.js";
import { writeFolderCopy } from "./services/caseFolderCopy.js";
import { hardDeleteOrganization } from "./services/orgHardDelete.js";

describe("reviewed atomic same-project folder copy (owned synthetic DB)", () => {
  let owned: Array<{ organizationId: string; slug: string; actorId?: string }> =
    [];
  let owner: ReturnType<typeof appRouter.createCaller>,
    outsider: typeof owner,
    projectId: string,
    foreignProjectId: string,
    orgId: string,
    actorId: string;
  beforeEach(async () => {
    owned = [];
    const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
    if (
      !["localhost", "127.0.0.1"].includes(url.hostname) ||
      !url.pathname.includes("test") ||
      url.searchParams.has("host")
    )
      throw Error("Disposable loopback test database required");
    const tier = await prisma.planTier.findUniqueOrThrow({
      where: { key: "free" },
    });
    async function setup() {
      const key = `folder-copy-${randomUUID()}`;
      const org = await prisma.organization.create({
        data: { name: key, slug: key, planTierId: tier.id },
      });
      const fixture: (typeof owned)[number] = {
        organizationId: org.id,
        slug: key,
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
    const a = await setup(),
      b = await setup();
    owner = a.caller;
    outsider = b.caller;
    projectId = a.project.id;
    foreignProjectId = b.project.id;
    orgId = a.org.id;
    actorId = a.user.id;
  });
  afterEach(async () => {
    for (const fixture of owned) {
      const org = await prisma.organization.findUnique({
        where: { id: fixture.organizationId },
      });
      if (!org || org.slug !== fixture.slug || !fixture.actorId)
        throw Error(
          "Owned folder-copy cleanup scope is incomplete; preserve it for inspection",
        );
      const actor = await prisma.user.findUnique({
        where: { id: fixture.actorId },
        select: { clerkUserId: true },
      });
      if (actor?.clerkUserId !== fixture.slug)
        throw Error("Owned folder-copy actor mismatch");
      const receipt = await hardDeleteOrganization(
        prisma,
        org.id,
        fixture.actorId,
        "Owned folder-copy fixture cleanup",
      );
      expect(
        (
          await prisma.organizationDeletionLog.deleteMany({
            where: {
              id: receipt.deletionLogId,
              organizationId: org.id,
              organizationSlug: fixture.slug,
              deletedById: fixture.actorId,
            },
          })
        ).count,
      ).toBe(1);
    }
    // Every owned organization is gone before deleting any owned actor.
    for (const fixture of owned)
      expect(
        (
          await prisma.user.deleteMany({
            where: { id: fixture.actorId, clerkUserId: fixture.slug },
          })
        ).count,
      ).toBe(1);
  });
  async function folder(path: string) {
    const preview = await owner.caseFolders.preview({
      projectId,
      action: "CREATE",
      toPath: path,
    });
    await owner.caseFolders.write({
      projectId,
      action: "CREATE",
      toPath: path,
      expectedHash: preview.expectedHash,
      requestId: randomUUID(),
      confirmed: true,
      reason: "Synthetic empty folder",
    });
  }
  async function source(title = "Exact mixed-format case") {
    return owner.testCases.create({
      projectId,
      title,
      suitePath: "Original/Login",
      testType: "FUNCTIONAL",
      background: "Exact setup",
      given: ["Exact Given"],
      when: ["Exact When"],
      then: ["Exact Then"],
      tags: ["kept"],
      priority: "HIGH",
      steps: [
        {
          action: "Exact structured step",
          expectedResult: "Exact expected result",
        },
      ],
    });
  }
  async function approved() {
    const preview = await owner.caseFolders.copyPreview({
      projectId,
      fromPath: "Original",
      toPath: "Copied",
    });
    return {
      projectId,
      fromPath: "Original",
      toPath: "Copied",
      expectedHash: preview.expectedHash,
      requestId: randomUUID(),
      confirmed: true as const,
      reason: "Reviewed source and complete exclusions",
    };
  }
  it("copies independent empty nested folders with new identities and unchanged original folder IDs", async () => {
    await folder("Original");
    await folder("Original/Empty");
    const before = await owner.caseFolders.list({ projectId });
    const input = await approved();
    const preview = await owner.caseFolders.copyPreview({
      projectId,
      fromPath: "Original",
      toPath: "Copied",
    });
    expect(preview).toMatchObject({ caseCount: 0, folderCount: 2 });
    const result = await owner.caseFolders.copyWrite(input);
    expect(result.copies).toEqual([]);
    const after = await owner.caseFolders.list({ projectId });
    expect(after.paths).toEqual(
      expect.arrayContaining([
        "Original",
        "Original/Empty",
        "Copied",
        "Copied/Empty",
      ]),
    );
    for (const original of before.folders)
      expect(after.folders.find((f) => f.path === original.path)).toEqual(
        original,
      );
    expect(after.folders.find((f) => f.path === "Copied")?.id).not.toBe(
      before.folders.find((f) => f.path === "Original")?.id,
    );
    expect(await prisma.testCase.count({ where: { projectId } })).toBe(0);
  });
  it("allocates new native IDs once, preserves original mixed procedures and reviewed order, and does not copy approvals, paid drafts or run results", async () => {
    const a = await source("Later order"),
      b = await source("Earlier order");
    await prisma.testCase.update({
      where: { id: a.id },
      data: {
        sortPosition: 10,
        reviewStatus: "APPROVED",
        reviewedById: actorId,
        reviewedAt: new Date(),
        automationStatus: "AUTOMATED",
        riskSeverity: "HIGH",
        riskScore: 91,
      },
    });
    await prisma.testCase.update({
      where: { id: b.id },
      data: { sortPosition: 3 },
    });
    const draft = await prisma.automationDraft.create({
      data: {
        testCaseId: a.id,
        framework: "synthetic",
        createdById: actorId,
        status: "READY",
        content: {
          text: "Synthetic paid draft receipt fixture; never executed",
        },
      },
    });
    const run = await owner.manualExecution.start({
      projectId,
      testCaseIds: [a.id],
    });
    const originalContext = (await owner.manualExecution.getForExecution(run))
      .executionContext;
    const originalResult = await prisma.testResult.create({
      data: {
        testRunId: run.testRunId,
        testCaseId: a.id,
        status: "FAIL",
        note: "Synthetic retained original result; no test code executed",
      },
    });
    const before = await prisma.testCase.findMany({
      where: { id: { in: [a.id, b.id] } },
      include: {
        steps: { orderBy: { order: "asc" } },
        versions: { orderBy: { versionNumber: "asc" } },
      },
      orderBy: { id: "asc" },
    });
    const counter = await prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { nextCaseNumber: true },
    });
    const input = await approved();
    const [first, retry] = await Promise.all([
      owner.caseFolders.copyWrite(input),
      owner.caseFolders.copyWrite(input),
    ]);
    expect(first.receiptId).toBe(retry.receiptId);
    expect(first.copies).toEqual(retry.copies);
    expect(
      (await prisma.project.findUniqueOrThrow({ where: { id: projectId } }))
        .nextCaseNumber,
    ).toBe(counter.nextCaseNumber + 2);
    expect(new Set(first.copies.map((c) => c.caseId)).size).toBe(2);
    for (const copied of first.copies) {
      const original = before.find((c) => c.id === copied.sourceId)!;
      const created = await prisma.testCase.findUniqueOrThrow({
        where: { id: copied.caseId },
        include: {
          steps: { orderBy: { order: "asc" } },
          versions: true,
          automationDrafts: true,
          results: true,
        },
      });
      expect(created.id).not.toBe(original.id);
      expect(created.displayId).not.toBe(original.displayId);
      expect(created).toMatchObject({
        title: original.title,
        given: original.given,
        when: original.when,
        then: original.then,
        background: original.background,
        tags: original.tags,
        priority: original.priority,
        suitePath: "Copied/Login",
        reviewStatus: "PENDING_REVIEW",
        automationStatus: "MANUAL",
        reviewedById: null,
        reviewedAt: null,
        riskScore: null,
        riskSeverity: null,
        automationDrafts: [],
        results: [],
      });
      expect(
        created.steps.map((s) => ({
          action: s.action,
          expectedResult: s.expectedResult,
        })),
      ).toEqual(
        original.steps.map((s) => ({
          action: s.action,
          expectedResult: s.expectedResult,
        })),
      );
      expect(created.versions.length).toBe(1);
      expect(
        await prisma.auditLog.findFirst({
          where: { entityType: "TestCaseClone", entityId: created.id },
        }),
      ).toMatchObject({
        metadata: expect.objectContaining({
          sourceCaseId: original.id,
          sourceDisplayId: original.displayId,
        }),
      });
    }
    const ordered = await prisma.testCase.findMany({
      where: { projectId, suitePath: "Copied/Login" },
      orderBy: { sortPosition: "asc" },
    });
    expect(ordered.map((c) => c.title)).toEqual([
      "Earlier order",
      "Later order",
    ]);
    expect(
      await prisma.testCase.findMany({
        where: { id: { in: [a.id, b.id] } },
        include: {
          steps: { orderBy: { order: "asc" } },
          versions: { orderBy: { versionNumber: "asc" } },
        },
        orderBy: { id: "asc" },
      }),
    ).toEqual(before);
    expect(
      await prisma.automationDraft.findUniqueOrThrow({
        where: { id: draft.id },
      }),
    ).toEqual(draft);
    expect(
      await prisma.testResult.findUniqueOrThrow({
        where: { id: originalResult.id },
      }),
    ).toEqual(originalResult);
    expect(
      (await owner.manualExecution.getForExecution(run)).executionContext,
    ).toEqual(originalContext);
  });
  it("preserves valid required human fields and includes current schema in review CAS", async () => {
    const schema = {
      version: 1 as const,
      fields: [
        {
          key: "platform",
          label: "Platform",
          type: "CHOICE" as const,
          required: true,
          retired: false,
          options: ["Console", "PC"],
        },
      ],
    };
    const impact = await owner.caseFields.reviewSchema({ projectId, schema });
    await owner.caseFields.configure({
      projectId,
      schema,
      actorId: impact.actorId,
      expectedSchemaHash: impact.expectedSchemaHash,
      expectedImpactHash: impact.expectedImpactHash,
      requestId: randomUUID(),
      confirmed: true,
      reason: "Synthetic required platform field",
    });
    const fields = await owner.caseFields.get({ projectId });
    const tc = await owner.testCases.create({
      projectId,
      title: "Console-authored fixture",
      suitePath: "Original/Console",
      testType: "FUNCTIONAL",
      steps: [{ action: "Exact console operation" }],
      customFields: { platform: "Console" },
      expectedFieldSchemaHash: fields.expectedSchemaHash,
    });
    const preview = await owner.caseFolders.copyPreview({
      projectId,
      fromPath: "Original",
      toPath: "Copied",
    });
    expect(preview.cases[0]?.customFields).toEqual({ platform: "Console" });
    const result = await owner.caseFolders.copyWrite(await approved());
    expect(
      (
        await prisma.testCase.findUniqueOrThrow({
          where: { id: result.copies[0]!.caseId },
        })
      ).customFields,
    ).toEqual({ platform: "Console" });
    const alonePreview = await owner.caseClone.preview({
      projectId,
      caseId: tc.id,
    });
    const alone = await owner.caseClone.create({
      projectId,
      caseId: tc.id,
      expectedSourceRevision: alonePreview.expectedSourceRevision,
      title: "Independent current-field clone",
      suitePath: "Standalone",
      reason: "Synthetic standalone compatibility",
      confirmed: true,
      requestId: randomUUID(),
    });
    expect(
      (await prisma.testCase.findUniqueOrThrow({ where: { id: alone.caseId } }))
        .customFields,
    ).toEqual({ platform: "Console" });
  });
  it.each([
    "archived",
    "dataset",
    "attachment",
    "step media",
    "shared library",
    "prerequisite",
  ])(
    "refuses dependency-bearing %s sources without creating a partial destination",
    async (kind) => {
      const tc = await source();
      if (kind === "archived")
        await prisma.testCase.update({
          where: { id: tc.id },
          data: { archived: true },
        });
      if (kind === "dataset")
        await prisma.testCaseDataset.create({
          data: {
            testCaseId: tc.id,
            parameterNames: ["user"],
            rows: [{ name: "Synthetic", values: { user: "synthetic" } }],
          },
        });
      if (kind === "attachment")
        await prisma.testCaseAttachment.create({
          data: {
            testCaseId: tc.id,
            fileName: "Synthetic reference.txt",
            contentType: "text/plain",
            storageUrl: "synthetic://not-an-upload",
            sizeBytes: 1,
            uploadedById: actorId,
          },
        });
      if (kind === "step media")
        await prisma.testCaseStep.updateMany({
          where: { testCaseId: tc.id },
          data: {
            mediaAttachmentIds: ["synthetic-unavailable-media-reference"],
          },
        });
      if (kind === "shared library") {
        const group = await owner.sharedStepGroups.create({
          projectId,
          name: "Reviewed shared fixture",
          steps: [{ action: "Exact library operation" }],
        });
        await prisma.testCase.update({
          where: { id: tc.id },
          data: { sharedStepGroupId: group.id },
        });
      }
      if (kind === "prerequisite") {
        const prerequisite = await owner.testCases.create({
          projectId,
          title: "Required setup",
          suitePath: "Elsewhere",
          testType: "FUNCTIONAL",
          steps: [{ action: "Exact setup" }],
        });
        await prisma.testCasePrerequisite.create({
          data: {
            projectId,
            dependentId: tc.id,
            prerequisiteId: prerequisite.id,
            createdById: actorId,
          },
        });
      }
      await expect(
        owner.caseFolders.copyPreview({
          projectId,
          fromPath: "Original",
          toPath: "Copied",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(
        await prisma.testCase.count({
          where: { projectId, suitePath: { startsWith: "Copied" } },
        }),
      ).toBe(0);
      expect((await owner.caseFolders.list({ projectId })).paths).not.toContain(
        "Copied",
      );
    },
  );
  it("refuses stale source content, changed typed schema and destination collisions without silently refreshing approval", async () => {
    const tc = await source();
    const input = await approved();
    await prisma.$executeRaw`UPDATE "TestCase" SET title='Changed synthetic source body' WHERE id=${tc.id} AND "projectId"=${projectId}`;
    await expect(owner.caseFolders.copyWrite(input)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    const second = await approved();
    const schema = {
      version: 1 as const,
      fields: [
        {
          key: "note",
          label: "Note",
          type: "TEXT" as const,
          required: false,
          retired: false,
          options: [],
        },
      ],
    };
    const impact = await owner.caseFields.reviewSchema({ projectId, schema });
    await owner.caseFields.configure({
      projectId,
      schema,
      actorId: impact.actorId,
      expectedSchemaHash: impact.expectedSchemaHash,
      expectedImpactHash: impact.expectedImpactHash,
      confirmed: true,
      requestId: randomUUID(),
      reason: "Changed synthetic schema",
    });
    await expect(owner.caseFolders.copyWrite(second)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await folder("Copied");
    await expect(
      owner.caseFolders.copyPreview({
        projectId,
        fromPath: "Original",
        toPath: "Copied",
      }),
    ).rejects.toThrow("Destination");
    expect(
      await prisma.testCase.count({
        where: { projectId, suitePath: { startsWith: "Copied/" } },
      }),
    ).toBe(0);
  });
  it("refuses missing required or retired metadata rather than silently dropping original human values", async () => {
    const tc = await source();
    const schema = {
      version: 1 as const,
      fields: [
        {
          key: "note",
          label: "Required author note",
          type: "TEXT" as const,
          required: true,
          retired: false,
          options: [],
        },
      ],
    };
    let impact = await owner.caseFields.reviewSchema({ projectId, schema });
    await owner.caseFields.configure({
      projectId,
      schema,
      actorId: impact.actorId,
      expectedSchemaHash: impact.expectedSchemaHash,
      expectedImpactHash: impact.expectedImpactHash,
      confirmed: true,
      requestId: randomUUID(),
      reason: "Synthetic new required field",
    });
    await expect(
      owner.caseFolders.copyPreview({
        projectId,
        fromPath: "Original",
        toPath: "Copied",
      }),
    ).rejects.toThrow("Required author note");
    const fields = await owner.caseFields.get({ projectId, caseId: tc.id });
    await owner.caseFields.save({
      projectId,
      caseId: tc.id,
      values: { note: "Retained authored note" },
      expectedSchemaHash: fields.expectedSchemaHash,
      expectedValueHash: fields.expectedValueHash,
      confirmed: true,
      requestId: randomUUID(),
      reason: "Complete required author note",
    });
    const retired = {
      version: 1 as const,
      fields: [{ ...schema.fields[0]!, required: false, retired: true }],
    };
    impact = await owner.caseFields.reviewSchema({
      projectId,
      schema: retired,
    });
    await owner.caseFields.configure({
      projectId,
      schema: retired,
      actorId: impact.actorId,
      expectedSchemaHash: impact.expectedSchemaHash,
      expectedImpactHash: impact.expectedImpactHash,
      confirmed: true,
      requestId: randomUUID(),
      reason: "Synthetic retained field retirement",
    });
    await expect(
      owner.caseFolders.copyPreview({
        projectId,
        fromPath: "Original",
        toPath: "Copied",
      }),
    ).rejects.toThrow("compatible active definition");
    expect(
      (await prisma.testCase.findUniqueOrThrow({ where: { id: tc.id } }))
        .customFields,
    ).toEqual({ note: "Retained authored note" });
  });
  it("refuses more than 50 cases and oversized source bodies without substituting a partial batch", async () => {
    await prisma.testCase.createMany({
      data: Array.from({ length: 51 }, (_, i) => ({
        projectId,
        title: `Source bound fixture${i}`,
        testType: "FUNCTIONAL" as const,
        suitePath: "Original/Many",
        given: ["Setup"],
        when: ["Action"],
        then: ["Result"],
        tags: [],
      })),
    });
    await expect(
      owner.caseFolders.copyPreview({
        projectId,
        fromPath: "Original",
        toPath: "Copied",
      }),
    ).rejects.toThrow("50");
    const tc = await owner.testCases.create({
      projectId,
      title: "Huge retained body",
      testType: "FUNCTIONAL",
      suitePath: "Large",
      steps: [{ action: "Unchanged step" }],
    });
    await prisma.testCase.update({
      where: { id: tc.id },
      data: { background: "x".repeat(8 * 1024 * 1024 + 1) },
    });
    await expect(
      owner.caseFolders.copyPreview({
        projectId,
        fromPath: "Large",
        toPath: "NoHugeCopy",
      }),
    ).rejects.toThrow("8 MiB");
    expect(
      await prisma.caseFolderWrite.count({
        where: { projectId, receipt: { path: ["action"], equals: "COPY" } },
      }),
    ).toBe(0);
  });
  it("rolls back all native allocations, clone history and folder state if a later copied case fails", async () => {
    await source("First original");
    await source("Second original");
    const input = await approved();
    const counter = (
      await prisma.project.findUniqueOrThrow({ where: { id: projectId } })
    ).nextCaseNumber;
    let writes = 0;
    const failing = prisma.$extends({
      query: {
        testCase: {
          async create({ args, query }) {
            if (++writes === 2)
              throw Error("Synthetic second copied case failure");
            return query(args);
          },
        },
      },
    });
    await expect(
      writeFolderCopy(failing as unknown as PrismaClient, actorId, input),
    ).rejects.toThrow("Synthetic second copied case failure");
    expect(writes).toBe(2);
    expect(
      (await prisma.project.findUniqueOrThrow({ where: { id: projectId } }))
        .nextCaseNumber,
    ).toBe(counter);
    expect(
      await prisma.testCase.count({
        where: { projectId, suitePath: { startsWith: "Copied" } },
      }),
    ).toBe(0);
    expect(
      await prisma.auditLog.count({
        where: { projectId, entityType: "TestCaseClone" },
      }),
    ).toBe(0);
    expect((await owner.caseFolders.list({ projectId })).paths).not.toContain(
      "Copied",
    );
  });
  it("sees a dependency committed between the first candidate read and case locks, then refuses rather than dropping it", async () => {
    const tc = await source();
    const input = await approved();
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
              await prisma.testCaseDataset.create({
                data: {
                  testCaseId: tc.id,
                  parameterNames: ["actor"],
                  rows: [
                    {
                      name: "Concurrent synthetic row",
                      values: { actor: "synthetic" },
                    },
                  ],
                },
              });
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
    expect(
      await prisma.testCase.count({
        where: { projectId, suitePath: { startsWith: "Copied" } },
      }),
    ).toBe(0);
    expect(
      await prisma.caseFolderWrite.count({
        where: { projectId, requestId: input.requestId },
      }),
    ).toBe(0);
  });
  it("refuses a legacy placement change that introduces an unlocked case after the identity-only selection", async () => {
    await source();
    const other = await owner.testCases.create({
      projectId,
      title: "Outside synthetic case",
      suitePath: "Elsewhere",
      testType: "FUNCTIONAL",
      steps: [{ action: "Retained operation" }],
    });
    const input = await approved();
    let moved = false;
    const raced = prisma.$extends({
      query: {
        testCase: {
          async findMany({ args, query }) {
            const rows = await query(args);
            if (
              !moved &&
              args.where?.projectId === projectId &&
              args.select?.id &&
              Object.keys(args.select).length === 1 &&
              args.take === 51
            ) {
              moved = true;
              await prisma.testCase.update({
                where: { id: other.id },
                data: { suitePath: "Original/Login" },
              });
            }
            return rows;
          },
        },
      },
    });
    await expect(
      writeFolderCopy(raced as unknown as PrismaClient, actorId, input),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(moved).toBe(true);
    expect(
      await prisma.testCase.count({
        where: { projectId, suitePath: { startsWith: "Copied" } },
      }),
    ).toBe(0);
    expect(
      await prisma.caseFolderWrite.count({
        where: { projectId, requestId: input.requestId },
      }),
    ).toBe(0);
  });
  it("rechecks current foreign/revoked/reparented access even when recovering an exact prior success", async () => {
    await source();
    const input = await approved();
    const created = await owner.caseFolders.copyWrite(input);
    await expect(
      owner.caseFolders.copyWrite({ ...input, reason: "Changed approval" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(outsider.caseFolders.copyWrite(input)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await prisma.membership.update({
      where: {
        organizationId_userId: { organizationId: orgId, userId: actorId },
      },
      data: { seatType: "READ_ONLY" },
    });
    await expect(owner.caseFolders.copyWrite(input)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await prisma.membership.update({
      where: {
        organizationId_userId: { organizationId: orgId, userId: actorId },
      },
      data: { seatType: "FULL" },
    });
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
      await expect(owner.caseFolders.copyWrite(input)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    } finally {
      await prisma.project.update({
        where: { id: projectId },
        data: { organizationId: orgId },
      });
    }
    expect(await owner.caseFolders.copyWrite(input)).toEqual({
      ...created,
      recovered: true,
    });
  });
});
