// Authored only; requires uniquely owned seeded/migrated loopback DB in morning.
import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@vaettir/db";
import { caseFoldersRouter } from "./routers/caseFolders.js";
import { hardDeleteOrganization } from "./services/orgHardDelete.js";
import { folderCopyApprovalSchema } from "./services/caseFolderCopySchema.js";
import { qualityProfileHash } from "./services/qualityExperienceProfile.js";
describe("copy/recovery current scope and exact request provenance", () => {
  const tag = `folder-companion-${randomUUID()}`;
  const orgs: string[] = [],
    users: string[] = [],
    clerks: string[] = [];
  let projectId: string, caseId: string;
  let owner: ReturnType<typeof caseFoldersRouter.createCaller>,
    editor: typeof owner,
    viewer: typeof owner;
  beforeAll(() => {
    const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
    if (
      !["127.0.0.1", "localhost"].includes(url.hostname) ||
      !/test/i.test(url.pathname) ||
      url.searchParams.has("host")
    )
      throw Error("Owned disposable loopback database required");
  });
  beforeEach(async () => {
    const tier = await prisma.planTier.findUniqueOrThrow({
      where: { key: "free" },
    });
    for (let n = 0; n < 2; n++) {
      const slug = `${tag}-${randomUUID()}`;
      orgs.push(
        (
          await prisma.organization.create({
            data: { name: slug, slug, planTierId: tier.id },
          })
        ).id,
      );
    }
    projectId = (
      await prisma.project.create({
        data: {
          organizationId: orgs[0]!,
          name: tag,
          slug: `${tag}-${randomUUID()}`,
        },
      })
    ).id;
    for (const role of ["OWNER", "EDITOR", "VIEWER"] as const) {
      const clerkUserId = `${tag}-${randomUUID()}`;
      const user = await prisma.user.create({
        data: {
          clerkUserId,
          email: `${clerkUserId}@example.com`,
          memberships: {
            create: orgs.map((organizationId) => ({
              organizationId,
              role,
              seatType: "FULL" as const,
            })),
          },
        },
        include: { memberships: true },
      });
      users.push(user.id);
      clerks.push(clerkUserId);
      const caller = caseFoldersRouter.createCaller({ prisma, user });
      if (role === "OWNER") owner = caller;
      else if (role === "EDITOR") editor = caller;
      else viewer = caller;
    }
    caseId = (
      await prisma.testCase.create({
        data: {
          projectId,
          title: "Synthetic source procedure",
          testType: "FUNCTIONAL",
          given: ["Original Given"],
          when: ["Original When"],
          then: ["Original Then"],
          suitePath: "Source",
          sortPosition: 4,
        },
      })
    ).id;
    await folder("CREATE", "Destination");
  });
  afterEach(async () => {
    if (projectId) {
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { slug: true },
      });
      if (project && !project.slug.startsWith(tag))
        throw Error("Fixture project ownership mismatch");
      if (project)
        await prisma.project.update({
          where: { id: projectId },
          data: { organizationId: orgs[0]! },
        });
    }
    for (const id of orgs) {
      const org = await prisma.organization.findUnique({
        where: { id },
        select: { slug: true },
      });
      if (!org) continue;
      if (!org.slug.startsWith(tag))
        throw Error("Fixture organization ownership mismatch");
      await hardDeleteOrganization(
        prisma,
        id,
        users[0]!,
        "Owned folder companion fixture cleanup",
      );
    }
    await prisma.organizationDeletionLog.deleteMany({
      where: { organizationId: { in: orgs } },
    });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    orgs.length = users.length = clerks.length = 0;
    projectId = caseId = "";
  });
  const scope = () => ({ organizationId: orgs[0]!, clerkActorId: clerks[0]! });
  async function folder(
    action: "CREATE" | "MOVE",
    toPath: string,
    fromPath?: string,
  ) {
    const review = {
      projectId,
      action,
      toPath,
      ...(fromPath ? { fromPath } : {}),
    };
    const preview = await owner.preview(review);
    return owner.write({
      ...review,
      expectedHash: preview.expectedHash,
      confirmed: true,
      requestId: randomUUID(),
      reason: "Synthetic reviewed setup",
      expectedScope: scope(),
    });
  }
  async function copy(bound = true) {
    const input = { projectId, fromPath: "Source", toPath: "Copied" };
    const preview = await owner.copyPreview(input);
    return {
      ...input,
      expectedHash: preview.expectedHash,
      requestId: randomUUID(),
      confirmed: true as const,
      reason: "Synthetic reviewed copy",
      ...(bound ? { expectedScope: scope() } : {}),
    };
  }
  async function recovery(originalReceiptId: string, bound = true) {
    const input = { projectId, originalReceiptId };
    const preview = await owner.recoveryPreview(input);
    return {
      ...input,
      expectedHash: preview.expectedHash,
      requestId: randomUUID(),
      confirmed: true as const,
      reason: "Synthetic reviewed inverse",
      ...(bound ? { expectedScope: scope() } : {}),
    };
  }
  it("echoes current copy reader, binds write actor before replay and allocates only one new identity", async () => {
    const preview = await editor.copyPreview({
      projectId,
      fromPath: "Source",
      toPath: "EditorPreview",
    });
    expect(preview).toMatchObject({
      projectId,
      organizationId: orgs[0],
      clerkActorId: clerks[1],
      fromPath: "Source",
      toPath: "EditorPreview",
    });
    await expect(
      viewer.copyPreview({
        projectId,
        fromPath: "Source",
        toPath: "ViewerDenied",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const input = await copy();
    const result = await owner.copyWrite(input);
    expect(result).toMatchObject({
      projectId,
      organizationId: orgs[0],
      clerkActorId: clerks[0],
      requestId: input.requestId,
      destinationPath: "Copied",
    });
    await expect(editor.copyWrite(input)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(await owner.copyWrite(input)).toEqual({
      ...result,
      recovered: true,
    });
    expect(
      await prisma.caseFolderWrite.count({
        where: { projectId, requestId: input.requestId },
      }),
    ).toBe(1);
    expect(result.copies).toHaveLength(1);
    expect(result.copies[0]!.caseId).not.toBe(caseId);
    const original = await prisma.testCase.findUniqueOrThrow({
      where: { id: caseId },
    });
    const cloned = await prisma.testCase.findUniqueOrThrow({
      where: { id: result.copies[0]!.caseId },
    });
    expect(cloned.displayId).not.toBe(original.displayId);
    expect(cloned.reviewStatus).toBe("PENDING_REVIEW");
    expect(cloned.given).toEqual(original.given);
    expect(await prisma.testCase.count({ where: { projectId } })).toBe(2);
  });
  it("keeps legacy options array while catalog/preview/ACK carry reader identity and exact inverse scope", async () => {
    const moved = await folder("MOVE", "Destination/Source", "Source");
    const catalog = await editor.recoveryCatalog({ projectId });
    const legacy = await editor.recoveryOptions({ projectId });
    expect(catalog).toMatchObject({
      projectId,
      organizationId: orgs[0],
      clerkActorId: clerks[1],
    });
    expect(Array.isArray(legacy)).toBe(true);
    expect(legacy).toEqual(catalog.items);
    expect(catalog.items.map((row) => row.id)).toContain(moved.receiptId);
    await expect(viewer.recoveryCatalog({ projectId })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const preview = await editor.recoveryPreview({
      projectId,
      originalReceiptId: moved.receiptId,
    });
    expect(preview).toMatchObject({
      projectId,
      organizationId: orgs[0],
      clerkActorId: clerks[1],
      originalReceiptId: moved.receiptId,
      fromPath: "Destination/Source",
      toPath: "Source",
    });
    const input = await recovery(moved.receiptId);
    await expect(editor.recoveryWrite(input)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const result = await owner.recoveryWrite(input);
    expect(result).toMatchObject({
      projectId,
      organizationId: orgs[0],
      clerkActorId: clerks[0],
      requestId: input.requestId,
      originalReceiptId: moved.receiptId,
      destinationPath: "Source",
    });
    await expect(editor.recoveryWrite(input)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(await owner.recoveryWrite(input)).toEqual({
      ...result,
      recovered: true,
    });
    expect(
      (await prisma.testCase.findUniqueOrThrow({ where: { id: caseId } }))
        .suitePath,
    ).toBe("Source");
  });
  it("preserves legacy copy hashes but refuses prior-org receipts and captured org mismatch after reparent", async () => {
    const input = await copy(false),
      parsed = folderCopyApprovalSchema.parse(input);
    expect(Object.hasOwn(parsed, "expectedScope")).toBe(false);
    const result = await owner.copyWrite(parsed);
    const row = await prisma.caseFolderWrite.findUniqueOrThrow({
      where: {
        projectId_actorId_requestId: {
          projectId,
          actorId: users[0]!,
          requestId: input.requestId,
        },
      },
    });
    expect(row.inputHash).toBe(qualityProfileHash(parsed));
    const moved = await folder("MOVE", "Destination/Source", "Source");
    const inverse = await recovery(moved.receiptId);
    const restored = await owner.recoveryWrite(inverse);
    await prisma.project.update({
      where: { id: projectId },
      data: { organizationId: orgs[1]! },
    });
    try {
      const current = await owner.recoveryCatalog({ projectId });
      expect(current.organizationId).toBe(orgs[1]);
      expect(current.items).toEqual([]);
      await expect(owner.copyWrite(parsed)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(owner.recoveryWrite(inverse)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(
        owner.recoveryPreview({
          projectId,
          originalReceiptId: moved.receiptId,
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    } finally {
      await prisma.project.update({
        where: { id: projectId },
        data: { organizationId: orgs[0]! },
      });
    }
    expect(await owner.copyWrite(parsed)).toEqual({
      ...result,
      recovered: true,
    });
    expect(await owner.recoveryWrite(inverse)).toEqual({
      ...restored,
      recovered: true,
    });
  });
  it("current seat revocation denies copy and recovery retry despite cached caller membership", async () => {
    const input = await copy(),
      created = await owner.copyWrite(input);
    const moved = await folder("MOVE", "Destination/Source", "Source");
    const inverse = await recovery(moved.receiptId),
      restored = await owner.recoveryWrite(inverse);
    await prisma.membership.update({
      where: {
        organizationId_userId: { organizationId: orgs[0]!, userId: users[0]! },
      },
      data: { seatType: "READ_ONLY" },
    });
    try {
      await expect(owner.copyWrite(input)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(owner.recoveryWrite(inverse)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(owner.recoveryCatalog({ projectId })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    } finally {
      await prisma.membership.update({
        where: {
          organizationId_userId: {
            organizationId: orgs[0]!,
            userId: users[0]!,
          },
        },
        data: { seatType: "FULL" },
      });
    }
    expect(await owner.copyWrite(input)).toEqual({
      ...created,
      recovered: true,
    });
    expect(await owner.recoveryWrite(inverse)).toEqual({
      ...restored,
      recovered: true,
    });
  });
});
