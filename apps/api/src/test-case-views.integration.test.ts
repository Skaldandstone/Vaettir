import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@vaettir/db";
import { testCaseViewsRouter } from "./routers/testCaseViews.js";

const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
const isolated = url && ["localhost", "127.0.0.1"].includes(url.hostname) && /test/i.test(url.pathname) && !url.searchParams.has("host");

const filters = {
  suitePath: "Billing", search: "invoice", type: "FUNCTIONAL", automation: "MANUAL",
  priority: "HIGH", review: "APPROVED", origin: "AUTHORED",
  sortBy: "risk" as const, sortDescending: true, showArchived: false,
};

describe.skipIf(!isolated)("private saved test-case views", () => {
  let owner: ReturnType<typeof testCaseViewsRouter.createCaller>;
  let colleague: ReturnType<typeof testCaseViewsRouter.createCaller>;
  let outsider: ReturnType<typeof testCaseViewsRouter.createCaller>;
  let projectId: string;
  let otherProjectId: string;

  beforeAll(async () => {
    const key = `saved-view-${Date.now()}`;
    const tier = await prisma.planTier.findUniqueOrThrow({ where: { key: "free" } });
    const org = await prisma.organization.create({ data: { name: key, slug: key, planTierId: tier.id } });
    const foreign = await prisma.organization.create({ data: { name: `${key}-foreign`, slug: `${key}-foreign`, planTierId: tier.id } });
    const createUser = (suffix: string, organizationId: string) => prisma.user.create({
      data: { email: `${key}-${suffix}@example.com`, clerkUserId: `${key}-${suffix}`, memberships: { create: { organizationId, role: "VIEWER" } } },
      include: { memberships: true },
    });
    const [first, second, third] = await Promise.all([
      createUser("one", org.id), createUser("two", org.id), createUser("foreign", foreign.id),
    ]);
    owner = testCaseViewsRouter.createCaller({ prisma, user: first });
    colleague = testCaseViewsRouter.createCaller({ prisma, user: second });
    outsider = testCaseViewsRouter.createCaller({ prisma, user: third });
    const project = await prisma.project.create({ data: { organizationId: org.id, name: key, slug: key } });
    const other = await prisma.project.create({ data: { organizationId: org.id, name: `${key}-other`, slug: `${key}-other` } });
    projectId = project.id;
    otherProjectId = other.id;
  });

  it("persists the complete filter and sort snapshot only for its owner", async () => {
    const saved = await owner.create({ projectId, name: "High-risk billing", filters });
    expect(saved.filters).toEqual(filters);
    expect(saved.version).toBe(1);
    expect((await owner.list({ projectId })).map(view => view.id)).toContain(saved.id);
    expect(await colleague.list({ projectId })).toEqual([]);
    expect(await owner.list({ projectId: otherProjectId })).toEqual([]);
    await expect(outsider.list({ projectId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(colleague.update({ projectId, id: saved.id, name: "Taken", filters, version: 1 })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(colleague.remove({ projectId, id: saved.id, version: 1 })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(owner.update({ projectId: otherProjectId, id: saved.id, name: "Cross project", filters, version: 1 })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await owner.list({ projectId }))[0]?.name).toBe("High-risk billing");
  });

  it("rejects duplicate names, arbitrary query fields and stale edits", async () => {
    const saved = (await owner.list({ projectId }))[0]!;
    await expect(owner.create({ projectId, name: saved.name, filters })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(owner.create({ projectId, name: "Unsafe", filters: { ...filters, projectId: otherProjectId } })).rejects.toThrow();
    await expect(owner.create({ projectId, name: "Unknown filter", filters: { ...filters, type: "NOT_A_CASE_TYPE" } })).rejects.toThrow();
    const changed = await owner.update({ projectId, id: saved.id, name: "Billing risk", filters: { ...filters, search: "refund" }, version: saved.version });
    expect(changed.version).toBe(2);
    expect(changed.filters.search).toBe("refund");
    await expect(owner.update({ projectId, id: saved.id, name: "Stale", filters, version: 1 })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(owner.remove({ projectId, id: saved.id, version: 1 })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await owner.remove({ projectId, id: saved.id, version: changed.version })).toEqual({ deleted: true });
    expect(await owner.list({ projectId })).toEqual([]);
  });
});
