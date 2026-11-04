import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("../../../../packages/db/src/constraintCheckedClient.js");
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("shared managed database wiring", () => {
  it("pins each URL, probes before publishing and keeps saved consumers on the stable facade", async () => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DB_SECRET_ID", "synthetic-secret-id");
    vi.stubEnv("DATABASE_URL", "synthetic-old");
    const pools: { url: string; $connect: ReturnType<typeof vi.fn>; $disconnect: ReturnType<typeof vi.fn>; $queryRaw: ReturnType<typeof vi.fn>; organization: { count: () => Promise<string> } }[] = [];
    vi.doMock("../../../../packages/db/src/constraintCheckedClient.js", () => ({
      ConstraintCheckedPrismaClient: class {
        constructor(options: { datasources: { db: { url: string } } }) {
          const url = options.datasources.db.url;
          const pool = { url, $connect: vi.fn(async () => undefined), $disconnect: vi.fn(async () => undefined), $queryRaw: vi.fn(async () => 1), organization: { count: async () => url } };
          pools.push(pool);
          return pool;
        }
      },
    }));
    const db = await import("../../../../packages/db/src/index.js");
    const saved = db.prisma.organization;
    expect(await saved.count()).toBe("synthetic-old");
    expect(pools[0]!.url).toBe("synthetic-old");
    await db.refreshDatabaseCredentials("synthetic-new");
    expect(pools[1]!.url).toBe("synthetic-new");
    expect(pools[1]!.$connect).toHaveBeenCalledTimes(1);
    expect(pools[1]!.$queryRaw.mock.calls[0]?.[0]).toEqual(["SELECT 1"]);
    expect(await saved.count()).toBe("synthetic-new");
    expect(process.env.DATABASE_URL).toBe("synthetic-new");
    expect(db.databasePoolStatus().cleanupFailed).toBe(false);
    await db.prisma.$disconnect();
  });

  it("leaves ordinary clients native and refuses unconfigured refresh", async () => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DB_SECRET_ID", "");
    const native = { sentinel: true };
    const constructor = vi.fn();
    vi.doMock("../../../../packages/db/src/constraintCheckedClient.js", () => ({
      ConstraintCheckedPrismaClient: class {
        constructor(options: unknown) { constructor(options); return native; }
      },
    }));
    const db = await import("../../../../packages/db/src/index.js");
    expect(db.prisma).toBe(native);
    expect(constructor).toHaveBeenCalledWith(undefined);
    await expect(db.refreshDatabaseCredentials("synthetic-new")).rejects.toThrow("not configured");
  });
});
