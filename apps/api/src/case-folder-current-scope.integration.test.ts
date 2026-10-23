// Authored source only. No execution tonight; use an owned migrated loopback DB.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@vaettir/db";
import { caseFoldersRouter } from "./routers/caseFolders.js";
import { hardDeleteOrganization } from "./services/orgHardDelete.js";
import { approvedFolderChangeSchema } from "./services/caseFolderSchema.js";
import { qualityProfileHash } from "./services/qualityExperienceProfile.js";
describe("folder reviewed identity and populated move", () => {
  const tag = `folder-scope-${randomUUID()}`;
  const orgs: string[] = [],
    users: string[] = [],
    clerks: string[] = [];
  let projectId: string;
  let owner: ReturnType<typeof caseFoldersRouter.createCaller>,
    editor: typeof owner,
    viewer: typeof owner;
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
    if (
      !["127.0.0.1", "localhost"].includes(url.hostname) ||
      !/test/i.test(url.pathname) ||
      url.searchParams.has("host")
    )
      throw Error("Owned disposable loopback database required");
    const tier = await prisma.planTier.findUniqueOrThrow({
      where: { key: "free" },
    });
    for (let n = 0; n < 2; n++)
      orgs.push(
        (
          await prisma.organization.create({
            data: {
              name: `${tag}-${n}`,
              slug: `${tag}-${n}`,
              planTierId: tier.id,
            },
          })
        ).id,
      );
    projectId = (
      await prisma.project.create({
        data: { organizationId: orgs[0]!, name: tag, slug: tag },
      })
    ).id;
    for (const role of ["OWNER", "EDITOR", "VIEWER"] as const) {
      const clerkUserId = `${tag}-${role}`;
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
  });
  afterAll(async () => {
    if (projectId) {
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { slug: true },
      });
      if (project && project.slug !== tag)
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
        "Owned folder scope fixture cleanup",
      );
    }
    await prisma.organizationDeletionLog.deleteMany({
      where: { organizationId: { in: orgs } },
    });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
  });
  async function request(
    action: "CREATE" | "MOVE" | "RENAME",
    toPath: string,
    fromPath?: string,
    bind = true,
  ) {
    const input = {
      projectId,
      action,
      toPath,
      ...(fromPath ? { fromPath } : {}),
    };
    const preview = await owner.preview(input);
    return {
      ...input,
      expectedHash: preview.expectedHash,
      requestId: randomUUID(),
      confirmed: true as const,
      reason: "Synthetic reviewed hierarchy change",
      ...(bind
        ? {
            expectedScope: {
              organizationId: orgs[0]!,
              clerkActorId: clerks[0]!,
            },
          }
        : {}),
    };
  }
  it("echoes exact current reader scope without changing viewer/full-editor policy", async () => {
    await owner.write(await request("CREATE", "Readable"));
    const list = await viewer.list({ projectId });
    expect(list).toMatchObject({
      projectId,
      organizationId: orgs[0],
      clerkActorId: clerks[2],
      canEdit: false,
    });
    expect(list.paths).toContain("Readable");
    const preview = await editor.preview({
      projectId,
      action: "RENAME",
      fromPath: "Readable",
      toPath: "ReaderRenamed",
    });
    expect(preview).toMatchObject({
      projectId,
      organizationId: orgs[0],
      clerkActorId: clerks[1],
      action: "RENAME",
      fromPath: "Readable",
      toPath: "ReaderRenamed",
    });
    await expect(
      viewer.preview({ projectId, action: "CREATE", toPath: "Viewer denied" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("refuses captured identity mismatch before replay or another actor's receipt creation", async () => {
    const input = await request("CREATE", "Pinned");
    const receipt = await owner.write(input);
    expect(receipt).toMatchObject({
      projectId,
      organizationId: orgs[0],
      clerkActorId: clerks[0],
      requestId: input.requestId,
    });
    await expect(editor.write(input)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      owner.write({
        ...input,
        expectedScope: { organizationId: orgs[1]!, clerkActorId: clerks[0]! },
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(
      await prisma.caseFolderWrite.count({
        where: { projectId, requestId: input.requestId },
      }),
    ).toBe(1);
    expect(await owner.write(input)).toEqual({ ...receipt, recovered: true });
    await prisma.project.update({
      where: { id: projectId },
      data: { organizationId: orgs[1]! },
    });
    try {
      expect((await owner.list({ projectId })).organizationId).toBe(orgs[1]);
      await expect(owner.write(input)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    } finally {
      await prisma.project.update({
        where: { id: projectId },
        data: { organizationId: orgs[0]! },
      });
    }
    expect(await owner.write(input)).toEqual({ ...receipt, recovered: true });
  });
  it("keeps legacy absent identity and receipt hashes intact under current authorization", async () => {
    const input = await request("CREATE", "LegacyFolder", undefined, false);
    const parsed = approvedFolderChangeSchema.parse(input);
    expect(Object.hasOwn(parsed, "expectedScope")).toBe(false);
    const receipt = await owner.write(parsed);
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
    expect(await owner.write(parsed)).toEqual({ ...receipt, recovered: true });
    await prisma.membership.update({
      where: {
        organizationId_userId: { organizationId: orgs[0]!, userId: users[0]! },
      },
      data: { seatType: "READ_ONLY" },
    });
    try {
      await expect(owner.write(parsed)).rejects.toMatchObject({
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
  });
  it("moves a populated hierarchy with fresh identity, no-op/cycle refusals and exact placement CAS", async () => {
    await owner.write(await request("CREATE", "Destination"));
    await owner.write(await request("CREATE", "Source"));
    await owner.write(await request("CREATE", "Source/Child"));
    const c = await prisma.testCase.create({
      data: {
        projectId,
        title: "Synthetic original procedure",
        testType: "FUNCTIONAL",
        given: ["Original Given"],
        when: ["Original When"],
        then: ["Original Then"],
        suitePath: "Source/Child",
        sortPosition: 7,
      },
    });
    const input = await request("MOVE", "Destination/Source", "Source");
    await expect(
      owner.preview({
        projectId,
        action: "MOVE",
        fromPath: "Source",
        toPath: "Source",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      owner.preview({
        projectId,
        action: "MOVE",
        fromPath: "Source",
        toPath: "Source/Child/Source",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await prisma.testCase.update({
      where: { id: c.id },
      data: { sortPosition: 8 },
    });
    await expect(owner.write(input)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(
      (await prisma.testCase.findUniqueOrThrow({ where: { id: c.id } }))
        .suitePath,
    ).toBe("Source/Child");
    await owner.write(await request("MOVE", "Destination/Source", "Source"));
    const moved = await prisma.testCase.findUniqueOrThrow({
      where: { id: c.id },
    });
    expect(moved).toMatchObject({
      displayId: c.displayId,
      suitePath: "Destination/Source/Child",
      sortPosition: 8,
      given: c.given,
      when: c.when,
      then: c.then,
    });
    expect(
      await prisma.testCaseVersion.count({ where: { testCaseId: c.id } }),
    ).toBe(1);
  });
});
