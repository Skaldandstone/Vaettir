// SOURCE ONLY: authoring is NOT acceptance. NOT RUN tonight.
// Run later only in a uniquely owned seeded/migrated disposable loopback DB.
import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Prisma, prisma, type PrismaClient } from "@vaettir/db";
import { caseCloneRouter } from "./routers/caseClone.js";
import { cloneCase, sourceState } from "./services/caseClone.js";
import { qualityProfileHash } from "./services/qualityExperienceProfile.js";
import { hardDeleteOrganization } from "./services/orgHardDelete.js";
describe("reviewed independent dataset clone (NOT RUN)", () => {
  const tag = `clone-dataset-${randomUUID()}`;
  let organizationId: string,
    projectId: string,
    actorId: string,
    clerkActorId: string;
  let caller: ReturnType<typeof caseCloneRouter.createCaller>;
  const data = {
    parameterNames: ["account", "unused"],
    rows: [
      {
        name: "Duplicate name",
        values: { account: "", unused: "retained value" },
      },
      {
        name: "Duplicate name",
        values: { account: "premium", unused: "other value" },
      },
    ],
  };
  beforeAll(() => {
    const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
    if (
      !["localhost", "127.0.0.1"].includes(url.hostname) ||
      !/test/i.test(url.pathname) ||
      url.searchParams.has("host")
    )
      throw Error("Owned seeded loopback test DB required");
  });
  beforeEach(async () => {
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
    caller = caseCloneRouter.createCaller({ prisma, user });
    projectId = (
      await prisma.project.create({
        data: { organizationId, name: tag, slug: `${tag}-${randomUUID()}` },
      })
    ).id;
  });
  afterEach(async () => {
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (org) {
      if (!org.slug.startsWith(tag)) throw Error("Fixture ownership mismatch");
      await hardDeleteOrganization(
        prisma,
        organizationId,
        actorId,
        "Owned independent dataset clone fixture cleanup",
      );
    }
    await prisma.organizationDeletionLog.deleteMany({
      where: { organizationId },
    });
    await prisma.user.deleteMany({
      where: { id: actorId, clerkUserId: { startsWith: tag } },
    });
  });
  async function source(withDataset = true) {
    const c = await prisma.testCase.create({
      data: {
        projectId,
        title: "Action <account>",
        suitePath: "Sources",
        testType: "FUNCTIONAL",
        given: ["Given <account>"],
        when: ["Use the feature"],
        then: ["Expect <unused>"],
        steps: {
          create: {
            order: 0,
            action: "Use <account>",
            expectedResult: "<unused>",
          },
        },
      },
    });
    if (withDataset)
      await prisma.testCaseDataset.create({
        data: {
          testCaseId: c.id,
          parameterNames: data.parameterNames,
          rows: data.rows,
        },
      });
    return c;
  }
  const scope = (caseId: string) => ({
    projectId,
    caseId,
    copyParameterDataset: true as const,
    expectedScope: { organizationId, clerkActorId },
  });
  async function approved(caseId: string) {
    const p = await caller.preview(scope(caseId));
    return {
      ...scope(caseId),
      expectedSourceRevision: p.expectedSourceRevision,
      expectedDatasetHash: p.datasetReviewHash!,
      expectedDataset: p.datasetSource!,
      title: "Duplicate <account>",
      suitePath: "Duplicates",
      reason: "Reviewed exact independent dataset and new identities",
      confirmed: true as const,
      requestId: randomUUID(),
    };
  }
  async function noWrites() {
    expect(
      await prisma.testCase.count({
        where: { projectId, suitePath: "Duplicates" },
      }),
    ).toBe(0);
    expect(
      await prisma.auditLog.count({
        where: {
          projectId,
          entityType: { in: ["TestCaseClone", "TestCaseDatasetClone"] },
        },
      }),
    ).toBe(0);
  }
  it("retains exact omitted legacy preview/hash/result/audit and excludes dataset with its original warning", async () => {
    const original = await source(),
      plainScope = { projectId, caseId: original.id },
      p = await caller.preview(plainScope);
    const state = await prisma.$transaction((tx) =>
      sourceState(tx, plainScope),
    );
    expect(p).toEqual(state.preview);
    expect(p.warnings.join(" ")).toContain("datasets");
    const input = {
        ...plainScope,
        expectedSourceRevision: p.expectedSourceRevision,
        title: "Legacy independent",
        suitePath: "Duplicates",
        reason: "Original no-option contract",
        confirmed: true as const,
        requestId: randomUUID(),
      },
      copy = await caller.create(input);
    expect(Object.keys(copy).sort()).toEqual([
      "caseId",
      "displayId",
      "replayed",
    ]);
    expect(
      await prisma.testCaseDataset.findUnique({
        where: { testCaseId: copy.caseId },
      }),
    ).toBeNull();
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { projectId, entityType: "TestCaseClone", entityId: copy.caseId },
    });
    expect(audit.metadata).toMatchObject({
      requestHash: qualityProfileHash(input),
    });
    expect(audit.metadata).not.toHaveProperty("copyParameterDataset");
    expect(audit.metadata).not.toHaveProperty("copiedDataset");
    expect(await caller.create(input)).toEqual({ ...copy, replayed: true });
  });
  it("reviews all exact concrete values, atomically allocates fresh identities once, preserves source/history and echoes scoped ACK", async () => {
    const original = await source(),
      before = await prisma.testCase.findUniqueOrThrow({
        where: { id: original.id },
        include: { dataset: true, steps: true, versions: true },
      }),
      p = await caller.preview(scope(original.id));
    expect(p).toMatchObject({
      projectId,
      organizationId,
      clerkActorId,
      copyParameterDataset: true,
      dataset: data,
    });
    const input = await approved(original.id),
      counter = (
        await prisma.project.findUniqueOrThrow({ where: { id: projectId } })
      ).nextCaseNumber;
    const [first, retry] = await Promise.all([
      caller.create(input),
      caller.create(input),
    ]);
    expect(first.caseId).toBe(retry.caseId);
    expect(first.copiedDataset).toEqual(retry.copiedDataset);
    expect(first).toMatchObject({
      requestId: input.requestId,
      projectId,
      organizationId,
      clerkActorId,
    });
    const copy = await prisma.testCase.findUniqueOrThrow({
      where: { id: first.caseId },
      include: { dataset: true, versions: true, steps: true },
    });
    expect(copy.dataset).toMatchObject({
      parameterNames: data.parameterNames,
      rows: data.rows,
      id: first.copiedDataset!.datasetId,
    });
    expect(copy.dataset!.id).not.toBe(before.dataset!.id);
    expect(copy.id).not.toBe(original.id);
    expect(first.copiedDataset!.rows).toEqual(
      data.rows.map((r, rowIndex) => ({ name: r.name, rowIndex })),
    );
    expect(copy.reviewStatus).toBe("PENDING_REVIEW");
    expect(copy.automationStatus).toBe("MANUAL");
    expect(copy.versions).toHaveLength(1);
    expect(copy.given).toEqual(before.given);
    expect(copy.when).toEqual(before.when);
    expect(copy.then).toEqual(before.then);
    expect(
      await prisma.testCase.findUniqueOrThrow({
        where: { id: original.id },
        include: { dataset: true, steps: true, versions: true },
      }),
    ).toEqual(before);
    expect(
      (await prisma.project.findUniqueOrThrow({ where: { id: projectId } }))
        .nextCaseNumber,
    ).toBe(counter + 1);
    expect(
      await prisma.auditLog.count({
        where: { projectId, entityType: "TestCaseDatasetClone" },
      }),
    ).toBe(1);
    expect(
      await prisma.testResult.count({ where: { testCaseId: copy.id } }),
    ).toBe(0);
  });
  it("refuses every incoming/outgoing prerequisite without revealing the external identity; no independent edge is silently dropped", async () => {
    const original = await source(),
      outside = await source(false);
    for (const pair of [
      [original.id, outside.id],
      [outside.id, original.id],
    ]) {
      await prisma.testCasePrerequisite.create({
        data: {
          projectId,
          dependentId: pair[0]!,
          prerequisiteId: pair[1]!,
          createdById: actorId,
        },
      });
      try {
        await caller.preview(scope(original.id));
        throw Error("Expected refusal");
      } catch (error) {
        expect(String(error)).toContain("prerequisite relationships");
        expect(String(error)).not.toContain(outside.id);
        expect(String(error)).not.toContain(outside.displayId);
      }
      await prisma.testCasePrerequisite.deleteMany({ where: { projectId } });
    }
    await noWrites();
  });
  it("refuses unsupported/missing/oversized datasets and titles that cannot resolve every exact row", async () => {
    const original = await source(),
      input = await approved(original.id),
      d = await prisma.testCaseDataset.findUniqueOrThrow({
        where: { testCaseId: original.id },
      });
    await expect(
      caller.create({ ...input, title: "Unresolved <missing>" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await noWrites();
    await prisma.testCaseDataset.update({
      where: { id: d.id },
      data: { rows: [{ ...data.rows[0], overrides: { account: "hidden" } }] },
    });
    await expect(caller.preview(scope(original.id))).rejects.toThrow(
      "unsupported",
    );
    await noWrites();
    await prisma.testCaseDataset.delete({ where: { id: d.id } });
    await expect(caller.preview(scope(original.id))).rejects.toThrow(
      "no saved dataset",
    );
    await noWrites();
    const params = Array.from({ length: 30 }, (_, i) => `p${i}`),
      values = Object.fromEntries(params.map((p) => [p, "x".repeat(10000)]));
    await prisma.testCaseDataset.create({
      data: {
        testCaseId: original.id,
        parameterNames: params,
        rows: [{ name: "Huge", values }],
      },
    });
    await expect(caller.preview(scope(original.id))).rejects.toThrow("256 KiB");
    await noWrites();
  });
  it("keeps supported-data opt-in fail-closed for attachment/media/shared/archived dependencies without fetching any artifact", async () => {
    const original = await source();
    const attachment = await prisma.testCaseAttachment.create({
      data: {
        testCaseId: original.id,
        fileName: "synthetic.txt",
        contentType: "text/plain",
        storageUrl: "fixture://not-uploaded",
        sizeBytes: 1,
      },
    });
    await expect(caller.preview(scope(original.id))).rejects.toThrow(
      "attachments",
    );
    await prisma.testCaseAttachment.delete({ where: { id: attachment.id } });
    const step = await prisma.testCaseStep.findFirstOrThrow({
      where: { testCaseId: original.id },
    });
    await prisma.testCaseStep.update({
      where: { id: step.id },
      data: { mediaAttachmentIds: ["synthetic-not-fetched"] },
    });
    await expect(caller.preview(scope(original.id))).rejects.toThrow(
      "step media",
    );
    await prisma.testCaseStep.update({
      where: { id: step.id },
      data: { mediaAttachmentIds: [] },
    });
    const group = await prisma.sharedStepGroup.create({
      data: {
        projectId,
        name: "Synthetic shared",
        steps: [{ order: 0, action: "Shared action", mediaAttachmentIds: [] }],
      },
    });
    await prisma.testCase.update({
      where: { id: original.id },
      data: { sharedStepGroupId: group.id },
    });
    await expect(caller.preview(scope(original.id))).rejects.toThrow(
      "shared libraries",
    );
    await prisma.testCase.update({
      where: { id: original.id },
      data: { sharedStepGroupId: null, archived: true },
    });
    await expect(caller.preview(scope(original.id))).rejects.toThrow(
      "archived case",
    );
    await noWrites();
  });
  it("refuses complete dataset/source changes after review and rolls back every counter/case/version/audit on dataset failure", async () => {
    const original = await source(),
      input = await approved(original.id),
      d = await prisma.testCaseDataset.findUniqueOrThrow({
        where: { testCaseId: original.id },
      });
    await prisma.testCaseDataset.update({
      where: { id: d.id },
      data: { rows: [...data.rows].reverse() },
    });
    await expect(caller.create(input)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await noWrites();
    const reviewed = await approved(original.id),
      counter = (
        await prisma.project.findUniqueOrThrow({ where: { id: projectId } })
      ).nextCaseNumber;
    const failing = prisma.$extends({
      query: {
        testCaseDataset: {
          async create() {
            throw Error("Synthetic dataset write failure");
          },
        },
      },
    });
    await expect(
      cloneCase(failing as unknown as PrismaClient, actorId, reviewed),
    ).rejects.toThrow("Synthetic dataset write failure");
    await noWrites();
    expect(
      (await prisma.project.findUniqueOrThrow({ where: { id: projectId } }))
        .nextCaseNumber,
    ).toBe(counter);
    expect(
      await prisma.testCaseVersion.count({
        where: { testCase: { projectId, suitePath: "Duplicates" } },
      }),
    ).toBe(0);
  });
  it("holds source UPDATE/dataset SHARE locks against direct value/deletion/new incoming FK mutations without timing sleeps", async () => {
    const original = await source(),
      outside = await source(false),
      input = await approved(original.id),
      d = await prisma.testCaseDataset.findUniqueOrThrow({
        where: { testCaseId: original.id },
      });
    let probed = false;
    const locked = prisma.$extends({
      query: {
        testCaseDataset: {
          async findMany({ args, query }) {
            const rows = await query(args);
            if (!probed && args.take === 51) {
              probed = true;
              for (const action of ["update", "delete", "edge"]) {
                await expect(
                  prisma.$transaction(
                    async (tx) => {
                      await tx.$executeRaw`SET LOCAL lock_timeout = '100ms'`;
                      if (action === "update")
                        await tx.$executeRaw`UPDATE "TestCaseDataset" SET rows='[]'::jsonb WHERE id=${d.id}`;
                      else if (action === "delete")
                        await tx.$executeRaw`DELETE FROM "TestCaseDataset" WHERE id=${d.id}`;
                      else
                        await tx.$executeRaw`INSERT INTO "TestCasePrerequisite" ("projectId","dependentId","prerequisiteId","createdById") VALUES (${projectId},${outside.id},${original.id},${actorId})`;
                    },
                    { timeout: 2000 },
                  ),
                ).rejects.toMatchObject({
                  code: "P2010",
                  meta: { code: "55P03" },
                });
              }
            }
            return rows;
          },
        },
      },
    });
    const copied = await cloneCase(
      locked as unknown as PrismaClient,
      actorId,
      input,
    );
    expect(probed).toBe(true);
    expect(copied.copiedDataset).toBeDefined();
    expect(
      await prisma.testCasePrerequisite.count({ where: { projectId } }),
    ).toBe(0);
  });
  it("pins authenticated Clerk identity until completion and refuses exact replay after a committed identity change", async () => {
    const original = await source(),
      input = await approved(original.id),
      changedClerkActorId = `${tag}-changed-${randomUUID()}`;
    let probed = false;
    const locked = prisma.$extends({
      query: {
        testCaseDataset: {
          async findMany({ args, query }) {
            const rows = await query(args);
            if (!probed && args.take === 51) {
              probed = true;
              await expect(
                prisma.$transaction(
                  async (tx) => {
                    await tx.$executeRaw`SET LOCAL lock_timeout = '100ms'`;
                    await tx.$executeRaw`UPDATE "User" SET "clerkUserId"=${changedClerkActorId} WHERE id=${actorId}`;
                  },
                  { timeout: 2000 },
                ),
              ).rejects.toMatchObject({
                code: "P2010",
                meta: { code: "55P03" },
              });
              expect(
                await prisma.user.findUniqueOrThrow({
                  where: { id: actorId },
                  select: { clerkUserId: true },
                }),
              ).toEqual({ clerkUserId: clerkActorId });
            }
            return rows;
          },
        },
      },
    });
    const first = await cloneCase(
      locked as unknown as PrismaClient,
      actorId,
      input,
    );
    expect(probed).toBe(true);
    expect(first.clerkActorId).toBe(clerkActorId);
    expect(first.copiedDataset).toBeDefined();
    try {
      await prisma.user.update({
        where: { id: actorId },
        data: { clerkUserId: changedClerkActorId },
      });
      await expect(caller.create(input)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(
        await prisma.testCase.count({
          where: { projectId, suitePath: "Duplicates" },
        }),
      ).toBe(1);
    } finally {
      await prisma.user.update({
        where: { id: actorId },
        data: { clerkUserId: clerkActorId },
      });
    }
    expect(await caller.create(input)).toEqual({ ...first, replayed: true });
  });
  it("returns original historical mapping without reconstructing later deleted datasets, refuses tampered receipts and revoked retry", async () => {
    const original = await source(),
      input = await approved(original.id),
      first = await caller.create(input);
    await prisma.testCaseDataset.delete({
      where: { id: first.copiedDataset!.datasetId },
    });
    const replay = await caller.create(input);
    expect(replay).toEqual({ ...first, replayed: true });
    expect(
      await prisma.testCaseDataset.findUnique({
        where: { testCaseId: first.caseId },
      }),
    ).toBeNull();
    await prisma.membership.update({
      where: { organizationId_userId: { organizationId, userId: actorId } },
      data: { seatType: "READ_ONLY" },
    });
    await expect(caller.create(input)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await prisma.membership.update({
      where: { organizationId_userId: { organizationId, userId: actorId } },
      data: { seatType: "FULL" },
    });
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { projectId, entityType: "TestCaseClone", entityId: first.caseId },
    });
    await prisma.auditLog.update({
      where: { id: audit.id },
      data: {
        metadata: {
          ...(audit.metadata as Prisma.JsonObject),
          copiedDataset: {
            ...first.copiedDataset!,
            datasetId: input.expectedDataset.sourceDatasetId,
          },
        },
      },
    });
    await expect(caller.create(input)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(
      await prisma.testCase.count({
        where: { projectId, suitePath: "Duplicates" },
      }),
    ).toBe(1);
  });
  it("binds actor/original tenant before receipt replay; denies project reparent even with full ownership in both tenants", async () => {
    const original = await source(),
      input = await approved(original.id),
      first = await caller.create(input);
    await expect(
      caller.create({
        ...input,
        expectedScope: { organizationId, clerkActorId: "other-actor" },
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const tier = await prisma.planTier.findUniqueOrThrow({
        where: { key: "free" },
      }),
      slug = `${tag}-${randomUUID()}`,
      other = await prisma.organization.create({
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
      await expect(caller.create(input)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(
        caller.create({
          ...input,
          expectedScope: { organizationId: other.id, clerkActorId },
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(caller.preview(scope(original.id))).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    } finally {
      await prisma.project.update({
        where: { id: projectId },
        data: { organizationId },
      });
      await hardDeleteOrganization(
        prisma,
        other.id,
        actorId,
        "Owned independent dataset reparent fixture cleanup",
      );
      await prisma.organizationDeletionLog.deleteMany({
        where: { organizationId: other.id },
      });
    }
    expect(await caller.create(input)).toEqual({ ...first, replayed: true });
  });
});
