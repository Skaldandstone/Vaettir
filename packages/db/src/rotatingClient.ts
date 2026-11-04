type Pool = { $connect(): Promise<void>; $disconnect(): Promise<void> };
type Generation<T> = {
  client: T; users: number; retired: boolean; closing: boolean;
  drained: Promise<void>; finish: () => void; fail: (error: Error) => void;
};
type Query<T> = {
  materialize: (client: T) => unknown;
  result?: Promise<unknown>;
};

function invoke(receiver: object, key: PropertyKey, args: unknown[]) {
  const method: unknown = Reflect.get(receiver, key);
  if (typeof method !== "function") throw new Error("Unsupported database operation");
  return Reflect.apply(method, receiver, args) as unknown;
}

function generation<T>(client: T): Generation<T> {
  let finish!: () => void;
  let fail!: (error: Error) => void;
  const drained = new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; });
  void drained.catch(() => undefined);
  return { client, users: 0, retired: false, closing: false, drained, finish, fail };
}

/** A stable facade for the managed-secret API's shared client.
 * Lazy queries select a pool when consumed. Transactions select exactly one
 * pool and keep it until settlement. Nothing replays failed application work.
 * Only model queries, raw SQL, connect/disconnect and transactions are exposed;
 * mutable client middleware/extensions must not bypass generation ownership.
 */
