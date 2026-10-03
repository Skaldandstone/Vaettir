import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@vaettir/db";
import { createCaseQueriesRouter } from "./routers/caseQueries.js";
import {
  defaultCaseQuery,
  caseQuerySchema,
  type CaseQuery,
} from "./services/caseQuerySchema.js";
import { hardDeleteOrganization } from "./services/orgHardDelete.js";
const env = {
  PRODUCTION_SIGNAL_ENCRYPTION_KEY: Buffer.alloc(32, 11).toString("base64"),
};
const router = createCaseQueriesRouter(env);
describe("case query explorer (disposable synthetic PostgreSQL)", () => {
  let viewer: ReturnType<typeof router.createCaller>,
    outsider: typeof viewer,
    colleague: typeof viewer;
  let projectId: string,
    foreignProject: string,
    orgId: string,
    viewerId: string;
  const orgs: string[] = [],
    users: string[] = [];
  const input = (query = defaultCaseQuery(), cursor?: string) => ({
    projectId,
    query,
    cursor,
    requestId: randomUUID(),
  });
  const filtered = (rules: unknown[], match = "all") =>
    caseQuerySchema.parse({
      ...defaultCaseQuery(),
      groups: [{ match, rules }],
    });
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
    if (
      !["localhost", "127.0.0.1"].includes(url.hostname) ||
      !/test/i.test(url.pathname) ||
      url.searchParams.has("host")
    )
      throw Error("Disposable synthetic loopback database required");
    const tier = await prisma.planTier.findUniqueOrThrow({
      where: { key: "free" },
    });
    for (const foreign of [false, true]) {
      const key = `case-query-${randomUUID()}`;
      const org = await prisma.organization.create({
        data: { name: key, slug: key, planTierId: tier.id },
      });
      orgs.push(org.id);
      const user = await prisma.user.create({
        data: {
          email: `${key}@example.com`,
          clerkUserId: key,
          memberships: { create: { organizationId: org.id, role: "VIEWER" } },
        },
        include: { memberships: true },
      });
      users.push(user.id);
      const project = await prisma.project.create({
        data: { name: key, slug: key, organizationId: org.id },
      });
      if (foreign) {
        outsider = router.createCaller({ prisma, user });
        foreignProject = project.id;
      } else {
        viewer = router.createCaller({ prisma, user });
        projectId = project.id;
        orgId = org.id;
        viewerId = user.id;
      }
    }
    const second = await prisma.user.create({
      data: {
        email: `case-query-colleague-${randomUUID()}@example.com`,
        clerkUserId: randomUUID(),
        memberships: { create: { organizationId: orgId, role: "VIEWER" } },
      },
      include: { memberships: true },
    });
    users.push(second.id);
    colleague = router.createCaller({ prisma, user: second });
    for (let n = 0; n < 57; n++)
      await prisma.testCase.create({
        data: {
          projectId,
          title:
            n === 0
              ? "Literal 100%_\\ ' OR 1=1"
              : n === 1
                ? "X".repeat(1200)
                : "Synthetic same title",
          given: ["Private procedure not returned"],
          when: ["Synthetic action"],
          then: ["Synthetic expectation"],
          tags: n % 2 ? ["billing"] : [],
          testType: n % 2 ? "UNIT" : "FUNCTIONAL",
          priority: n % 3 ? "LOW" : "HIGH",
          riskScore: n % 2 ? 70 : null,
          suitePath: n === 1 ? "S".repeat(300) : n % 2 ? "Billing" : null,
          validationDomain: n % 2 ? "HIL" : "SOFTWARE",
          archived: n === 56,
        },
      });
    await prisma.testCase.create({
      data: {
        projectId: foreignProject,
        title: "Foreign hidden",
        testType: "UNIT",
        given: [],
        when: [],
        then: [],
        tags: [],
      },
    });
  }, 60000);
  afterAll(async () => {
    for (const id of orgs)
      await hardDeleteOrganization(
        prisma,
        id,
        users[0]!,
        "Disposable synthetic case-query fixture cleanup",
      );
    await prisma.organizationDeletionLog.deleteMany({
      where: { organizationId: { in: orgs }, deletedById: { in: users } },
    });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
  });
  it("paginates deterministically with public identities and no procedures/media; same page is retryable", async () => {
    const first = await viewer.page(input());
    expect(first.total).toBe(56);
    expect(first.items).toHaveLength(50);
    expect(first.nextCursor).toBeTruthy();
    expect(first.items.every((c) => c.displayId && c.caseNumber > 0)).toBe(
      true,
    );
    expect(Object.keys(first.items[0]!)).not.toContain("given");
    expect(JSON.stringify(first.items)).not.toContain("Private procedure");
    const retry = await viewer.page(
      input(defaultCaseQuery(), first.pageCursor),
    );
    expect(retry.items).toEqual(first.items);
    expect(retry.watermark).toBe(first.watermark);
    const next = await viewer.page(
      input(defaultCaseQuery(), first.nextCursor!),
    );
    expect(next.items).toHaveLength(6);
    expect(next.nextCursor).toBeNull();
    expect(new Set([...first.items, ...next.items].map((c) => c.id)).size).toBe(
      56,
    );
    expect(first.items.find((c) => c.titleClipped)?.title).toHaveLength(1000);
    expect(first.items.find((c) => c.suiteClipped)?.suitePath).toHaveLength(
      240,
    );
    expect(first.items.find((c) => c.suitePath === null)?.suiteClipped).toBe(
      false,
    );
  });
  it("evaluates all/any groups and null-risk/archive/domain/tag predicates without wildcard SQL behavior", async () => {
    const literals = await viewer.page(
      input(
        filtered([{ field: "title", operator: "contains", value: "100%_\\" }]),
      ),
    );
    expect(literals.total).toBe(1);
    const query = filtered([
      { field: "type", operator: "equals", value: "UNIT" },
      { field: "riskScore", operator: "atLeast", value: 70 },
    ]);
    expect((await viewer.page(input(query))).total).toBe(28);
    const unassessed = filtered([
      { field: "riskScore", operator: "unassessed", value: 0 },
    ]);
    expect((await viewer.page(input(unassessed))).total).toBe(28);
    const any = filtered(
      [
        { field: "tag", operator: "equals", value: "billing" },
        { field: "title", operator: "contains", value: "Literal" },
      ],
      "any",
    );
    expect((await viewer.page(input(any))).total).toBe(29);
    const groups: CaseQuery = {
      ...defaultCaseQuery(),
      match: "any",
      groups: [
        {
          match: "all",
          rules: [
            { field: "domain", operator: "equals", value: "HIL" },
            { field: "priority", operator: "equals", value: "HIGH" },
          ],
        },
        {
          match: "all",
          rules: [{ field: "title", operator: "contains", value: "Literal" }],
        },
      ],
    };
    expect((await viewer.page(input(groups))).total).toBe(10);
    expect(
      (await viewer.page(input({ ...defaultCaseQuery(), archive: "archived" })))
        .total,
    ).toBe(1);
    expect(
      (await viewer.page(input({ ...defaultCaseQuery(), archive: "all" })))
        .total,
    ).toBe(57);
  });
  it("preserves ties across ascending/descending/title/updated pages", async () => {
    for (const sort of ["caseNumber", "title", "updatedAt"] as const)
      for (const direction of ["asc", "desc"] as const) {
        const query = { ...defaultCaseQuery(), sort, direction };
        const a = await viewer.page(input(query));
        const b = await viewer.page(input(query, a.nextCursor!));
        expect(new Set([...a.items, ...b.items].map((c) => c.id)).size).toBe(
          56,
        );
        expect(b.items).toHaveLength(6);
      }
  });
  it("rejects cross-actor/project/query cursor reuse and foreign tenant access", async () => {
    const first = await viewer.page(input());
    await expect(
      colleague.page(input(defaultCaseQuery(), first.nextCursor!)),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      viewer.page(
        input({ ...defaultCaseQuery(), direction: "desc" }, first.nextCursor!),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(outsider.page(input())).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      viewer.page({ ...input(), projectId: foreignProject }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      viewer.page({
        ...input(),
        query: { ...defaultCaseQuery(), sql: "select *" },
      } as never),
    ).rejects.toThrow();
  });
  it("excludes post-watermark edits/additions and rejects changed/deleted anchors rather than skipping data", async () => {
    const first = await viewer.page(input());
    const anchor = first.items.at(-1)!;
    await prisma.testCase.create({
      data: {
        projectId,
        title: "New after watermark",
        testType: "UNIT",
        given: [],
        when: [],
        then: [],
        tags: [],
      },
    });
    const next = await viewer.page(
      input(defaultCaseQuery(), first.nextCursor!),
    );
    expect(next.total).toBe(56);
    expect(next.items.some((c) => c.title === "New after watermark")).toBe(
      false,
    );
    await prisma.testCase.update({
      where: { id: anchor.id },
      data: { title: "Edited anchor" },
    });
    await expect(
      viewer.page(input(defaultCaseQuery(), first.nextCursor!)),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const refreshed = await viewer.page(input());
    const deleted = refreshed.items.at(-1)!;
    await prisma.testCase.delete({ where: { id: deleted.id } });
    await expect(
      viewer.page(input(defaultCaseQuery(), refreshed.nextCursor!)),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("freshly rejects suspended/reparented projects and revoked cached membership", async () => {
    const first = await viewer.page(input());
    await prisma.organization.update({
      where: { id: orgId },
      data: { suspendedAt: new Date() },
    });
    await expect(
      viewer.page(input(defaultCaseQuery(), first.nextCursor!)),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await prisma.organization.update({
      where: { id: orgId },
      data: { suspendedAt: null },
    });
    await prisma.project.update({
      where: { id: projectId },
      data: { organizationId: orgs[1]! },
    });
    await expect(viewer.page(input())).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await prisma.project.update({
      where: { id: projectId },
      data: { organizationId: orgId },
    });
    await prisma.membership.delete({
      where: {
        organizationId_userId: { organizationId: orgId, userId: viewerId },
      },
    });
    await expect(viewer.page(input())).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});
