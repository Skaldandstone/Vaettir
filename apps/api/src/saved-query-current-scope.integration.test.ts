// Authored only. Run in an owned, seeded, migrated loopback database in morning.
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@vaettir/db";
import { createCaseQueriesRouter } from "./routers/caseQueries.js";
import { defaultCaseQuery } from "./services/caseQuerySchema.js";
import { savedCaseQueryWriteInput } from "./services/savedCaseQuerySchema.js";
import { hardDeleteOrganization } from "./services/orgHardDelete.js";

const router = createCaseQueriesRouter();
describe("saved query current actor and original organization", () => {
  const tag = `saved-scope-${randomUUID()}`;
  const orgs: string[] = [],
    userIds: string[] = [],
    clerkIds: string[] = [];
  let projectId: string;
  let owner: ReturnType<typeof router.createCaller>, editor: typeof owner;
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
    if (
      !["localhost", "127.0.0.1"].includes(url.hostname) ||
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
        data: {
          organizationId: orgs[0]!,
          name: tag,
          slug: tag,
        },
      })
    ).id;
    for (const role of ["OWNER", "EDITOR"] as const) {
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
      userIds.push(user.id);
      clerkIds.push(clerkUserId);
      if (role === "OWNER") owner = router.createCaller({ prisma, user });
      else editor = router.createCaller({ prisma, user });
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
        userIds[0]!,
        "Owned saved-query scope fixture cleanup",
      );
    }
    await prisma.organizationDeletionLog.deleteMany({
      where: { organizationId: { in: orgs } },
    });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });
  const create = (
    name: string,
    visibility: "PRIVATE" | "SHARED" = "PRIVATE",
    bound = true,
  ) => ({
    operation: "CREATE" as const,
    projectId,
    requestId: randomUUID(),
    ...(bound
      ? {
          expectedScope: {
            organizationId: orgs[0]!,
            clerkActorId: clerkIds[0]!,
          },
        }
      : {}),
    definition: {
      name,
      visibility,
      query: defaultCaseQuery(),
      columns: ["title" as const],
    },
  });
  it("echoes the authorized reader rather than the shared definition's creator", async () => {
    const shared = await owner.savedWrite(create("Reader identity", "SHARED"));
    const catalog = await editor.savedList({ projectId });
    const detail = await editor.savedById({ projectId, id: shared.value.id });
    expect(catalog).toMatchObject({
      projectId,
      organizationId: orgs[0],
      clerkActorId: clerkIds[1],
      offset: 0,
    });
    expect(detail).toMatchObject({
      projectId,
      organizationId: orgs[0],
      clerkActorId: clerkIds[1],
    });
    expect(detail.value.createdById).toBe(userIds[0]);
    expect(detail.canEdit).toBe(true);
    const personal = await owner.savedWrite(create("Private creator body"));
    expect(
      (await editor.savedList({ projectId })).items.some(
        (value) => value.id === personal.value.id,
      ),
    ).toBe(false);
    await expect(
      editor.savedById({ projectId, id: personal.value.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("refuses a captured CREATE under another fully authorized actor before creating a duplicate", async () => {
    const input = create("Pinned create actor");
    const receipt = await owner.savedWrite(input);
    const count = await prisma.savedTypedCaseQuery.count({
      where: { projectId },
    });
    await expect(editor.savedWrite(input)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(
      await prisma.savedTypedCaseQuery.count({ where: { projectId } }),
    ).toBe(count);
    expect(
      await prisma.savedTypedCaseQueryWrite.count({
        where: { projectId, requestId: input.requestId },
      }),
    ).toBe(1);
    expect(await owner.savedWrite(input)).toEqual(receipt);
  });
  it("checks exact expected actor and organization before accepted receipt replay", async () => {
    const input = create("Pinned replay", "SHARED");
    const receipt = await owner.savedWrite(input);
    for (const expectedScope of [
      { organizationId: orgs[1]!, clerkActorId: clerkIds[0]! },
      { organizationId: orgs[0]!, clerkActorId: clerkIds[1]! },
    ])
      await expect(
        owner.savedWrite({ ...input, expectedScope }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const update = {
      operation: "UPDATE" as const,
      projectId,
      requestId: randomUUID(),
      id: receipt.value.id,
      expectedVersion: 1,
      expectedScope: input.expectedScope,
      definition: { ...input.definition, name: "Pinned edit" },
    };
    await expect(editor.savedWrite(update)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const deletion = {
      operation: "DELETE" as const,
      projectId,
      requestId: randomUUID(),
      id: receipt.value.id,
      expectedVersion: 1,
      expectedScope: input.expectedScope,
    };
    await expect(editor.savedWrite(deletion)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(
      (await owner.savedById({ projectId, id: receipt.value.id })).value
        .version,
    ).toBe(1);
    expect(await owner.savedWrite(input)).toEqual(receipt);
  });
  it("hides original-organization private/shared records after reparent even for a dual-org editor", async () => {
    const input = create("Original tenant capture", "SHARED");
    const receipt = await owner.savedWrite(input);
    await prisma.project.update({
      where: { id: projectId },
      data: { organizationId: orgs[1]! },
    });
    try {
      const current = await owner.savedList({ projectId });
      expect(current.organizationId).toBe(orgs[1]);
      expect(current.clerkActorId).toBe(clerkIds[0]);
      expect(current.items).toEqual([]);
      await expect(
        owner.savedById({ projectId, id: receipt.value.id }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(owner.savedWrite(input)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    } finally {
      await prisma.project.update({
        where: { id: projectId },
        data: { organizationId: orgs[0]! },
      });
    }
    expect(await owner.savedWrite(input)).toEqual(receipt);
  });
  it("keeps legacy absent-scope JSON hashes and exact receipts without adding defaults", async () => {
    const input = create("Legacy exact hash", "PRIVATE", false);
    const parsed = savedCaseQueryWriteInput.parse(input);
    expect(Object.hasOwn(parsed, "expectedScope")).toBe(false);
    const receipt = await owner.savedWrite(input);
    const row = await prisma.savedTypedCaseQueryWrite.findUniqueOrThrow({
      where: {
        projectId_actorId_requestId: {
          projectId,
          actorId: userIds[0]!,
          requestId: input.requestId,
        },
      },
    });
    expect(row.requestHash).toBe(
      createHash("sha256").update(JSON.stringify(parsed)).digest("hex"),
    );
    expect(await owner.savedWrite(input)).toEqual(receipt);
    await prisma.membership.update({
      where: {
        organizationId_userId: {
          organizationId: orgs[0]!,
          userId: userIds[0]!,
        },
      },
      data: { seatType: "READ_ONLY" },
    });
    try {
      await expect(owner.savedWrite(input)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect((await owner.savedList({ projectId })).canWrite).toBe(false);
    } finally {
      await prisma.membership.update({
        where: {
          organizationId_userId: {
            organizationId: orgs[0]!,
            userId: userIds[0]!,
          },
        },
        data: { seatType: "FULL" },
      });
    }
  });
});
