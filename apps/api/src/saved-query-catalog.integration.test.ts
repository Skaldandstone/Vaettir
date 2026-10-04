// SOURCE ONLY: authored NOT RUN; uniquely owned seeded/migrated loopback DB.
import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, afterEach, describe, it, expect } from "vitest";
import { prisma, type PrismaClient } from "@vaettir/db";
import { createCaseQueriesRouter } from "./routers/caseQueries.js";
import { defaultCaseQuery } from "./services/caseQuerySchema.js";
import {
  withSavedQueryAccess,
  listSavedCaseQueries,
  getSavedCaseQuery,
} from "./services/savedCaseQueries.js";
import {
  savedCaseQueryCatalogKey,
  type SavedCaseQueryCatalogFilters,
} from "./services/savedCaseQuerySchema.js";
import { hardDeleteOrganization } from "./services/orgHardDelete.js";

describe("saved catalog literal search/current privacy (NOT RUN)", () => {
  const tag = `saved-catalog-${randomUUID()}`;
  let orgId: string,
    foreignOrgId: string,
    projectId: string,
    foreignProjectId: string;
  let actorId: string, otherActorId: string, clerkActorId: string;
  let owner: ReturnType<
      ReturnType<typeof createCaseQueriesRouter>["createCaller"]
    >,
    other: typeof owner;
  const userIds: string[] = [];
  beforeAll(() => {
    const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
    if (
      !["localhost", "127.0.0.1"].includes(url.hostname) ||
      !/test/i.test(url.pathname) ||
      url.searchParams.has("host")
    )
      throw Error("Owned migrated/seeded loopback test database required");
  });
  beforeEach(async () => {
    userIds.length = 0;
    const tier = await prisma.planTier.findUniqueOrThrow({
      where: { key: "free" },
    });
    const org = async () =>
      prisma.organization.create({
        data: {
          name: tag,
          slug: `${tag}-${randomUUID()}`,
          planTierId: tier.id,
        },
      });
    orgId = (await org()).id;
    foreignOrgId = (await org()).id;
    projectId = (
      await prisma.project.create({
        data: { organizationId: orgId, name: tag, slug: randomUUID() },
      })
    ).id;
    foreignProjectId = (
      await prisma.project.create({
        data: { organizationId: foreignOrgId, name: tag, slug: randomUUID() },
      })
    ).id;
    for (const n of [0, 1]) {
      const clerkUserId = `${tag}-${randomUUID()}`;
      const user = await prisma.user.create({
        data: {
          clerkUserId,
          email: `${clerkUserId}@example.com`,
          memberships: {
            create: [
              {
                organizationId: orgId,
                role: n === 0 ? "OWNER" : "EDITOR",
                seatType: "FULL",
              },
              { organizationId: foreignOrgId, role: "OWNER", seatType: "FULL" },
            ],
          },
        },
        include: { memberships: true },
      });
      userIds.push(user.id);
      const caller = createCaseQueriesRouter().createCaller({ prisma, user });
      if (n === 0) {
        actorId = user.id;
        clerkActorId = clerkUserId;
        owner = caller;
      } else {
        otherActorId = user.id;
        other = caller;
      }
    }
  });
  afterEach(async () => {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { organizationId: true },
    });
    if (project && project.organizationId !== orgId)
      await prisma.project.update({
        where: { id: projectId },
        data: { organizationId: orgId },
      });
    for (const organizationId of [orgId, foreignOrgId]) {
      const org = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { slug: true },
      });
      if (!org) continue;
      if (!org.slug.startsWith(tag)) throw Error("Fixture ownership mismatch");
      await hardDeleteOrganization(
        prisma,
        organizationId,
        actorId,
        "Owned saved catalog fixture cleanup",
      );
    }
    await prisma.organizationDeletionLog.deleteMany({
      where: { organizationId: { in: [orgId, foreignOrgId] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: userIds }, clerkUserId: { startsWith: tag } },
    });
  });
  const filter = (
    search = "",
    collection: SavedCaseQueryCatalogFilters["collection"] = "ALL",
    sort: SavedCaseQueryCatalogFilters["sort"] = "NAME_ASC",
  ) => ({ search, collection, sort });
  const input = (catalog = filter(), offset = 0) => ({
    projectId,
    offset,
    catalog,
    expectedScope: { organizationId: orgId, clerkActorId },
  });
  const row = (name: string, visibility = "PRIVATE", createdById = actorId) =>
    prisma.savedTypedCaseQuery.create({
      data: {
        organizationId: orgId,
        projectId,
        createdById,
        name,
        visibility,
        definition: defaultCaseQuery(),
        columns: ["title"],
      },
    });
  it("keeps legacy name/id order and selects metadata without materializing/decoding definitions", async () => {
    const b = await row("B"),
      a = await row("A"),
      privateOther = await row("Private other", "PRIVATE", otherActorId);
    await prisma.savedTypedCaseQuery.update({
      where: { id: a.id },
      data: {
        definition: { unknown: "x".repeat(500000) },
        columns: { unsupported: true },
      },
    });
    const blocked = prisma.$extends({
      query: {
        savedTypedCaseQuery: {
          async findMany() {
            throw Error("Catalog must not materialize full records");
          },
        },
      },
    });
    const list = await withSavedQueryAccess(
      blocked as unknown as PrismaClient,
      projectId,
      actorId,
      orgId,
      (tx, access) => listSavedCaseQueries(tx, access, projectId, 0),
    );
    expect(list.items.map((r) => r.id)).toEqual([a.id, b.id]);
    expect(list).not.toHaveProperty("catalog");
    expect(list).not.toHaveProperty("catalogKey");
    expect(list.items).not.toContainEqual(
      expect.objectContaining({ id: privateOther.id }),
    );
    expect(list.items[0]).not.toHaveProperty("definition");
    expect(list.items[0]).not.toHaveProperty("columns");
    await expect(
      owner.savedById({ projectId, id: a.id }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
  it("searches literal %, underscore, backslash, quotes and retained spaces case-insensitively without wildcard or injection interpretation", async () => {
    const literal = await row(" MiXeD %_\\ ' OR TRUE -- ");
    await row("Other percent %");
    await row("Other underscore _");
    await row("No match");
    for (const search of ["mixed %_\\", "%_\\", "' OR TRUE --", " MiXeD "]) {
      const f = filter(search),
        list = await owner.savedList(input(f));
      expect(list.items.map((r) => r.id)).toEqual([literal.id]);
      expect(list.catalog).toEqual(f);
      expect(list.catalogKey).toBe(savedCaseQueryCatalogKey(f));
    }
    expect((await owner.savedList(input(filter("%_x")))).items).toEqual([]);
  });
  it("filters personal/shared/mine independently while excluding all foreign private rows and uses deterministic sort ties", async () => {
    const personal = await row("A"),
      mineShared = await row("B", "SHARED"),
      otherShared = await row("C", "SHARED", otherActorId);
    await row("Secret private", "PRIVATE", otherActorId);
    const ids = async (
      collection: SavedCaseQueryCatalogFilters["collection"],
      sort: SavedCaseQueryCatalogFilters["sort"] = "NAME_ASC",
    ) =>
      (await owner.savedList(input(filter("", collection, sort)))).items.map(
        (r) => r.id,
      );
    expect(await ids("PERSONAL")).toEqual([personal.id]);
    expect(await ids("SHARED")).toEqual([mineShared.id, otherShared.id]);
    expect(await ids("MINE")).toEqual([personal.id, mineShared.id]);
    expect(await ids("ALL", "NAME_DESC")).toEqual([
      otherShared.id,
      mineShared.id,
      personal.id,
    ]);
    const tied = await row("A");
    await prisma.savedTypedCaseQuery.updateMany({
      where: { projectId },
      data: { updatedAt: new Date("2026-01-01T00:00:00Z") },
    });
    expect(
      (
        await owner.savedList(input(filter("", "ALL", "UPDATED_DESC")))
      ).items.map((r) => r.id),
    ).toEqual(
      [personal.id, tied.id].sort().concat([mineShared.id, otherShared.id]),
    );
    await expect(
      other.savedById({ projectId, id: personal.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("caps four pages and reaches matches beyond the default window by literal search without unreachable requests", async () => {
    await prisma.savedTypedCaseQuery.createMany({
      data: Array.from({ length: 205 }, (_, i) => ({
        organizationId: orgId,
        projectId,
        createdById: actorId,
        name: `Query ${String(i).padStart(3, "0")}`,
        visibility: "PRIVATE",
        definition: defaultCaseQuery(),
        columns: ["title"],
      })),
    });
    const seen = new Set<string>();
    for (const offset of [0, 50, 100, 150]) {
      const page = await owner.savedList(input(filter(), offset));
      expect(page.items).toHaveLength(50);
      for (const r of page.items) {
        expect(seen.has(r.id)).toBe(false);
        seen.add(r.id);
      }
      expect(page.nextOffset).toBe(offset === 150 ? null : offset + 50);
      expect(page.catalogTruncated).toBe(offset === 150);
    }
    expect((await owner.savedList(input(filter(), 150))).hasMore).toBe(true);
    const narrowed = await owner.savedList(input(filter("Query 204")));
    expect(narrowed.items.map((r) => r.name)).toEqual(["Query 204"]);
    expect(narrowed.nextOffset).toBeNull();
    await expect(
      owner.savedList({ ...input(), offset: 200 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it("checks original read scope as a refusal, including actors with full seats in both reparented scopes", async () => {
    const saved = await row("Original");
    const otherProject = await owner.savedList({
      ...input(),
      projectId: foreignProjectId,
      expectedScope: { organizationId: foreignOrgId, clerkActorId },
    });
    expect(otherProject.items).toEqual([]);
    await expect(
      owner.savedById({ projectId: foreignProjectId, id: saved.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      owner.savedList({
        ...input(),
        expectedScope: { organizationId: foreignOrgId, clerkActorId },
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      owner.savedList({
        ...input(),
        expectedScope: { organizationId: orgId, clerkActorId: "other" },
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await prisma.project.update({
      where: { id: projectId },
      data: { organizationId: foreignOrgId },
    });
    try {
      await expect(owner.savedList(input())).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      const current = await owner.savedList({
        ...input(),
        expectedScope: { organizationId: foreignOrgId, clerkActorId },
      });
      expect(current.items).toEqual([]);
      expect(current.organizationId).toBe(foreignOrgId);
      await expect(
        owner.savedById({ projectId, id: saved.id }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    } finally {
      await prisma.project.update({
        where: { id: projectId },
        data: { organizationId: orgId },
      });
    }
    expect((await owner.savedList(input())).items.map((r) => r.id)).toEqual([
      saved.id,
    ]);
  });
  it("rechecks current membership and suspension; supports existing read-only/auditor roles without granting writes", async () => {
    await row("Shared", "SHARED");
    await prisma.membership.update({
      where: {
        organizationId_userId: { organizationId: orgId, userId: actorId },
      },
      data: { role: "VIEWER", seatType: "READ_ONLY" },
    });
    expect((await owner.savedList(input())).canWrite).toBe(false);
    await prisma.membership.update({
      where: {
        organizationId_userId: { organizationId: orgId, userId: actorId },
      },
      data: { role: "COMPLIANCE_AUDITOR", seatType: "FULL" },
    });
    expect((await owner.savedList(input())).canWrite).toBe(false);
    await prisma.organization.update({
      where: { id: orgId },
      data: { suspendedAt: new Date() },
    });
    await expect(owner.savedList(input())).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await prisma.organization.update({
      where: { id: orgId },
      data: { suspendedAt: null },
    });
    await prisma.membership.delete({
      where: {
        organizationId_userId: { organizationId: orgId, userId: actorId },
      },
    });
    await expect(owner.savedList(input())).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
  it("pins transport Clerk identity after project lock and refuses cached caller identity after a committed actor change", async () => {
    await row("Pinned");
    const changed = `${tag}-changed-${randomUUID()}`;
    const list = await withSavedQueryAccess(
      prisma,
      projectId,
      actorId,
      orgId,
      async (tx, access) => {
        await expect(
          prisma.$transaction(
            async (rival) => {
              await rival.$executeRaw`SET LOCAL lock_timeout='100ms'`;
              await rival.$executeRaw`UPDATE "User" SET "clerkUserId"=${changed} WHERE id=${actorId}`;
            },
            { timeout: 2000 },
          ),
        ).rejects.toMatchObject({ code: "P2010", meta: { code: "55P03" } });
        return listSavedCaseQueries(tx, access, projectId, 0, {
          catalog: filter(),
          expectedScope: { organizationId: orgId, clerkActorId },
        });
      },
      clerkActorId,
    );
    expect(list.clerkActorId).toBe(clerkActorId);
    try {
      await prisma.user.update({
        where: { id: actorId },
        data: { clerkUserId: changed },
      });
      await expect(
        owner.savedList({
          ...input(),
          expectedScope: { organizationId: orgId, clerkActorId: changed },
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      // Old direct helper callers deliberately retain optional-transport behavior.
      const legacy = await withSavedQueryAccess(
        prisma,
        projectId,
        actorId,
        orgId,
        (tx, a) => listSavedCaseQueries(tx, a, projectId, 0),
      );
      expect(legacy.clerkActorId).toBe(changed);
    } finally {
      await prisma.user.update({
        where: { id: actorId },
        data: { clerkUserId: clerkActorId },
      });
    }
  });
  it("preserves current-member reads for supported read-only role combinations while refusing writes and receipt creation", async () => {
    const saved = await row("Downgraded creator private definition");
    await row("Visible shared definition", "SHARED", otherActorId);
    for (const role of [
      "OWNER",
      "ADMIN",
      "EDITOR",
      "VIEWER",
      "COMPLIANCE_AUDITOR",
    ] as const) {
      await prisma.membership.update({
        where: {
          organizationId_userId: { organizationId: orgId, userId: actorId },
        },
        data: { role, seatType: "READ_ONLY" },
      });
      const page = await owner.savedList(input());
      expect(page.canWrite).toBe(false);
      expect(page.items.every((item) => !item.canEdit)).toBe(true);
      const body = await owner.savedById({
        projectId,
        id: saved.id,
        expectedScope: { organizationId: orgId, clerkActorId },
      });
      expect(body.value.id).toBe(saved.id);
      expect(body.canEdit).toBe(false);
      await expect(
        owner.savedWrite({
          operation: "CREATE",
          projectId,
          requestId: randomUUID(),
          definition: {
            name: "Forbidden mutation",
            visibility: "PRIVATE",
            query: defaultCaseQuery(),
            columns: ["title"],
          },
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(
      await prisma.savedTypedCaseQueryWrite.count({ where: { projectId } }),
    ).toBe(0);
    expect(
      await prisma.savedTypedCaseQuery.count({ where: { projectId } }),
    ).toBe(2);
  });
  it("binds selected definition reads independently and refuses scope before materializing the private body", async () => {
    const saved = await row("Private selected body");
    const expectedScope = { organizationId: orgId, clerkActorId };
    const original = await owner.savedById({
      projectId,
      id: saved.id,
      expectedScope,
    });
    expect(original.value.id).toBe(saved.id);
    expect(original.value.query).toEqual(defaultCaseQuery());
    const blocked = prisma.$extends({
      query: {
        savedTypedCaseQuery: {
          async findFirst() {
            throw Error("Private body was materialized before scope refusal");
          },
        },
      },
    });
    for (const bad of [
      { organizationId: foreignOrgId, clerkActorId },
      { organizationId: orgId, clerkActorId: "another-actor" },
    ])
      await expect(
        withSavedQueryAccess(
          blocked as unknown as PrismaClient,
          projectId,
          actorId,
          orgId,
          (tx, access) =>
            getSavedCaseQuery(tx, access, projectId, saved.id, bad),
          clerkActorId,
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await owner.savedById({ projectId, id: saved.id })).value).toEqual(
      original.value,
    );
    expect(
      await prisma.savedTypedCaseQueryWrite.count({ where: { projectId } }),
    ).toBe(0);
  });
  it("does not retarget an old selected-body scope when the project is reparented to another full-seat workspace", async () => {
    const saved = await row("Original selected body");
    const captured = {
      projectId,
      id: saved.id,
      expectedScope: { organizationId: orgId, clerkActorId },
    };
    await prisma.project.update({
      where: { id: projectId },
      data: { organizationId: foreignOrgId },
    });
    try {
      await expect(owner.savedById(captured)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(
        owner.savedById({
          ...captured,
          expectedScope: { organizationId: foreignOrgId, clerkActorId },
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    } finally {
      await prisma.project.update({
        where: { id: projectId },
        data: { organizationId: orgId },
      });
    }
    expect((await owner.savedById(captured)).value.id).toBe(saved.id);
  });
  it("fails oversized metadata safely while leaving definitions and write receipts unchanged", async () => {
    const saved = await row("Supported");
    await prisma.savedTypedCaseQuery.update({
      where: { id: saved.id },
      data: { name: "x".repeat(1000) },
    });
    const before = await prisma.savedTypedCaseQuery.findUniqueOrThrow({
      where: { id: saved.id },
    });
    await expect(owner.savedList(input())).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(
      await prisma.savedTypedCaseQuery.findUniqueOrThrow({
        where: { id: saved.id },
      }),
    ).toEqual(before);
    expect(
      await prisma.savedTypedCaseQueryWrite.count({ where: { projectId } }),
    ).toBe(0);
    // A bounded filter can still reach healthy independent rows, not silently skip malformed matching metadata.
    await row("Healthy");
    expect(
      (await owner.savedList(input(filter("Healthy")))).items.map(
        (r) => r.name,
      ),
    ).toEqual(["Healthy"]);
  });
});
