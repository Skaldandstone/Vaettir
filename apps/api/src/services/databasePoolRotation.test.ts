import { afterEach, describe, expect, it, vi } from "vitest";
import { createRotatingClient } from "../../../../packages/db/src/rotatingClient.js";
import { createDatabaseCredentialMonitor, databaseCredentialLiveness } from "./databaseCredentialMonitor.js";
import { ConstraintCheckedPrismaClient } from "../../../../packages/db/src/constraintCheckedClient.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}

function fakePool(name: string) {
  const events: string[] = [];
  const gate = deferred<void>();
  const operation = (kind: string) => {
    let result: Promise<string> | undefined;
    const consume = () => result ??= (async () => {
      events.push(kind);
      if (kind === "slow") await gate.promise;
      if (kind === "fail") throw new Error("ambiguous-write-failure");
      return `${name}:${kind}`;
    })();
    return {
      [Symbol.toStringTag]: "PrismaPromise",
      then: (yes: (value: string) => unknown, no?: (error: unknown) => unknown) => consume().then(yes, no),
      children: () => operation("relation"),
    };
  };
  return {
    events, gate,
    widget: { findMany: () => operation("read"), create: (kind = "write") => operation(kind), findUnique: () => operation("parent") },
    $queryRaw: (..._args: unknown[]) => operation("raw"),
    $executeRaw: (..._args: unknown[]) => operation("execute"),
    $connect: vi.fn(async () => { events.push("connect"); }),
    $disconnect: vi.fn(async () => { events.push("disconnect"); }),
    $transaction: vi.fn(async (work: unknown, options?: unknown) => {
      events.push(`transaction:${JSON.stringify(options)}`);
      const tx = { name, write: () => operation("tx-write") };
      if (typeof work === "function") return work(tx) as unknown;
      expect(Array.isArray(work)).toBe(true);
      for (const query of work as object[]) expect(Reflect.get(query, Symbol.toStringTag)).toBe("PrismaPromise");
      return Promise.all(work as PromiseLike<string>[]);
    }),
  };
}

function fixture(probe?: (pool: ReturnType<typeof fakePool>) => Promise<unknown>) {
  const old = fakePool("old");
  const created: ReturnType<typeof fakePool>[] = [];
  const create = vi.fn((url: string) => { const pool = fakePool(url); created.push(pool); return pool; });
  const manager = createRotatingClient({ initial: old, initialUrl: "old", modelNames: ["widget"], create, probe: probe ?? (async pool => { await pool.$connect(); await pool.$queryRaw(); }), probeTimeoutMs: 50 });
  return { manager, old, created, create, client: manager.client };
}

afterEach(() => vi.useRealTimers());

