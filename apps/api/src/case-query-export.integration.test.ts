// Synthetic integration coverage; requires an owned migrated loopback test DB.
import { randomUUID } from "node:crypto";
import { describe, beforeAll, afterAll, it, expect } from "vitest";
import { Prisma, prisma } from "@vaettir/db";
import { createCaseQueryExportRouter } from "./routers/caseQueryExport.js";
import { createCaseQueriesRouter } from "./routers/caseQueries.js";
import {
  defaultCaseQuery,
  type CaseQuery,
} from "./services/caseQuerySchema.js";
import { hardDeleteOrganization } from "./services/orgHardDelete.js";
import {
  withCaseQueryExportAccess,
  reviewCaseQueryExport,
} from "./services/caseQueryExport.js";

describe("whole applied typed-query reviewed metadata export", () => {
  const tag = `query-export-${randomUUID()}`,
    orgs: string[] = [],
    users: string[] = [];
  const env = {
    PRODUCTION_SIGNAL_ENCRYPTION_KEY: Buffer.alloc(32, 24).toString("base64"),
  };
  const router = createCaseQueryExportRouter(env),
    pager = createCaseQueriesRouter(env);
  type Caller = ReturnType<typeof router.createCaller>;
  let owner: Caller,
    viewer: Caller,
    outsider: Caller,
    pages: ReturnType<typeof pager.createCaller>,
    projectId: string,
    actorId: string;
  const fields = [
    {
      key: "label",
      label: "Label",
      type: "TEXT",
      required: false,
      retired: false,
      options: [],
    },
    {
      key: "enabled",
      label: "Enabled",
      type: "BOOLEAN",
      required: false,
      retired: false,
      options: [],
    },
    {
      key: "number",
      label: "Number",
      type: "NUMBER",
      required: false,
      retired: false,
      options: [],
    },
    {
      key: "private_note",
      label: "Private note",
      type: "TEXT",
      required: false,
      retired: false,
      options: [],
    },
  ];
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
    for (let index = 0; index < 2; index++) {
      const org = await prisma.organization.create({
        data: {
          name: `${tag}-${index}`,
          slug: `${tag}-${index}`,
          planTierId: tier.id,
        },
      });
      orgs.push(org.id);
      const user = await prisma.user.create({
        data: {
          email: `${tag}-${index}@example.com`,
          clerkUserId: `${tag}-${index}`,
          memberships: {
            create: { organizationId: org.id, role: "OWNER", seatType: "FULL" },
          },
        },
        include: { memberships: true },
      });
      users.push(user.id);
      if (index === 0) {
        actorId = user.id;
        owner = router.createCaller({ prisma, user });
        pages = pager.createCaller({ prisma, user });
        const project = await prisma.project.create({
          data: {
            organizationId: org.id,
            name: tag,
            slug: tag,
            caseKey: `e${randomUUID().replaceAll("-", "").slice(0, 12)}`,
            caseFieldSchema: { version: 1, fields },
          },
        });
        projectId = project.id;
      } else outsider = router.createCaller({ prisma, user });
    }
    const user = await prisma.user.create({
      data: {
        email: `${tag}-viewer@example.com`,
        clerkUserId: `${tag}-viewer`,
        memberships: {
          create: {
            organizationId: orgs[0]!,
            role: "VIEWER",
            seatType: "READ_ONLY",
          },
        },
      },
      include: { memberships: true },
    });
    users.push(user.id);
    viewer = router.createCaller({ prisma, user });
    await prisma.testCase.createMany({
      data: Array.from({ length: 103 }, (_, index) => ({
        projectId,
        testType: "FUNCTIONAL" as const,
        title:
          index === 0
            ? '=HYPERLINK("https://example.invalid")'
            : `Row ${String(index).padStart(4, "0")}`,
        tags: [tag],
        priority: index % 2 ? ("LOW" as const) : ("HIGH" as const),
        given: ["DO NOT EXPORT PROCEDURE"],
        customFields:
          index === 0
            ? {}
            : index === 1
              ? {
                  label: null,
                  enabled: null,
                  number: null,
                  private_note: "DO NOT EXPORT PRIVATE",
                }
              : ({
                  label: "",
                  enabled: false,
                  number: 0,
                  private_note: "DO NOT EXPORT PRIVATE",
                } as Prisma.InputJsonValue),
      })),
    });
  });
  afterAll(async () => {
    for (const orgId of orgs) {
      const org = await prisma.organization.findUniqueOrThrow({
        where: { id: orgId },
      });
      if (!org.slug.startsWith(tag)) throw Error("Fixture ownership mismatch");
      const receipt = await hardDeleteOrganization(
        prisma,
        orgId,
        actorId,
        "Owned whole-query export fixture erasure",
      );
      const removed = await prisma.organizationDeletionLog.deleteMany({
        where: {
          id: receipt.deletionLogId,
          organizationId: orgId,
          organizationSlug: org.slug,
          deletedById: actorId,
        },
      });
      expect(removed.count).toBe(1);
    }
    await prisma.user.deleteMany({ where: { id: { in: users } } });
  });
  const input = (
    query: CaseQuery = {
      ...defaultCaseQuery(),
      groups: [
        {
          match: "all",
          rules: [{ field: "tag", operator: "equals", value: tag }],
        },
      ],
    },
  ) => ({
    projectId,
    query,
    columns: ["title", "priority"],
    format: "METADATA" as const,
    requestId: randomUUID(),
  });
  const approve = async (scope: ReturnType<typeof input>) => {
    const review = await owner.review(scope);
    return {
      review,
      result: await owner.confirm({
        ...scope,
        organizationId: review.organizationId,
        expectedFingerprint: review.fingerprint,
        confirmed: true,
      }),
    };
  };
  it("exports all 103 rows with stable IDs rather than first50 and excludes procedure/private metadata", async () => {
    const scope = input(),
      { review, result } = await approve(scope);
    expect(review.total).toBe(103);
    expect(review.sample).toHaveLength(5);
    const first = await pages.page({
      projectId,
      query: scope.query,
      requestId: randomUUID(),
    });
    expect(first.items).toHaveLength(50);
    expect(first.nextCursor).not.toBeNull();
    const cases = await prisma.testCase.findMany({
      where: { projectId, tags: { has: tag } },
      select: { displayId: true },
    });
    for (const row of cases) expect(result.csv).toContain(`"${row.displayId}"`);
    expect(result.csv).toContain("'=HYPERLINK");
    expect(result.csv).not.toContain("DO NOT EXPORT");
    expect(result.csv).toContain("not a full-fidelity backup");
  });
  it("preserves ABSENT NULL empty VALUE false and numeric zero only when explicitly selected", async () => {
    const base = input(),
      bindings = fields.slice(0, 3).map(({ key, type, options }) => ({
        key,
        type: type as "TEXT" | "BOOLEAN" | "NUMBER",
        options,
      }));
    const scope = {
      ...base,
      query: { ...base.query, customColumns: bindings },
      columns: ["custom:label", "custom:enabled", "custom:number"],
    };
    const review = await viewer.review(scope);
    const result = await viewer.confirm({
      ...scope,
      organizationId: review.organizationId,
      expectedFingerprint: review.fingerprint,
      confirmed: true,
    });
    expect(result.csv).toContain('"ABSENT","Unavailable"');
    expect(result.csv).toContain('"NULL","Unavailable"');
    expect(result.csv).toContain('"VALUE","","VALUE","false","VALUE","0"');
    expect(result.csv).not.toContain("DO NOT EXPORT PRIVATE");
  });
  it("uses exact mixed AND/OR predicates and deterministic complete compiler order", async () => {
    const query: CaseQuery = {
      ...defaultCaseQuery(),
      sort: "title",
      direction: "desc",
      match: "all",
      groups: [
        {
          match: "all",
          rules: [{ field: "tag", operator: "equals", value: tag }],
        },
        {
          match: "any",
          rules: [
            { field: "priority", operator: "equals", value: "LOW" },
            { field: "title", operator: "contains", value: "HYPERLINK" },
          ],
        },
      ],
    };
    const scope = input(query),
      review = await owner.review(scope),
      page = await pages.page({ projectId, query, requestId: randomUUID() });
    expect(review.total).toBe(page.total);
    expect(review.sample.map((row) => row[0])).toEqual(
      page.items.slice(0, 5).map((row) => row.displayId),
    );
  });
  it("produces neutral selected distributions without exporting raw authored values", async () => {
    const base = input(),
      scope = { ...base, format: "AGGREGATES" as const };
    const review = await owner.review(scope);
    const result = await owner.confirm({
      ...scope,
      organizationId: review.organizationId,
      expectedFingerprint: review.fingerprint,
      confirmed: true,
    });
    expect(
      review.aggregates
        .filter((row) => row.field === "Priority")
        .reduce((sum, row) => sum + row.count, 0),
    ).toBe(103);
    expect(result.csv).not.toContain("HYPERLINK");
    expect(result.csv).not.toContain("Row 0002");
    expect(result.csv).toContain(
      '"Entire applied query","Matching cases","103"',
    );
  });
  it("refuses reviewed scope after case edit insertion field definition or project label change", async () => {
    const scope = input(),
      review = await owner.review(scope);
    const row = await prisma.testCase.findFirstOrThrow({
      where: { projectId, tags: { has: tag } },
    });
    await prisma.testCase.update({
      where: { id: row.id },
      data: { priority: row.priority === "LOW" ? "HIGH" : "LOW" },
    });
    await expect(
      owner.confirm({
        ...scope,
        organizationId: review.organizationId,
        expectedFingerprint: review.fingerprint,
        confirmed: true,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const next = await owner.review(scope);
    await prisma.testCase.create({
      data: {
        projectId,
        title: "New member of complete scope",
        testType: "FUNCTIONAL",
        tags: [tag],
      },
    });
    await expect(
      owner.confirm({
        ...scope,
        organizationId: next.organizationId,
        expectedFingerprint: next.fingerprint,
        confirmed: true,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const custom = {
      ...scope,
      query: {
        ...scope.query,
        customColumns: [{ key: "label", type: "TEXT" as const, options: [] }],
      },
      columns: ["custom:label"],
    };
    const before = await owner.review(custom);
    await prisma.project.update({
      where: { id: projectId },
      data: {
        caseFieldSchema: {
          version: 1,
          fields: fields.map((field) =>
            field.key === "label"
              ? { ...field, label: "Renamed label" }
              : field,
          ),
        },
      },
    });
    await expect(
      owner.confirm({
        ...custom,
        organizationId: before.organizationId,
        expectedFingerprint: before.fingerprint,
        confirmed: true,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const labeled = await owner.review(scope);
    await prisma.project.update({
      where: { id: projectId },
      data: { name: `${tag}-renamed` },
    });
    await expect(
      owner.confirm({
        ...scope,
        organizationId: labeled.organizationId,
        expectedFingerprint: labeled.fingerprint,
        confirmed: true,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("binds approval to actor and original organization with current membership and suspension checks", async () => {
    const scope = input(),
      review = await owner.review(scope);
    await expect(
      viewer.confirm({
        ...scope,
        organizationId: review.organizationId,
        expectedFingerprint: review.fingerprint,
        confirmed: true,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(outsider.review(scope)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await prisma.membership.delete({
      where: {
        organizationId_userId: { organizationId: orgs[0]!, userId: users[2]! },
      },
    });
    await expect(viewer.review(scope)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await prisma.organization.update({
      where: { id: orgs[0]! },
      data: { suspendedAt: new Date() },
    });
    await expect(owner.review(scope)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await prisma.organization.update({
      where: { id: orgs[0]! },
      data: { suspendedAt: null },
    });
  });
  it("refuses a changed original project organization without reading a foreign replacement", async () => {
    const scope = input(),
      review = await owner.review(scope);
    await prisma.project.update({
      where: { id: projectId },
      data: { organizationId: orgs[1]! },
    });
    await expect(
      owner.confirm({
        ...scope,
        organizationId: review.organizationId,
        expectedFingerprint: review.fingerprint,
        confirmed: true,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    // Model reparent exactly between preliminary access and locked scope. The
    // read callback must never execute against a newly authorized tenant.
    let readForeign = false;
    await expect(
      withCaseQueryExportAccess(
        prisma,
        actorId,
        projectId,
        orgs[0]!,
        async (tx) => {
          readForeign = true;
          return reviewCaseQueryExport(tx, scope, actorId, orgs[0]!, env);
        },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(readForeign).toBe(false);
    await prisma.project.update({
      where: { id: projectId },
      data: { organizationId: orgs[0]! },
    });
  });
  it("supports the exact1000 complete-row boundary without clipped pagination success", async () => {
    const limitTag = `${tag}-exact-limit`;
    await prisma.testCase.createMany({
      data: Array.from({ length: 1000 }, (_, index) => ({
        projectId,
        testType: "FUNCTIONAL" as const,
        title: `Limit ${index}`,
        tags: [limitTag],
      })),
    });
    const base = input({
      ...defaultCaseQuery(),
      groups: [
        {
          match: "all",
          rules: [{ field: "tag", operator: "equals", value: limitTag }],
        },
      ],
    });
    const { review, result } = await approve({
      ...base,
      columns: ["priority"],
    });
    expect(review.total).toBe(1000);
    expect(result.total).toBe(1000);
    const identities = await prisma.testCase.findMany({
      where: { projectId, tags: { has: limitTag } },
      orderBy: { caseNumber: "asc" },
      select: { displayId: true },
    });
    expect(result.csv).toContain(`"${identities[0]!.displayId}"`);
    expect(result.csv).toContain(`"${identities.at(-1)!.displayId}"`);
    expect(result.csv.match(/^"Case",/gm)).toHaveLength(1000);
  });
  it("refuses more than1000 and proves empty scope is explicit summary not partial success", async () => {
    const manyTag = `${tag}-oversize`;
    await prisma.testCase.createMany({
      data: Array.from({ length: 1001 }, (_, index) => ({
        projectId,
        testType: "FUNCTIONAL" as const,
        title: `Bound ${index}`,
        tags: [manyTag],
      })),
    });
    await expect(
      owner.review(
        input({
          ...defaultCaseQuery(),
          groups: [
            {
              match: "all",
              rules: [{ field: "tag", operator: "equals", value: manyTag }],
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const { review, result } = await approve(
      input({
        ...defaultCaseQuery(),
        groups: [
          {
            match: "all",
            rules: [{ field: "tag", operator: "equals", value: `${tag}-none` }],
          },
        ],
      }),
    );
    expect(review.total).toBe(0);
    expect(result.csv).toContain('"Summary"');
    expect(result.csv).toContain('"Not a case"');
  });
  it("refuses selected clipped labels but allows complete explicitly smaller metadata projections", async () => {
    const longTag = `${tag}-long`;
    await prisma.testCase.create({
      data: {
        projectId,
        title: "x".repeat(1001),
        testType: "FUNCTIONAL",
        suitePath: "s".repeat(241),
        tags: [longTag],
      },
    });
    const base = input({
      ...defaultCaseQuery(),
      groups: [
        {
          match: "all",
          rules: [{ field: "tag", operator: "equals", value: longTag }],
        },
      ],
    });
    await expect(owner.review(base)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    await expect(
      owner.review({ ...base, columns: ["suite"] }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect((await owner.review({ ...base, columns: ["priority"] })).total).toBe(
      1,
    );
  });
  it("refuses unsafe controls and whole-file byte overflow during review before approval", async () => {
    const byteTag = `${tag}-bytes`;
    await prisma.testCase.createMany({
      data: Array.from({ length: 501 }, (_, index) => ({
        projectId,
        testType: "FUNCTIONAL" as const,
        title: `Bytes ${index}`,
        tags: [byteTag],
        customFields: { label: "x".repeat(2000) },
      })),
    });
    const base = input({
      ...defaultCaseQuery(),
      groups: [
        {
          match: "all",
          rules: [{ field: "tag", operator: "equals", value: byteTag }],
        },
      ],
      customColumns: [{ key: "label", type: "TEXT", options: [] }],
    });
    await expect(
      owner.review({ ...base, columns: ["custom:label"] }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const controlTag = `${tag}-control`;
    await prisma.testCase.create({
      data: {
        projectId,
        title: "Unsupported\u0001control",
        testType: "FUNCTIONAL",
        tags: [controlTag],
      },
    });
    await expect(
      owner.review(
        input({
          ...defaultCaseQuery(),
          groups: [
            {
              match: "all",
              rules: [{ field: "tag", operator: "equals", value: controlTag }],
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});
