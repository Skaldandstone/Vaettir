import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@vaettir/db";

describe("transaction acknowledgement requires actual deferred-constraint acceptance", () => {
  const suffix = randomUUID().replaceAll("-", "");
  const table = `synthetic_commit_ack_${suffix}`;
  const fn = `synthetic_commit_guard_${suffix}`;
  let created = false;
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
    if (
      !["postgresql:", "postgres:"].includes(url.protocol) ||
      !["localhost", "127.0.0.1"].includes(url.hostname) ||
      !/^\/vaettir_(?:day|away_full)_test_[0-9]{13}$/.test(url.pathname) ||
      url.searchParams.has("host")
    ) {
      throw Error("Exact disposable synthetic loopback database required");
    }
    // Both identifiers contain only fixed prefixes and a generated hex UUID.
    await prisma.$executeRawUnsafe(
      `CREATE TABLE "${table}" (value integer PRIMARY KEY)`,
    );
    created = true;
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION "${fn}"() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN IF NEW.value < 0 THEN RAISE EXCEPTION 'Synthetic deferred acknowledgement refusal' USING ERRCODE='23514'; END IF; RETURN NULL; END; $$`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE CONSTRAINT TRIGGER synthetic_ack_guard AFTER INSERT ON "${table}" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "${fn}"()`,
    );
  });
  afterAll(async () => {
    if (!created) return;
    await prisma.$executeRawUnsafe(`DROP TABLE "${table}"`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${fn}"()`);
  });
  const count = async () =>
    (
      await prisma.$queryRawUnsafe<Array<{ count: number }>>(
        `SELECT count(*)::int AS count FROM "${table}"`,
      )
    )[0].count;
  it("rejects interactive final-state failure and retains no rolled-back write", async () => {
    await expect(
      prisma.$transaction((tx) =>
        tx.$executeRawUnsafe(`INSERT INTO "${table}" VALUES (-1)`),
      ),
    ).rejects.toThrow("Synthetic deferred acknowledgement refusal");
    expect(await count()).toBe(0);
  });
  it("rejects batch final-state failure without returning false successful results", async () => {
    await expect(
      prisma.$transaction([
        prisma.$executeRawUnsafe(`INSERT INTO "${table}" VALUES (1)`),
        prisma.$executeRawUnsafe(`INSERT INTO "${table}" VALUES (-2)`),
      ]),
    ).rejects.toThrow("Synthetic deferred acknowledgement refusal");
    expect(await count()).toBe(0);
  });
  it("preserves batch values and interactive return values for accepted transactions", async () => {
    expect(
      await prisma.$transaction([
        prisma.$executeRawUnsafe(`INSERT INTO "${table}" VALUES (2)`),
        prisma.$executeRawUnsafe(`INSERT INTO "${table}" VALUES (3)`),
      ]),
    ).toEqual([1, 1]);
    expect(
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`INSERT INTO "${table}" VALUES (4)`);
        return { acknowledged: true };
      }),
    ).toEqual({ acknowledged: true });
    expect(await count()).toBe(3);
  });
  it("still rolls back an ordinary callback exception without acknowledging it", async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`INSERT INTO "${table}" VALUES (5)`);
        throw Error("Synthetic callback refusal");
      }),
    ).rejects.toThrow("Synthetic callback refusal");
    expect(await count()).toBe(3);
  });
  it("uses transaction-local UTC for both raw-query paths without changing batch values", async () => {
    const interactive = await prisma.$transaction(
      (tx) =>
        tx.$queryRaw<
          Array<{ timezone: string }>
        >`SELECT current_setting('TimeZone') AS timezone`,
    );
    expect(interactive).toEqual([{ timezone: "UTC" }]);
    const batch = await prisma.$transaction([
      prisma.$queryRaw<
        Array<{ timezone: string }>
      >`SELECT current_setting('TimeZone') AS timezone`,
      prisma.$queryRaw<Array<{ value: number }>>`SELECT 42::int AS value`,
    ]);
    expect(batch).toEqual([[{ timezone: "UTC" }], [{ value: 42 }]]);
  });
});