describe("database pool continuity", () => {
  it("serves while probing, publishes only ready pools, and drains in-flight work without replay", async () => {
    const ready = deferred<void>();
    const f = fixture(async pool => { await pool.$connect(); await ready.promise; await pool.$queryRaw(); });
    const savedMethod = f.client.widget.findMany;
    const lazyBeforeRotation = f.client.widget.create();
    const oldWork = Promise.resolve(f.client.widget.create("slow"));
    await Promise.resolve();
    const monitor = createDatabaseCredentialMonitor({ initialUrl: "old", resolveUrl: async () => "new", refresh: f.manager.refresh, onRotation: vi.fn(), onCheckFailure: vi.fn() });
    const rotation = monitor.check();
    await Promise.resolve();
    expect(await savedMethod()).toBe("old:read");
    expect(databaseCredentialLiveness().statusCode).toBe(200);
    expect(f.old.$disconnect).not.toHaveBeenCalled();
    ready.resolve();
    await rotation;
    expect(await savedMethod()).toBe("new:read");
    expect(await lazyBeforeRotation).toBe("new:write");
    expect(f.old.events).not.toContain("write");
    expect(f.old.$disconnect).not.toHaveBeenCalled();
    expect(f.manager.status().draining).toBe(1);
    f.old.gate.resolve();
    expect(await oldWork).toBe("old:slow");
    await vi.waitFor(() => expect(f.old.$disconnect).toHaveBeenCalledTimes(1));
    expect(f.old.events.filter(event => event === "slow")).toHaveLength(1);
    expect(databaseCredentialLiveness().statusCode).toBe(200);
  });

  it("pins interactive transactions and their options across adoption", async () => {
    const f = fixture();
    const entered = deferred<void>();
    const release = deferred<void>();
    const options = { isolationLevel: "Serializable", timeout: 5000 };
    const transaction = f.client.$transaction(async (tx: { name: string; write: () => PromiseLike<string> }) => {
      expect(tx.name).toBe("old");
      await tx.write();
      entered.resolve();
      await release.promise;
      return tx.write();
    }, options);
    await entered.promise;
    await f.manager.refresh("new");
    expect(await f.client.widget.findMany()).toBe("new:read");
    expect(f.old.$disconnect).not.toHaveBeenCalled();
    release.resolve();
    expect(await transaction).toBe("old:tx-write");
    expect(f.old.$transaction.mock.calls[0]?.[1]).toBe(options);
    expect(f.old.events.filter(event => event === "tx-write")).toHaveLength(2);
    expect(f.created[0]!.events).not.toContain("tx-write");
  });

  it("materializes a batch together after rotation and retains raw tags, ordering and single consumption", async () => {
    const f = fixture();
    const first = f.client.widget.create();
    const raw = f.client.$queryRaw`SELECT ${123}`;
    await f.manager.refresh("new");
    const options = { isolationLevel: "Serializable" };
    expect(await f.client.$transaction([first, raw], options)).toEqual(["new:write", "new:raw"]);
    expect(f.created[0]!.$transaction.mock.calls[0]?.[1]).toBe(options);
    expect(await first).toBe("new:write");
    expect(f.created[0]!.events.filter(event => event === "write")).toHaveLength(1);
    await expect(f.client.$transaction([first])).rejects.toThrow("unconsumed");
    await expect(f.client.$transaction([f.old.widget.create()])).rejects.toThrow("unconsumed");
    const duplicate = f.client.widget.create();
    await expect(f.client.$transaction([duplicate, duplicate])).rejects.toThrow("distinct");
    expect(f.old.events).not.toContain("write");
  });

  it("preserves lazy relation traversal across rotation", async () => {
    const f = fixture();
    const relation = f.client.widget.findUnique().children();
    await f.manager.refresh("new");
    expect(await relation).toBe("new:relation");
    expect(f.old.events).not.toContain("parent");
    expect(f.created[0]!.events).not.toContain("parent");
  });

  it("never retries ambiguous writes, including repeated awaits of a failure", async () => {
    const f = fixture();
    const failed = f.client.widget.create("fail");
    await expect(Promise.resolve(failed)).rejects.toThrow("ambiguous-write-failure");
    await f.manager.refresh("new");
    await expect(Promise.resolve(failed)).rejects.toThrow("ambiguous-write-failure");
    expect(f.old.events.filter(event => event === "fail")).toHaveLength(1);
    expect(f.created[0]!.events).not.toContain("fail");
  });

  it("sanitizes failed preparation, cleans its pool, and later refreshes without replacing usable work early", async () => {
    let fail = true;
    const f = fixture(async pool => { await pool.$connect(); if (fail) throw new Error("postgresql://private:password@host/db"); });
    await expect(f.manager.refresh("new")).rejects.toThrow("current pool retained");
    expect(await f.client.widget.findMany()).toBe("old:read");
    await vi.waitFor(() => expect(f.manager.status().refreshing).toBe(false));
    expect(f.created[0]!.$disconnect).toHaveBeenCalledTimes(1);
    expect(f.old.$disconnect).not.toHaveBeenCalled();
    fail = false;
    await f.manager.refresh("new");
    expect(await f.client.widget.findMany()).toBe("new:read");
    await f.manager.refresh("third");
    expect(await f.client.widget.findMany()).toBe("third:read");
    await f.manager.refresh("third");
    expect(f.create).toHaveBeenCalledTimes(3);
  });

  it("times out a probe without late adoption or an accumulation of candidate pools", async () => {
    vi.useFakeTimers();
    const ready = deferred<void>();
    const f = fixture(() => ready.promise);
    const pending = expect(f.manager.refresh("new")).rejects.toThrow("current pool retained");
    await vi.advanceTimersByTimeAsync(51);
    await pending;
    expect(await f.client.widget.findMany()).toBe("old:read");
    await expect(f.manager.refresh("new")).rejects.toThrow("busy");
    expect(f.create).toHaveBeenCalledTimes(1);
    expect(f.created[0]!.$disconnect).not.toHaveBeenCalled();
    ready.resolve();
    await vi.runAllTimersAsync();
    expect(f.created[0]!.$disconnect).toHaveBeenCalledTimes(1);
    expect(f.manager.status().refreshing).toBe(false);
    expect(await f.client.widget.findMany()).toBe("old:read");
  });

  it("bounds retired generations while old work is still running", async () => {
    const f = fixture();
    const first = Promise.resolve(f.client.widget.create("slow"));
    await Promise.resolve();
    await f.manager.refresh("second");
    const second = Promise.resolve(f.client.widget.create("slow"));
    await Promise.resolve();
    await f.manager.refresh("third");
    await expect(f.manager.refresh("fourth")).rejects.toThrow("cleanup");
    expect(f.create).toHaveBeenCalledTimes(2);
    f.old.gate.resolve();
    f.created[0]!.gate.resolve();
    await Promise.all([first, second]);
    await vi.waitFor(() => expect(f.manager.status().draining).toBe(0));
    await f.manager.refresh("fourth");
    expect(await f.client.widget.findMany()).toBe("fourth:read");
  });

  it("reports cleanup failure and prevents additional pool accumulation", async () => {
    const f = fixture();
    f.old.$disconnect.mockRejectedValueOnce(new Error("private cleanup failure"));
    await f.manager.refresh("new");
    await vi.waitFor(() => expect(f.manager.status().cleanupFailed).toBe(true));
    expect(await f.client.widget.findMany()).toBe("new:read");
    await expect(f.manager.refresh("third")).rejects.toThrow("cleanup");
  });

  it("does not report successful disposal when an unadopted candidate failed cleanup", async () => {
    const f = fixture(async pool => {
      pool.$disconnect.mockRejectedValueOnce(new Error("private cleanup failure"));
      throw new Error("private probe failure");
    });
    await expect(f.manager.refresh("new")).rejects.toThrow("current pool retained");
    await vi.waitFor(() => expect(f.manager.status().refreshing).toBe(false));
    expect(f.manager.status().cleanupFailed).toBe(true);
    await expect(f.client.$disconnect()).rejects.toThrow("Database pool cleanup failed");
    expect(f.old.$disconnect).toHaveBeenCalledTimes(1);
  });

  it("does not publish after disposal and waits for in-flight work to drain", async () => {
    const ready = deferred<void>();
    const f = fixture(() => ready.promise);
    const work = Promise.resolve(f.client.widget.create("slow"));
    await Promise.resolve();
    const rotation = f.manager.refresh("new");
    const disposing = f.client.$disconnect();
    expect(f.old.$disconnect).not.toHaveBeenCalled();
    ready.resolve();
    await expect(rotation).rejects.toThrow("current pool retained");
    await expect(Promise.resolve(f.client.widget.findMany())).rejects.toThrow("closed");
    f.old.gate.resolve();
    await work;
    await disposing;
    expect(f.created[0]!.$disconnect).toHaveBeenCalledTimes(1);
    expect(f.old.$disconnect).toHaveBeenCalledTimes(1);
  });
});

