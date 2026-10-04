// Synthetic integration coverage; requires an owned migrated loopback test DB.
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { Prisma, prisma } from "@vaettir/db";
import { createCaseQueriesRouter } from "./routers/caseQueries.js";
import {
  caseQuerySchema,
  defaultCaseQuery,
} from "./services/caseQuerySchema.js";
import {
  customQueryWhereSql,
  customProjectionSql,
} from "./services/caseCustomQuery.js";
import { hardDeleteOrganization } from "./services/orgHardDelete.js";
import type { CaseCustomBinding } from "./services/caseCustomQuerySchema.js";
describe("native project-field query predicates and saved layouts", () => {
  const tag = `custom-query-${randomUUID()}`,
    orgs: string[] = [],
    users: string[] = [];
  const router = createCaseQueriesRouter({
    PRODUCTION_SIGNAL_ENCRYPTION_KEY: Buffer.alloc(32, 15).toString("base64"),
  });
  type Caller = ReturnType<typeof router.createCaller>;
  let owner: Caller,
    outsider: Caller,
    viewer: Caller,
    projectId: string,
    foreignProject: string,
    actorId: string;
  const bindings: CaseCustomBinding[] = [
    { key: "label", type: "TEXT", options: [] },
    { key: "number", type: "NUMBER", options: [] },
    { key: "enabled", type: "BOOLEAN", options: [] },
    { key: "day", type: "DATE", options: [] },
    { key: "choice", type: "CHOICE", options: ["One", "Two"] },
    { key: "private_note", type: "TEXT", options: [] },
  ];
  const definitions = bindings.map((binding) => ({
    ...binding,
    label: binding.key,
    required: false,
    retired: false,
  }));
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
    if (
      !["localhost", "127.0.0.1"].includes(url.hostname) ||
      !/test/i.test(url.pathname) ||
      url.searchParams.has("host")
    )
      throw Error("Owned disposable loopback DB required");
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
      const project = await prisma.project.create({
        data: {
          organizationId: org.id,
          name: tag,
          slug: tag,
          caseKey: `q${index}${randomUUID().replaceAll("-", "").slice(0, 12)}`,
          caseFieldSchema: { version: 1, fields: definitions },
        },
      });
      if (index === 0) {
        owner = router.createCaller({ prisma, user });
        projectId = project.id;
        actorId = user.id;
      } else {
        outsider = router.createCaller({ prisma, user });
        foreignProject = project.id;
      }
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
    for (const [title, customFields] of [
      ["Absent", {}],
      ["Null", { label: null, number: null, enabled: null }],
      ["Empty", { label: "", number: 0, enabled: false }],
      [
        "Literal",
        {
          label: "100%_\\",
          number: 2,
          enabled: true,
          day: "2024-02-29",
          choice: "One",
          private_note: "not projected",
        },
      ],
    ] as const)
      await prisma.testCase.create({
        data: {
          projectId,
          title,
          testType: "FUNCTIONAL",
          customFields: customFields as Prisma.InputJsonValue,
        },
      });
  });
  afterAll(async () => {
    if (!orgs.length) return;
    for (const id of orgs) {
      const org = await prisma.organization.findUniqueOrThrow({
        where: { id },
      });
      if (!org.slug.startsWith(tag)) throw Error("Fixture ownership mismatch");
      const receipt = await hardDeleteOrganization(
        prisma,
        id,
        actorId,
        "Owned custom-query fixtures",
      );
      // Only this synthetic erasure's receipt; production receipts remain intact.
      const removed = await prisma.organizationDeletionLog.deleteMany({
        where: {
          id: receipt.deletionLogId,
          organizationId: id,
          organizationSlug: org.slug,
          deletedById: actorId,
        },
      });
      expect(removed.count).toBe(1);
    }
    await prisma.user.deleteMany({ where: { id: { in: users } } });
  });
  const query = (
    binding: CaseCustomBinding,
    operator: string,
    value?: unknown,
  ) =>
    caseQuerySchema.parse({
      ...defaultCaseQuery(),
      groups: [
        {
          match: "all",
          rules: [
            {
              ...binding,
              field: "custom",
              operator,
              ...(value !== undefined ? { value } : {}),
            },
          ],
        },
      ],
    });
  const page = (value = defaultCaseQuery(), cursor?: string) =>
    owner.page({ projectId, query: value, cursor, requestId: randomUUID() });
  it("distinguishes missing, explicit null, empty text, zero and false", async () => {
    expect(
      (await page(query(bindings[0]!, "missing"))).items.map(
        (item) => item.title,
      ),
    ).toEqual(["Absent"]);
    expect(
      (await page(query(bindings[0]!, "null"))).items.map((item) => item.title),
    ).toEqual(["Null"]);
    expect(
      (await page(query(bindings[0]!, "empty"))).items.map(
        (item) => item.title,
      ),
    ).toEqual(["Empty"]);
    expect(
      (await page(query(bindings[1]!, "equals", 0))).items.map(
        (item) => item.title,
      ),
    ).toEqual(["Empty"]);
    expect(
      (await page(query(bindings[2]!, "equals", false))).items.map(
        (item) => item.title,
      ),
    ).toEqual(["Empty"]);
    const result = await page({
      ...defaultCaseQuery(),
      customColumns: bindings.slice(0, 3),
    });
    expect(
      result.items.find((item) => item.title === "Absent")!.customValues.label,
    ).toEqual({ state: "ABSENT" });
    expect(
      result.items.find((item) => item.title === "Null")!.customValues.label,
    ).toEqual({ state: "NULL" });
    expect(
      result.items.find((item) => item.title === "Empty")!.customValues,
    ).toEqual({
      label: { state: "VALUE", value: "" },
      number: { state: "VALUE", value: 0 },
      enabled: { state: "VALUE", value: false },
    });
  });
  it("supports bounded literal text numeric date and mixed AND/OR conditions", async () => {
    expect(
      (await page(query(bindings[0]!, "contains", "%_\\"))).items.map(
        (item) => item.title,
      ),
    ).toEqual(["Literal"]);
    expect(
      (await page(query(bindings[0]!, "contains", "x') OR true --"))).total,
    ).toBe(0);
    expect(
      (await page(query(bindings[1]!, "atLeast", 1))).items.map(
        (item) => item.title,
      ),
    ).toEqual(["Literal"]);
    expect(
      (await page(query(bindings[3]!, "before", "2024-03-01"))).items.map(
        (item) => item.title,
      ),
    ).toEqual(["Literal"]);
    const mixed = caseQuerySchema.parse({
      ...defaultCaseQuery(),
      match: "any",
      groups: [
        {
          match: "all",
          rules: [
            { ...bindings[1], field: "custom", operator: "equals", value: 0 },
            { field: "title", operator: "equals", value: "Empty" },
          ],
        },
        {
          match: "all",
          rules: [
            {
              ...bindings[4],
              field: "custom",
              operator: "equals",
              value: "One",
            },
          ],
        },
      ],
    });
    expect((await page(mixed)).items.map((item) => item.title)).toEqual([
      "Empty",
      "Literal",
    ]);
  });
  it("projects only requested current fields and preserves tenant viewer read gates", async () => {
    const input = {
      projectId,
      query: { ...defaultCaseQuery(), customColumns: [bindings[0]!] },
      requestId: randomUUID(),
    };
    const result = await viewer.page(input);
    expect(result.projectId).toBe(projectId);
    expect(result.organizationId).toBe(orgs[0]);
    expect(Object.keys(result.items[3]!.customValues)).toEqual(["label"]);
    expect(JSON.stringify(result)).not.toContain("not projected");
    expect(result.items.every((item) => item.displayId)).toBe(true);
    await expect(outsider.page(input)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      owner.page({ ...input, projectId: foreignProject }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("retains saved stale definitions for repair and exact receipts but denies new incompatible executions or saves", async () => {
    await expect(
      page(query({ ...bindings[0]!, key: "unknown_key" }, "missing")),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(
      page(query({ ...bindings[0]!, type: "NUMBER" }, "atLeast", 0)),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const request = {
      operation: "CREATE" as const,
      projectId,
      requestId: randomUUID(),
      definition: {
        name: "Typed saved query",
        visibility: "SHARED" as const,
        query: {
          ...query(bindings[0]!, "contains", "Literal"),
          customColumns: [bindings[0]!],
        },
        columns: ["custom:label"],
      },
    };
    const receipt = await owner.savedWrite(request);
    await prisma.project.update({
      where: { id: projectId },
      data: {
        caseFieldSchema: {
          version: 1,
          fields: definitions.map((field) =>
            field.key === "label" ? { ...field, retired: true } : field,
          ),
        },
      },
    });
    try {
      expect(
        (await viewer.savedById({ projectId, id: receipt.value.id })).value
          .query,
      ).toEqual(request.definition.query);
      await expect(page(request.definition.query)).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
      await expect(
        owner.savedWrite({ ...request, requestId: randomUUID() }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      await expect(owner.savedWrite(request)).resolves.toEqual(receipt);
    } finally {
      await prisma.project.update({
        where: { id: projectId },
        data: { caseFieldSchema: { version: 1, fields: definitions } },
      });
    }
  });
  it("keeps typed custom-rule pages project actor and definition bound without duplicate rows", async () => {
    for (let index = 0; index < 57; index++)
      await prisma.testCase.create({
        data: {
          projectId,
          title: `Paged ${index}`,
          testType: "FUNCTIONAL",
          customFields: { number: 10 },
        },
      });
    const value = query(bindings[1]!, "atLeast", 10),
      first = await page(value),
      second = await page(value, first.nextCursor!);
    expect(first.total).toBe(57);
    expect(first.items).toHaveLength(50);
    expect(second.items).toHaveLength(7);
    expect(
      new Set([...first.items, ...second.items].map((item) => item.id)).size,
    ).toBe(57);
    await expect(
      viewer.page({
        projectId,
        query: value,
        cursor: first.nextCursor!,
        requestId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      page({ ...value, customColumns: [bindings[1]!] }, first.nextCursor!),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("guards malformed legacy JSON before casts and reports invalid columns instead of coercion", async () => {
    for (const customFields of [
      { number: "not numeric", day: "2024-02-31" },
      { number: { nested: true }, day: "0000-01-01" },
      { number: [], day: "2024-xx-01" },
      ["number"],
      null,
    ]) {
      const where = customQueryWhereSql(
        "synthetic",
        query(bindings[1]!, "atLeast", 0),
        new Date(),
      );
      const rows = await prisma.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`WITH "TestCase" AS (SELECT 'synthetic'::text AS "projectId",'legacy'::text AS id,TIMESTAMP '2020-01-01' AS "updatedAt",false AS archived,${JSON.stringify(customFields)}::jsonb AS "customFields") SELECT id FROM "TestCase" WHERE ${where}`,
      );
      expect(rows).toHaveLength(0);
      const projection = await prisma.$queryRaw<Array<{ values: unknown }>>(
        Prisma.sql`WITH "TestCase" AS (SELECT ${JSON.stringify(customFields)}::jsonb AS "customFields") SELECT ${customProjectionSql([bindings[1]!, bindings[3]!])} AS values FROM "TestCase"`,
      );
      expect(projection[0]!.values).toEqual({
        number: { state: "INVALID" },
        day: { state: "INVALID" },
      });
    }
    const valid = { number: 0, day: "2024-02-29" },
      where = customQueryWhereSql(
        "synthetic",
        query(bindings[1]!, "atLeast", 0),
        new Date(),
      );
    const control = await prisma.$queryRaw<
      Array<{ id: string; values: unknown }>
    >(
      Prisma.sql`WITH "TestCase" AS (SELECT 'synthetic'::text AS "projectId",'valid'::text AS id,TIMESTAMP '2020-01-01' AS "updatedAt",false AS archived,${JSON.stringify(valid)}::jsonb AS "customFields") SELECT id,${customProjectionSql([bindings[1]!, bindings[3]!])} AS values FROM "TestCase" WHERE ${where}`,
    );
    expect(control).toEqual([
      {
        id: "valid",
        values: {
          number: { state: "VALUE", value: 0 },
          day: { state: "VALUE", value: "2024-02-29" },
        },
      },
    ]);
  });
});
