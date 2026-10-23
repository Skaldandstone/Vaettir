import { describe, expect, it } from "vitest";
import { QueryObserver, hashKey } from "@tanstack/react-query";
import {
  AuthQueryClient,
  authQueryIdentity,
  belongsToAuthGeneration,
  cancelAuthGeneration,
  currentSessionScope,
  sameAuthScope,
} from "./auth-query-cache";

const scope = (name: string) => ({
  userId: `user-${name}`,
  sessionId: `session-${name}`,
});
const generation = (number: number, name: string) => ({
  number,
  scope: scope(name),
  identity: authQueryIdentity(scope(name)),
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
describe("stable authenticated query observer generations", () => {
  it("StrictMode-style repeated commit never cancels current reads, only a distinct prior commit", async () => {
    const q = new AuthQueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const old = generation(0, "a"),
      next = generation(1, "b"),
      wait = deferred<string>();
    let aborted = false;
    q.selectGeneration(old);
    await q.commitGeneration(old);
    const pending = q.fetchQuery({
      queryKey: ["current-strict-probe"],
      queryFn: ({ signal }) => {
        signal.addEventListener("abort", () => {
          aborted = true;
        });
        return wait.promise;
      },
    });
    const caught = pending.catch((error) => error);
    await q.commitGeneration(old);
    expect(aborted).toBe(false);
    q.selectGeneration(next);
    await q.commitGeneration(next);
    expect(aborted).toBe(true);
    wait.resolve("late-old");
    await caught;
    q.clear();
  });
  it("one installed observer stays in one client while A->B->A uses three fresh native hashes", async () => {
    const q = new AuthQueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const key = ["native", { projectId: "synthetic" }];
    q.selectGeneration(generation(0, "a"));
    const observer = new QueryObserver(q, {
      queryKey: key,
      enabled: false,
      queryFn: async () => "a-original-private",
    });
    const stop = observer.subscribe(() => undefined);
    await observer.refetch();
    expect(observer.getCurrentResult().data).toBe("a-original-private");
    const originalHash = observer.getCurrentQuery().queryHash;
    q.selectGeneration(generation(1, "b"));
    observer.setOptions({
      queryKey: key,
      enabled: false,
      queryFn: async () => "b-fresh-private",
    });
    expect(observer.getCurrentResult().data).toBeUndefined();
    await observer.refetch();
    const bHash = observer.getCurrentQuery().queryHash;
    expect(bHash).not.toBe(originalHash);
    expect(q.getQueryData(key)).toBe("b-fresh-private");
    q.selectGeneration(generation(2, "a"));
    observer.setOptions({
      queryKey: key,
      enabled: false,
      queryFn: async () => "a-fresh-private",
    });
    expect(observer.getCurrentResult().data).toBeUndefined();
    await observer.refetch();
    expect(observer.getCurrentQuery().queryHash).not.toBe(originalHash);
    expect(observer.getCurrentQuery().queryHash).not.toBe(bHash);
    expect(q.getQueryData(key)).toBe("a-fresh-private");
    stop();
    q.clear();
  });
  it("late original read remains in its original hash and cannot populate new actor data", async () => {
    const q = new AuthQueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const old = generation(0, "a"),
      next = generation(1, "b"),
      key = ["held-read"],
      wait = deferred<string>();
    q.selectGeneration(old);
    const original = q.fetchQuery({
      queryKey: key,
      queryFn: () => wait.promise,
    });
    q.selectGeneration(next);
    expect(q.getQueryData(key)).toBeUndefined();
    wait.resolve("original-a-result");
    expect(await original).toBe("original-a-result");
    expect(q.getQueryData(key)).toBeUndefined();
    expect(
      q
        .getQueryCache()
        .findAll()
        .find((x) => belongsToAuthGeneration(x.queryHash, old))?.state.data,
    ).toBe("original-a-result");
    q.clear();
  });
  it("prior committed generation cancellation never cancels new reads or pending mutations", async () => {
    const q = new AuthQueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const old = generation(0, "a"),
      next = generation(1, "b");
    const a = deferred<string>(),
      b = deferred<string>(),
      mutation = deferred<string>();
    let aAborted = false,
      bAborted = false;
    q.selectGeneration(old);
    const oldRead = q.fetchQuery({
      queryKey: ["a"],
      queryFn: ({ signal }) => {
        signal.addEventListener("abort", () => {
          aAborted = true;
        });
        return a.promise;
      },
    });
    const caughtOld = oldRead.catch((error) => error);
    const pending = q
      .getMutationCache()
      .build(q, { mutationFn: () => mutation.promise });
    const accepted = pending.execute(undefined);
    q.selectGeneration(next);
    const newRead = q.fetchQuery({
      queryKey: ["b"],
      queryFn: ({ signal }) => {
        signal.addEventListener("abort", () => {
          bAborted = true;
        });
        return b.promise;
      },
    });
    await cancelAuthGeneration(q, old);
    expect(aAborted).toBe(true);
    expect(bAborted).toBe(false);
    expect(pending.state.status).toBe("pending");
    b.resolve("b-current");
    mutation.resolve("original-ack");
    a.resolve("old-late");
    expect(await newRead).toBe("b-current");
    expect(await accepted).toBe("original-ack");
    await caughtOld;
    q.clear();
  });
  it("invalidate/refetch combines caller predicates and never refetches active stale-generation observers", async () => {
    const q = new AuthQueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    let oldCalls = 0,
      currentCalls = 0;
    q.selectGeneration(generation(0, "a"));
    const a = new QueryObserver(q, {
      queryKey: ["same"],
      queryFn: async () => ++oldCalls,
    });
    const stopA = a.subscribe(() => undefined);
    await a.refetch();
    q.selectGeneration(generation(1, "b"));
    const b = new QueryObserver(q, {
      queryKey: ["same"],
      queryFn: async () => ++currentCalls,
    });
    const stopB = b.subscribe(() => undefined);
    await b.refetch();
    const before = oldCalls;
    await q.invalidateQueries({ queryKey: ["same"], predicate: () => true });
    expect(oldCalls).toBe(before);
    expect(currentCalls).toBeGreaterThan(1);
    const currentBefore = currentCalls;
    await q.refetchQueries({ predicate: () => false, type: "all" });
    expect(currentCalls).toBe(currentBefore);
    expect(oldCalls).toBe(before);
    stopA();
    stopB();
    q.clear();
  });
  it("installed hashing preserves sorted object key semantics and existing defaults", () => {
    const q = new AuthQueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: 123 },
        mutations: { retry: false },
      },
    });
    const g = generation(12, "a");
    q.selectGeneration(g);
    const one = q.defaultQueryOptions({ queryKey: ["native", { b: 2, a: 1 }] });
    const two = q.defaultQueryOptions({ queryKey: ["native", { a: 1, b: 2 }] });
    expect(one.queryHash).toBe(two.queryHash);
    expect(one.queryHash).toBe(
      hashKey([
        "vaettir-auth-generation",
        12,
        g.identity,
        ["native", { a: 1, b: 2 }],
      ]),
    );
    expect(one.staleTime).toBe(123);
    expect(q.getDefaultOptions().mutations?.retry).toBe(false);
    expect(() => q.selectGeneration({ ...g, identity: "forged" })).toThrow();
    expect(() => q.selectGeneration({ ...g, number: -1 })).toThrow();
    q.clear();
  });
  it("healing ACK origin guards reject absent, changed actor or changed session without cache writes", () => {
    const a = currentSessionScope({ id: "session-a", user: { id: "user-a" } });
    expect(sameAuthScope(a, a)).toBe(true);
    expect(
      sameAuthScope(
        a,
        currentSessionScope({ id: "session-b", user: { id: "user-a" } }),
      ),
    ).toBe(false);
    expect(
      sameAuthScope(
        a,
        currentSessionScope({ id: "session-a", user: { id: "user-b" } }),
      ),
    ).toBe(false);
    expect(sameAuthScope(a, null)).toBe(false);
    expect(sameAuthScope(null, a)).toBe(false);
  });
});