describe("native Prisma lazy batch contract without a database", () => {
  it("retains constraint-check guards and lazy model/raw requests with Prisma 5.22 middleware", async () => {
    const requests: { action: string; model?: string; args: unknown }[] = [];
    const native = new ConstraintCheckedPrismaClient({ datasources: { db: { url: "postgresql://synthetic:synthetic@127.0.0.1:1/synthetic" } } });
    // Short-circuit every request before the engine: generated PrismaPromises
    // and the constraint-checking subclass are real; the database is not used.
    native.$use(async params => {
      requests.push({ action: params.action, model: params.model, args: params.args });
      return params.action === "findMany" ? [{ id: "synthetic" }] : 1;
    });
    const manager = createRotatingClient({ initial: native, initialUrl: "synthetic", modelNames: ["organization"], create: () => { throw new Error("not used"); }, probe: async () => undefined });
    const model = manager.client.organization.findMany({ take: 1 });
    const raw = manager.client.$queryRaw`SELECT ${42}`;
    expect(requests).toEqual([]);
    expect(await manager.client.$transaction([model, raw])).toEqual([[{ id: "synthetic" }], 1]);
    expect(requests.map(row => row.action)).toEqual(["executeRaw", "findMany", "queryRaw", "executeRaw"]);
    expect(JSON.stringify(requests[0]!.args)).toContain("SET LOCAL TIME ZONE");
    expect(JSON.stringify(requests[3]!.args)).toContain("SET CONSTRAINTS ALL IMMEDIATE");
    expect(JSON.stringify(requests[2]!.args)).toContain("42");
  });
});