export function createRotatingClient<T extends Pool>(options: {
  initial: T;
  initialUrl: string;
  modelNames: readonly string[];
  create: (url: string) => T;
  probe: (client: T) => Promise<unknown>;
  probeTimeoutMs?: number;
}) {
  let active = generation(options.initial);
  let activeUrl = options.initialUrl;
  let refreshing = false;
  let closed = false;
  let cleanupFailed = false;
  let preparationSettled = Promise.resolve();
  const retired = new Set<Generation<T>>();
  const queries = new WeakMap<object, Query<T>>();
  const delegates = new Map<string, object>();
  const models = new Set(options.modelNames);
  const rawMethods = new Set(["$queryRaw", "$queryRawUnsafe", "$executeRaw", "$executeRawUnsafe"]);
  const timeoutMs = options.probeTimeoutMs ?? 20_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("Invalid database probe timeout");

  function drain(generation: Generation<T>) {
    if (!generation.retired || generation.users || generation.closing) return;
    generation.closing = true;
    void Promise.resolve().then(() => generation.client.$disconnect()).then(
      () => { retired.delete(generation); generation.finish(); },
      () => { cleanupFailed = true; generation.fail(new Error("Database pool cleanup failed")); },
    );
  }

  function run(work: (client: T) => unknown): Promise<unknown> {
    if (closed) return Promise.reject(new Error("Database client is closed"));
    const generation = active;
    generation.users++;
    // Run synchronously up to the first promise so adoption cannot interleave
    // between selecting a generation and constructing its native operation.
    let result: unknown;
    try { result = work(generation.client); }
    catch (error) { result = Promise.reject(error); }
    return Promise.resolve(result).finally(() => {
      generation.users--;
      drain(generation);
    });
  }

  function lazy(materialize: (client: T) => unknown): object {
    const query: Query<T> = { materialize };
    const consume = () => query.result ??= run(materialize);
    const promise = new Proxy({}, {
      get(_target, key) {
        if (key === Symbol.toStringTag) return "PrismaPromise";
        if (key === "then") return (yes: Parameters<Promise<unknown>["then"]>[0], no: Parameters<Promise<unknown>["then"]>[1]) => consume().then(yes, no);
        if (key === "catch") return (no: Parameters<Promise<unknown>["catch"]>[0]) => consume().catch(no);
        if (key === "finally") return (done: Parameters<Promise<unknown>["finally"]>[0]) => consume().finally(done);
        // Prisma's fluent relation queries remain lazy and use the same pool
        // for the complete chain. Batch transactions unwrap these internally.
        if (typeof key === "string" && key !== "requestTransaction") {
          return (...args: unknown[]) => lazy(client => invoke(materialize(client) as object, key, args));
        }
      },
    });
    queries.set(promise, query);
    return promise;
  }

  function transaction(work: unknown, transactionOptions: unknown) {
    if (!Array.isArray(work)) {
      if (typeof work !== "function") return Promise.reject(new Error("Invalid database transaction"));
      return run(client => invoke(client, "$transaction", [work, transactionOptions]));
    }
    // Native PrismaPromises are created together on one generation. Never
    // convert them to ordinary promises before the native batch transaction.
    const entries = work.map(value => value && typeof value === "object" ? queries.get(value) : undefined);
    if (entries.some(entry => !entry || entry.result) || new Set(entries).size !== entries.length) {
      return Promise.reject(new Error("Batch requires distinct, unconsumed queries from this client"));
    }
    const owned = entries as Query<T>[];
    const result = run(client => invoke(client, "$transaction", [owned.map(entry => entry.materialize(client)), transactionOptions]));
    owned.forEach((entry, index) => {
      entry.result = result.then(values => (values as unknown[])[index]);
      // A rejected batch need not have each individual query awaited as well.
      void entry.result.catch(() => undefined);
    });
    return result;
  }

  const client = new Proxy({} as T, {
    get(_target, key) {
      if (key === "then") return undefined;
      if (key === "$transaction") return transaction;
      if (key === "$connect") return () => run(pool => pool.$connect());
      if (key === "$disconnect") return () => {
        closed = true;
        active.retired = true;
        retired.add(active);
        drain(active);
        // Disposal is drain-only: it never interrupts existing transactions.
        return Promise.all([preparationSettled, ...[...retired].map(pool => pool.drained)]).then(() => {
          if (cleanupFailed) throw new Error("Database pool cleanup failed");
        });
      };
      if (typeof key === "string" && rawMethods.has(key)) {
        return (...args: unknown[]) => lazy(pool => invoke(pool, key, args));
      }
      if (typeof key === "string" && models.has(key)) {
        if (!delegates.has(key)) delegates.set(key, new Proxy({}, {
          get(_delegate, method) {
            if (method === "then" || typeof method !== "string") return undefined;
            return (...args: unknown[]) => lazy(pool => invoke(Reflect.get(pool, key) as object, method, args));
          },
        }));
        return delegates.get(key);
      }
      if (typeof key === "string" && key.startsWith("$")) {
        return () => { throw new Error("Client extensions and middleware are not supported by the rotating client"); };
      }
    },
  });

  return {
    client,
    status: () => ({ refreshing, draining: retired.size, cleanupFailed }),
    async refresh(url: string) {
      if (closed) throw new Error("Database client is closed");
      if (url === activeUrl) return;
      // Bound pool retention if an operation or a native disconnect stalls.
      if (refreshing || retired.size >= 2 || cleanupFailed) throw new Error("Database refresh is busy or awaiting cleanup");
      if (!url) throw new Error("Database credentials unavailable");
      refreshing = true;
      let candidate: T;
      try { candidate = options.create(url); }
      catch { refreshing = false; throw new Error("Database replacement could not be created"); }
      let finishPreparation!: () => void;
      preparationSettled = new Promise<void>(resolve => { finishPreparation = resolve; });
      const probe = Promise.resolve().then(() => options.probe(candidate));
      let timer: ReturnType<typeof setTimeout> | undefined;
      let adopted = false;
      try {
        await Promise.race([
          probe,
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error("Database replacement probe timed out")), timeoutMs);
          }),
        ]);
        if (closed) throw new Error("Database client is closed");
        const previous = active;
        active = generation(candidate);
        activeUrl = url;
        adopted = true;
        previous.retired = true;
        retired.add(previous);
        drain(previous);
      } catch {
        // Neither credentials nor driver exceptions may escape this control path.
        throw new Error("Database replacement was not ready; current pool retained");
      } finally {
        clearTimeout(timer);
        if (adopted) { refreshing = false; finishPreparation(); }
        else {
          // A timed-out probe may still be running in the native engine. Keep
          // the single-flight guard until it settles, then dispose it. A late
          // success cannot publish, and later checks cannot accumulate pools.
          void probe.catch(() => undefined).then(() => candidate.$disconnect()).catch(() => {
            cleanupFailed = true;
          }).finally(() => { refreshing = false; finishPreparation(); });
        }
      }
    },
  };
}
