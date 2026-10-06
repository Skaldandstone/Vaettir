import { describe, it, expect, vi } from "vitest";
import { Prisma, type PrismaClient } from "@vaettir/db";
import { snapshotTestPlanVersion } from "./testPlanVersion.js";

function capture(last: number | null = 7) {
  const findFirst = vi.fn(async () =>
    last === null ? null : { versionNumber: last },
  );
  const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "synthetic-version",
    ...data,
  }));
  const db = {
    testPlanVersion: { findFirst, create },
  } as unknown as PrismaClient;
  return { db, findFirst, create };
}
const base = {
  testPlanId: "synthetic-plan",
  name: "  Exact plan title  ",
  description: "  Exact\nmultiline plan prose.  \n",
  status: "ACTIVE" as const,
  actorId: "synthetic-editor",
};

describe("plan version JSON retention (mock capture, not native JSON-null acceptance)", () => {
  it.each([
    {
      label: "nested object",
      value: {
        nullable: null,
        array: [0, false, null, { unknown: "Retained" }],
        text: "  Exact\ntext  ",
      },
    },
    {
      label: "array",
      value: [
        "Original, comma-bearing prose",
        "  spaces  ",
        "",
        null,
        false,
        0,
      ],
    },
    { label: "string scalar", value: "  Exact scalar\n" },
    { label: "numeric zero", value: 0 },
    { label: "boolean false", value: false },
    { label: "explicit JSON null", value: null },
  ])("preserves $label for both JSON fields", async ({ value }) => {
    const c = capture();
    const original = JSON.stringify(value);
    const saved = await snapshotTestPlanVersion(c.db, {
      ...base,
      customFields: value,
      executionTemplate: value,
    });
    const data = c.create.mock.calls[0]![0].data;
    const expected = value === null ? Prisma.JsonNull : value;
    expect(data.customFields).toBe(expected);
    expect(data.executionTemplate).toBe(expected);
    expect(data).toMatchObject({
      testPlanId: base.testPlanId,
      name: base.name,
      description: base.description,
      status: base.status,
      createdById: base.actorId,
      versionNumber: 8,
    });
    expect(saved.id).toBe("synthetic-version");
    expect(JSON.stringify(value)).toBe(original);
  });
  it("only omitted or undefined legacy execution templates receive the ordinary empty-object default", async () => {
    for (const args of [
      { ...base, customFields: {} },
      { ...base, customFields: {}, executionTemplate: undefined },
    ]) {
      const c = capture(null);
      await snapshotTestPlanVersion(c.db, args);
      const data = c.create.mock.calls[0]![0].data;
      expect(data.executionTemplate).toEqual({});
      expect(data.executionTemplate).not.toBe(Prisma.JsonNull);
      expect(data.versionNumber).toBe(1);
      expect(data.customFields).toBe(args.customFields);
    }
  });
  it("does not invent custom-field defaults or coerce description NULL and deliberately empty strings", async () => {
    for (const description of [null, ""]) {
      const c = capture();
      await snapshotTestPlanVersion(c.db, {
        ...base,
        description,
        customFields: undefined,
        executionTemplate: null,
      });
      const data = c.create.mock.calls[0]![0].data;
      expect(Object.hasOwn(data, "customFields")).toBe(true);
      expect(data.customFields).toBeUndefined();
      expect(data.description).toBe(description);
      expect(data.executionTemplate).toBe(Prisma.JsonNull);
    }
  });
  it("preserves the normal max-version lookup and explicit existing Prisma JSON-null sentinel", async () => {
    const c = capture(12);
    await snapshotTestPlanVersion(c.db, {
      ...base,
      customFields: Prisma.JsonNull,
      executionTemplate: Prisma.JsonNull,
    });
    expect(c.findFirst).toHaveBeenCalledWith({
      where: { testPlanId: base.testPlanId },
      orderBy: { versionNumber: "desc" },
      select: { versionNumber: true },
    });
    expect(c.create.mock.calls[0]![0].data).toMatchObject({
      versionNumber: 13,
      customFields: Prisma.JsonNull,
      executionTemplate: Prisma.JsonNull,
    });
  });
});
