import { expect, it } from "vitest";
import { PrismaClient, type Prisma } from "@vaettir/db";
import { preservedPrismaJson } from "./prismaJsonInput.js";

it("the installed Prisma compiler preserves own prototype-named JSON keys in SQL parameters", async () => {
  const value = JSON.parse('{"__proto__":{"retained":true},"nested":{"__proto__":{"retained":true}},"ordinary":1}');
  const parameters: unknown[] = [];
  const client = new PrismaClient({
    adapter: {
      adapterName: "synthetic-only",
      provider: "postgres",
      connect: async () => ({
        adapterName: "synthetic-only",
        provider: "postgres",
        queryRaw: async query => {
          const index = query.argTypes.findIndex(type => type.scalarType === "json");
          parameters.push(query.args[index]);
          throw new Error("Synthetic SQL interception");
        },
        executeRaw: async () => { throw new Error("Unexpected SQL execution"); },
        startTransaction: async () => { throw new Error("Unexpected transaction"); },
        dispose: async () => {},
      }),
    },
  });
  try {
    await expect(client.auditLog.create({ data: {
      id: "synthetic", organizationId: "synthetic", actorId: "synthetic",
      entityType: "TestPlan", entityId: "synthetic", action: "UPDATE", summary: "synthetic",
      metadata: preservedPrismaJson(value) as Prisma.InputJsonValue,
    } })).rejects.toThrow();
    expect(parameters).toEqual([JSON.stringify(value)]);
    expect(Object.hasOwn(JSON.parse(parameters[0] as string), "__proto__")).toBe(true);
  } finally {
    await client.$disconnect();
  }
});
