// Synthetic integration coverage requires an owned migrated loopback test DB.
import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Prisma, prisma, type PrismaClient } from "@vaettir/db";
import { caseFoldersRouter } from "./routers/caseFolders.js";
import { writeFolderCopy } from "./services/caseFolderCopy.js";
import { hardDeleteOrganization } from "./services/orgHardDelete.js";
import { qualityProfileHash } from "./services/qualityExperienceProfile.js";

describe("atomic reviewed supported dataset folder copy (owned synthetic DB)", () => {
  const tag = `dataset-copy-${randomUUID()}`;
  let organizationId: string,
    projectId: string,
    actorId: string,
    clerkActorId: string;
  let caller: ReturnType<typeof caseFoldersRouter.createCaller>;
  const data = {
    parameterNames: ["account", "unused"],
    rows: [
      {
        name: "Duplicate row label",
        values: { account: "", unused: "retained unused value" },
      },
      {
        name: "Duplicate row label",
        values: { account: "premium", unused: "literal value" },
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
      throw Error("Owned disposable loopback test DB required");
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
    caller = caseFoldersRouter.createCaller({ prisma, user });
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
      if (!org.slug.startsWith(tag))
        throw Error("Synthetic ownership mismatch");
      await hardDeleteOrganization(
        prisma,
        organizationId,
        actorId,
        "Owned dataset-copy synthetic fixture cleanup",
      );
    }
    await prisma.organizationDeletionLog.deleteMany({
      where: { organizationId },
    });
    await prisma.user.deleteMany({
      where: { id: actorId, clerkUserId: { startsWith: tag } },
    });
  });
  async function source(title = "Action <account>", path = "Source") {
    return prisma.testCase.create({
      data: {
        projectId,
        title,
        suitePath: path,
        testType: "FUNCTIONAL",
        given: ["Given <account>"],
        when: ["When used"],
        then: ["Then <unused>"],
        steps: {
          create: {
            order: 0,
            action: "Use <account>",
            expectedResult: "Keep <unused>",
          },
        },
      },
    });
  }
  async function dataset(testCaseId: string, values: typeof data = data) {
    return prisma.testCaseDataset.create({
      data: {
        testCaseId,
        parameterNames: values.parameterNames,
        rows: values.rows,
      },
    });
  }
  async function edge(dependentId: string, prerequisiteId: string) {
    return prisma.testCasePrerequisite.create({
      data: { projectId, dependentId, prerequisiteId, createdById: actorId },
    });
  }
  const scope = (internal = false, toPath = "Copy") => ({
    projectId,
    fromPath: "Source",
    toPath,
    copyParameterDatasets: true as const,
    ...(internal ? { copyInternalPrerequisites: true as const } : {}),
  });
  async function approved(internal = false, toPath = "Copy") {
    const review = await caller.copyPreview(scope(internal, toPath));
    return {
      ...scope(internal, toPath),
      expectedHash: review.expectedHash,
      expectedDatasetHash: review.datasetReviewHash!,
      expectedDatasets: review.datasetSources,
      ...(internal
        ? {
            expectedPrerequisiteHash: review.prerequisiteReviewHash!,
            expectedInternalPrerequisites: review.internalPrerequisites.map(
              ({ dependentId, prerequisiteId }) => ({
                dependentId,
                prerequisiteId,
              }),
            ),
          }
        : {}),
      expectedScope: { organizationId, clerkActorId },
      requestId: randomUUID(),
      reason:
        "Reviewed all source parameters, concrete row values and fresh mappings",
      confirmed: true as const,
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
    expect(
      await prisma.auditLog.count({
        where: { projectId, entityType: "TestCaseDatasetCopy" },
      }),
    ).toBe(0);
  }
  it("reviews exact rows then atomically copies fresh case/dataset composite identities once, without altering procedures/source/history", async () => {
    const original = await source(),
      saved = await dataset(original.id);
    const before = await prisma.testCase.findUniqueOrThrow({
      where: { id: original.id },
      include: { steps: true, versions: true, dataset: true },
    });
    await expect(
      caller.copyPreview({ projectId, fromPath: "Source", toPath: "Copy" }),
    ).rejects.toThrow("parameter dataset");
    const p = await caller.copyPreview(scope());
    expect(p.datasets).toEqual([
      expect.objectContaining({
        sourceCaseId: original.id,
        sourceDatasetId: saved.id,
        parameterNames: data.parameterNames,
        rows: data.rows,
      }),
    ]);
    const input = await approved(),
      counter = (
        await prisma.project.findUniqueOrThrow({ where: { id: projectId } })
      ).nextCaseNumber;
    const [first, retry] = await Promise.all([
      caller.copyWrite(input),
      caller.copyWrite(input),
    ]);
    expect(first.receiptId).toBe(retry.receiptId);
    expect(first.copiedDatasets).toEqual(retry.copiedDatasets);
    expect(first.copiedDatasets).toHaveLength(1);
    const mapped = first.copiedDatasets[0]!,
      copy = await prisma.testCase.findUniqueOrThrow({
        where: { id: mapped.caseId },
        include: { dataset: true, steps: true, versions: true },
      });
    expect(mapped).toMatchObject({
      sourceCaseId: original.id,
      sourceDatasetId: saved.id,
      caseId: first.copies[0]!.caseId,
      displayId: copy.displayId,
      rowCount: 2,
      rows: [
        { rowIndex: 0, name: data.rows[0]!.name },
        { rowIndex: 1, name: data.rows[1]!.name },
      ],
    });
    expect(copy.id).not.toBe(original.id);
    expect(mapped.datasetId).not.toBe(saved.id);
    expect(copy.dataset).toMatchObject({
      id: mapped.datasetId,
      parameterNames: data.parameterNames,
      rows: data.rows,
    });
    expect(copy.given).toEqual(before.given);
    expect(copy.when).toEqual(before.when);
    expect(copy.then).toEqual(before.then);
    expect(copy.versions).toHaveLength(1);
    expect(copy.reviewStatus).toBe("PENDING_REVIEW");
    expect(copy.automationStatus).toBe("MANUAL");
    expect(
      (await prisma.project.findUniqueOrThrow({ where: { id: projectId } }))
        .nextCaseNumber,
    ).toBe(counter + 1);
    expect(
      await prisma.testCase.findUniqueOrThrow({
        where: { id: original.id },
        include: { steps: true, versions: true, dataset: true },
      }),
    ).toEqual(before);
    const receipt = await prisma.caseFolderWrite.findUniqueOrThrow({
      where: { id: first.receiptId },
    });
    expect(receipt.receipt).toMatchObject({
      schemaVersion: 5,
      datasetReviewHash: input.expectedDatasetHash,
      copiedDatasets: first.copiedDatasets,
    });
    expect(receipt.receipt).not.toHaveProperty("copiedPrerequisites");
    expect(receipt.inputHash).toBe(qualityProfileHash(input));
    expect(
      await prisma.auditLog.count({
        where: { projectId, entityType: "TestCaseDatasetCopy" },
      }),
    ).toBe(1);
    expect(
      await prisma.testResult.count({ where: { testCaseId: copy.id } }),
    ).toBe(0);
  });
  it("keeps absent dataset v3/v4 inputs/receipts exact rather than adding empty dataset evidence", async () => {
    const a = await source("Independent");
    const legacy = { projectId, fromPath: "Source", toPath: "Legacy" },
      p = await caller.copyPreview(legacy),
      input = {
        ...legacy,
        expectedHash: p.expectedHash,
        requestId: randomUUID(),
        reason: "Legacy exact input",
        confirmed: true as const,
      };
    const copied = await caller.copyWrite(input),
      r = await prisma.caseFolderWrite.findUniqueOrThrow({
        where: { id: copied.receiptId },
      });
    expect(r.inputHash).toBe(qualityProfileHash(input));
    expect(r.receipt).toMatchObject({ schemaVersion: 3 });
    expect(r.receipt).not.toHaveProperty("copiedDatasets");
    expect(r.receipt).not.toHaveProperty("datasetReviewHash");
    const b = await source("Dependent");
    await edge(b.id, a.id);
    const opt = {
        projectId,
        fromPath: "Source",
        toPath: "Edges",
        copyInternalPrerequisites: true as const,
      },
      graph = await caller.copyPreview(opt);
    const graphInput = {
      ...opt,
      expectedHash: graph.expectedHash,
      expectedPrerequisiteHash: graph.prerequisiteReviewHash!,
      expectedInternalPrerequisites: graph.internalPrerequisites.map(
        ({ dependentId, prerequisiteId }) => ({ dependentId, prerequisiteId }),
      ),
      requestId: randomUUID(),
      reason: "Legacy v4 exact graph",
      confirmed: true as const,
    };
    const result = await caller.copyWrite(graphInput),
      gr = await prisma.caseFolderWrite.findUniqueOrThrow({
        where: { id: result.receiptId },
      });
    expect(gr.inputHash).toBe(qualityProfileHash(graphInput));
    expect(gr.receipt).toMatchObject({ schemaVersion: 4 });
    expect(gr.receipt).not.toHaveProperty("copiedDatasets");
    expect(gr.receipt).not.toHaveProperty("datasetReviewHash");
    expect(await caller.copyWrite(graphInput)).toEqual({
      ...result,
      recovered: true,
    });
  });
  it("copies dataset targets with selected nondataset prerequisite closure but refuses dataset-bearing prerequisites and external references wholly", async () => {
    const pre = await source("Prepare <account>"),
      target = await source("Target <account>", "Source/Child");
    await dataset(target.id);
    await edge(target.id, pre.id);
    const result = await caller.copyWrite(await approved(true)),
      map = new Map(result.copies.map((c) => [c.sourceId, c.caseId]));
    expect(result.copiedPrerequisites).toEqual([
      expect.objectContaining({
        dependentId: map.get(target.id),
        prerequisiteId: map.get(pre.id),
      }),
    ]);
    expect(result.copiedDatasets[0]!.caseId).toBe(map.get(target.id));
    await dataset(pre.id);
    await expect(caller.copyPreview(scope(true, "Pairing"))).rejects.toThrow(
      "row pairing",
    );
    await prisma.testCaseDataset.delete({ where: { testCaseId: pre.id } });
    const outside = await source("PRIVATE EXTERNAL", "Elsewhere");
    await edge(target.id, outside.id);
    await expect(caller.copyPreview(scope(true, "External"))).rejects.toThrow(
      "complete selected subtree",
    );
    expect(
      await prisma.testCase.count({
        where: { projectId, suitePath: { in: ["Pairing", "External"] } },
      }),
    ).toBe(0);
  });
  it("fails complete unsupported/empty/missing-variable and oversized datasets before any copying", async () => {
    const a = await source(),
      d = await dataset(a.id);
    for (const rows of [
      [{ ...data.rows[0], overrides: { account: "x" } }],
      [],
      [{ name: "Missing", values: { account: "x" } }],
    ]) {
      await prisma.testCaseDataset.update({
        where: { id: d.id },
        data: { rows },
      });
      await expect(caller.copyPreview(scope())).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
      await noWrites();
    }
    const params = Array.from({ length: 30 }, (_, i) => `p${i}`),
      values = Object.fromEntries(params.map((p) => [p, "x".repeat(10000)]));
    await prisma.testCaseDataset.update({
      where: { id: d.id },
      data: { parameterNames: params, rows: [{ name: "Huge", values }] },
    });
    await expect(caller.copyPreview(scope())).rejects.toThrow("256 KiB");
    await noWrites();
  });
  it("refuses dataset value/order/deletion and newly inserted dataset changes committed after preview against complete CAS", async () => {
    const a = await source(),
      d = await dataset(a.id),
      input = await approved();
    await prisma.testCaseDataset.update({
      where: { id: d.id },
      data: { rows: [...data.rows].reverse() },
    });
    await expect(caller.copyWrite(input)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await noWrites();
    await prisma.testCaseDataset.delete({ where: { id: d.id } });
    await expect(caller.copyWrite(input)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await noWrites();
    const empty = await approved();
    await dataset(a.id);
    await expect(caller.copyWrite(empty)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await noWrites();
  });
  it("refuses the complete 500-row and 2 MiB dataset population without silently limiting selected cases", async () => {
    const selected = [];
    for (let i = 0; i < 11; i++) {
      const a = await source(`Case ${i} <account>`);
      selected.push(
        await dataset(a.id, {
          parameterNames: data.parameterNames,
          rows: Array.from({ length: 50 }, (_, r) => ({
            name: `Row ${r}`,
            values: { account: "x", unused: "y" },
          })),
        }),
      );
    }
    await expect(caller.copyPreview(scope())).rejects.toThrow("500 rows");
    await noWrites();
    const params = [
        "account",
        ...Array.from({ length: 19 }, (_, i) => `p${i}`),
      ],
      values = Object.fromEntries(params.map((p) => [p, "x".repeat(10000)]));
    for (const d of selected)
      await prisma.testCaseDataset.update({
        where: { id: d.id },
        data: {
          parameterNames: params,
          rows: [{ name: "Whole body", values }],
        },
      });
    await expect(caller.copyPreview(scope())).rejects.toThrow("2 MiB");
    await noWrites();
  });
  it("rolls back counters/cases/versions/datasets/edges/audits when a second dataset insert fails", async () => {
    const a = await source(),
      b = await source("Other <account>");
    await dataset(a.id);
    await dataset(b.id);
    const input = await approved(),
      counter = (
        await prisma.project.findUniqueOrThrow({ where: { id: projectId } })
      ).nextCaseNumber;
    let inserted = 0;
    const failing = prisma.$extends({
      query: {
        testCaseDataset: {
          async create({ args, query }) {
            if (++inserted === 2)
              throw Error("Synthetic second dataset failure");
            return query(args);
          },
        },
      },
    });
    await expect(
      writeFolderCopy(failing as unknown as PrismaClient, actorId, input),
    ).rejects.toThrow("Synthetic second dataset failure");
    expect(inserted).toBe(2);
    expect(
      (await prisma.project.findUniqueOrThrow({ where: { id: projectId } }))
        .nextCaseNumber,
    ).toBe(counter);
    await noWrites();
    expect(
      await prisma.testCaseDataset.count({
        where: { testCase: { projectId } },
      }),
    ).toBe(2);
    expect(
      await prisma.testCaseVersion.count({
        where: { testCase: { projectId, suitePath: { startsWith: "Copy" } } },
      }),
    ).toBe(0);
    expect((await caller.list({ projectId })).paths).not.toContain("Copy");
  });
  it("holds existing dataset update/delete and new dataset FK insertion locks during copy without sleep timing guesses", async () => {
    const a = await source(),
      b = await source("Other <account>"),
      d = await dataset(a.id),
      input = await approved();
    let probed = false;
    const locked = prisma.$extends({
      query: {
        testCaseDataset: {
          async findMany({ args, query }) {
            const rows = await query(args);
            if (!probed && args.take === 51) {
              probed = true;
              for (const action of ["update", "delete", "insert"]) {
                await expect(
                  prisma.$transaction(
                    async (tx) => {
                      await tx.$executeRaw`SET LOCAL lock_timeout = '100ms'`;
                      if (action === "update")
                        await tx.$executeRaw`UPDATE "TestCaseDataset" SET rows='[]'::jsonb WHERE id=${d.id}`;
                      else if (action === "delete")
                        await tx.$executeRaw`DELETE FROM "TestCaseDataset" WHERE id=${d.id}`;
                      else
                        await tx.$executeRaw`INSERT INTO "TestCaseDataset" (id,"testCaseId","parameterNames",rows,"updatedAt") VALUES (${`probe-${randomUUID()}`},${b.id},ARRAY['account','unused'],${JSON.stringify(data.rows)}::jsonb,now())`;
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
    const copied = await writeFolderCopy(
      locked as unknown as PrismaClient,
      actorId,
      input,
    );
    expect(probed).toBe(true);
    expect(copied.copiedDatasets).toHaveLength(1);
    expect(
      await prisma.testCaseDataset.findUnique({ where: { testCaseId: b.id } }),
    ).toBeNull();
  });
  it("retains historical mapping after copied dataset deletion, never reconstructs it, and denies tampered/source-pointing/revoked replay", async () => {
    const a = await source();
    await dataset(a.id);
    const input = await approved(),
      first = await caller.copyWrite(input),
      mapped = first.copiedDatasets[0]!;
    await prisma.testCaseDataset.delete({ where: { id: mapped.datasetId } });
    const replay = await caller.copyWrite(input);
    expect(replay.copiedDatasets).toEqual(first.copiedDatasets);
    expect(
      await prisma.testCaseDataset.findUnique({
        where: { testCaseId: mapped.caseId },
      }),
    ).toBeNull();
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
      where: { id: first.receiptId },
    });
    const tampered = {
      ...(receipt.receipt as Prisma.JsonObject),
      copiedDatasets: [{ ...mapped, datasetId: mapped.sourceDatasetId }],
    };
    // Real immutable receipts must reject this source-pointing replacement.
    await expect(
      prisma.caseFolderWrite.update({
        where: { id: receipt.id },
        data: {
          receipt: tampered,
        },
      }),
    ).rejects.toThrow("append-only");
    expect(
      await prisma.caseFolderWrite.findUniqueOrThrow({
        where: { id: receipt.id },
      }),
    ).toEqual(receipt);
    // Retain independent service fail-closed coverage with only an exact owned
    // receipt read intercepted; do not disable the database append-only gate.
    let tamperedRead = false;
    const corruptRead = prisma.$extends({
      query: {
        caseFolderWrite: {
          async findUnique({ args, query }) {
            const row = await query(args);
            if (row?.id !== receipt.id) return row;
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
        where: { id: receipt.id },
      }),
    ).toEqual(receipt);
    expect(await caller.copyWrite(input)).toEqual({
      ...first,
      recovered: true,
    });
    expect(
      await prisma.testCaseDataset.findUnique({
        where: { testCaseId: mapped.caseId },
      }),
    ).toBeNull();
    expect(
      await prisma.testCaseDataset.findUniqueOrThrow({
        where: { id: mapped.sourceDatasetId },
      }),
    ).toMatchObject({
      testCaseId: a.id,
      parameterNames: data.parameterNames,
      rows: data.rows,
    });
    expect(
      await prisma.testCase.count({ where: { projectId, suitePath: "Copy" } }),
    ).toBe(1);
  });
  it("denies original-organization replay after reparent even when the same actor has full ownership in both tenants", async () => {
    const a = await source();
    await dataset(a.id);
    const approvedInput = await approved(),
      { expectedScope: originalScope, ...input } = approvedInput,
      first = await caller.copyWrite(input);
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
      await expect(caller.copyWrite(input)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(
        caller.copyWrite({ ...input, expectedScope: originalScope }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    } finally {
      await prisma.project.update({
        where: { id: projectId },
        data: { organizationId },
      });
      await hardDeleteOrganization(
        prisma,
        other.id,
        actorId,
        "Owned reparent dataset fixture cleanup",
      );
      await prisma.organizationDeletionLog.deleteMany({
        where: { organizationId: other.id },
      });
    }
    expect(await caller.copyWrite(input)).toEqual({
      ...first,
      recovered: true,
    });
  });
});
