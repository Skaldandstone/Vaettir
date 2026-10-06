import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { currentSessionScope, sameAuthScope } from "./auth-query-cache";
import {
  admitRunHistoryAccess,
  admitRunHistoryPage,
  freezeRunHistory,
  sameRunHistoryOrigin,
  RunHistoryRenderGuard,
  type RunHistoryPage,
  type RunHistoryPageData,
  type RunHistoryAccessInput,
} from "./run-history-reader";
import type { useRunHistory } from "./use-run-history";
import { runHistoryReadKey } from "@vaettir/api/src/services/runHistoryReadSchema";
import {
  reviewRunHistoryPage,
  downloadReviewedRunHistoryPage,
} from "./run-history-page-export";
const source = readFileSync(
    new URL("./use-run-history.ts", import.meta.url),
    "utf8",
  ),
  ast = ts.createSourceFile("hook.ts", source, ts.ScriptTarget.Latest, true),
  functions = ast.statements
    .filter(ts.isFunctionDeclaration)
    .map((node) =>
      ts
        .createPrinter()
        .printNode(ts.EmitHint.Unspecified, node, ast)
        .replace(/\bexport\s+/, ""),
    )
    .join("\n"),
  code = ts.transpileModule(`${functions}\nthis.hook=useRunHistory;`, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
    },
  }).outputText;
type QueryState = {
  error: unknown;
  isFetching: boolean;
  isPaused: boolean;
  isFetchedAfterMount: boolean;
  wrong: string | null;
  revision: number;
};
type QueryInput = RunHistoryAccessInput &
  Partial<Pick<RunHistoryPage, "limit" | "asOf" | "before">>;
type QueryOptions = {
  enabled: boolean;
  retry: boolean;
  staleTime: number;
  refetchOnWindowFocus: boolean;
};
type Slot = { value?: unknown; deps?: unknown[]; cleanup?: () => void };
type Reader = ReturnType<typeof useRunHistory>;
function harness() {
  const auth = {
      isLoaded: true,
      isSignedIn: true,
      userId: "cl",
      sessionId: "A",
    },
    listeners = new Set<() => void>(),
    sdk = {
      loaded: true,
      session: { id: "A", user: { id: "cl" } } as null | {
        id: string;
        user: { id: string };
      },
      addListener: (listener: () => void) => {
        listeners.add(listener);
        listener();
        return () => listeners.delete(listener);
      },
    },
    params = { projectId: "p", organizationId: "o", active: true, limit: 1 };
  const slots: Slot[] = [],
    effects = new Map<number, () => void>(),
    requests: Array<{
      kind: "access" | "page";
      input: QueryInput;
      options: QueryOptions;
    }> = [],
    cache = new Map<string, unknown>(),
    cacheListeners = new Set<() => void>(),
    accessState: QueryState = {
      error: null,
      isFetching: false,
      isPaused: false,
      isFetchedAfterMount: true,
      wrong: null,
      revision: 1,
    },
    pageState = { ...accessState };
  let cursor = 0,
    dirty = false,
    uuid = 0,
    result: Reader,
    unmounted = false,
    beforeCommit: (() => void) | null = null;
  function equal(a: unknown[], b: unknown[] | undefined) {
    return (
      !!b &&
      a.length === b.length &&
      a.every((value, index) => Object.is(value, b[index]))
    );
  }
  function dto(kind: "access" | "page", input: QueryInput, state: QueryState) {
    const key = JSON.stringify([kind, runHistoryReadKey(input), state.wrong]),
      prior = cache.get(key);
    if (prior) return prior;
    const scope = {
      projectId: input.projectId,
      organizationId: "o",
      actorId: "n",
      actorClerkUserId: "cl",
    };
    if (state.wrong === "native") scope.actorId = "replacement";
    if (state.wrong === "org") scope.organizationId = "foreign";
    if (state.wrong === "Clerk") scope.actorClerkUserId = "other";
    const context = {
      requestId:
        state.wrong === "nonce"
          ? "fd4f8aaf-a6ec-4d25-a193-b9413ec13c25"
          : input.requestId,
      requestedKey:
        state.wrong === "key" ? "stale-other" : runHistoryReadKey(input),
      projection: kind === "access" ? ("ACCESS" as const) : ("PAGE" as const),
      scope,
      asOf: kind === "access" ? "2026-09-02T00:00:00.000Z" : input.asOf,
    };
    let data: unknown = { readContext: context };
    if (kind === "page") {
      const id = input.before ? "run-a" : "run-b";
      const pageData: RunHistoryPageData = {
        readContext: { ...context, projection: "PAGE", asOf: input.asOf! },
        rows: [
          {
            id,
            ciProvider: "manual",
            ciRunUrl: null,
            commitSha: "manual",
            branch: "manual",
            status: "RUNNING",
            startedAt: "2026-09-01T00:00:00.000Z",
            finishedAt: null,
            resultCount: 0,
            startedByEmail: null,
            progress: {
              total: 2,
              recorded: 0,
              remaining: 2,
              percentComplete: 0,
              pass: 0,
              fail: 0,
              blocked: 0,
              skip: 0,
              flaky: 0,
              other: 0,
            },
            progressUnavailableReason: null,
            progressBasis: "PLANNED_IDENTITIES_CURRENT_RESULTS",
          },
        ],
        limit: input.limit!,
        hasMore: !input.before,
        nextBefore: input.before
          ? null
          : { id, startedAt: "2026-09-01T00:00:00.000Z" },
        limitations: ["Current page, not whole project"],
      };
      if (state.wrong === "unavailable") {
        pageData.rows[0]!.progress = null;
        pageData.rows[0]!.progressUnavailableReason = "Head mismatch, not zero";
      }
      if (state.wrong === "unknown") Object.assign(pageData, { future: true });
      if (state.wrong === "cursor") pageData.rows[0]!.id = "run-z";
      data = state.wrong === "NULL" ? null : pageData;
    }
    cache.set(key, data);
    return data;
  }
  const queryEntries = new Map<
      string,
      { kind: "access" | "page"; input: QueryInput; state: QueryState }
    >(),
    client = {
      getQueryCache: () => ({
        subscribe: (listener: () => void) => {
          cacheListeners.add(listener);
          return () => cacheListeners.delete(listener);
        },
      }),
      getQueryState: (key: unknown) => {
        const entry = queryEntries.get(JSON.stringify(key));
        return entry
          ? {
              status: entry.state.error ? "error" : "success",
              fetchStatus: entry.state.isPaused
                ? "paused"
                : entry.state.isFetching
                  ? "fetching"
                  : "idle",
              data: dto(entry.kind, entry.input, entry.state),
              dataUpdatedAt: entry.state.revision,
            }
          : undefined;
      },
    };
  const context = vm.createContext({
    useQueryClient: () => client,
    getQueryKey: (procedure: { kind: string }, input: QueryInput) => [
      procedure.kind,
      input,
    ],
    window: { Clerk: sdk },
    TextEncoder,
    structuredClone,
    crypto: {
      randomUUID: () =>
        `6ee2ec04-4d34-40bf-b0e9-${String(++uuid).padStart(12, "0")}`,
    },
    currentSessionScope,
    sameAuthScope,
    admitRunHistoryAccess,
    admitRunHistoryPage,
    freezeRunHistory,
    sameRunHistoryOrigin,
    RunHistoryRenderGuard,
    useAuth: () => auth,
    useState: (initial: unknown) => {
      const at = cursor++;
      if (!slots[at])
        slots[at] = {
          value: typeof initial === "function" ? initial() : initial,
        };
      return [
        slots[at]!.value,
        (value: unknown) => {
          if (unmounted) throw Error("State after unmount");
          const next =
            typeof value === "function" ? value(slots[at]!.value) : value;
          if (!Object.is(next, slots[at]!.value)) {
            slots[at]!.value = next;
            dirty = true;
          }
        },
      ];
    },
    useMemo: (make: () => unknown, deps: unknown[]) => {
      const at = cursor++;
      if (!slots[at] || !equal(deps, slots[at]!.deps))
        slots[at] = { value: make(), deps };
      return slots[at]!.value;
    },
    useRef: (initial: unknown) => {
      const at = cursor++;
      if (!slots[at]) slots[at] = { value: { current: initial } };
      return slots[at]!.value;
    },
    useLayoutEffect: (make: () => void | (() => void), deps: unknown[]) => {
      const at = cursor++;
      if (!slots[at]) slots[at] = {};
      if (!equal(deps, slots[at]!.deps))
        effects.set(at, () => {
          slots[at]!.cleanup?.();
          slots[at]!.deps = deps;
          slots[at]!.cleanup = make() || undefined;
        });
    },
    trpcReact: {
      runHistory: {
        access: {
          kind: "access",
          useQuery: (input: QueryInput, options: QueryOptions) => {
            requests.push({ kind: "access", input, options });
            queryEntries.set(JSON.stringify(["access", input]), {
              kind: "access",
              input,
              state: accessState,
            });
            return {
              ...accessState,
              dataUpdatedAt: accessState.revision,
              data: dto("access", input, accessState),
            };
          },
        },
        page: {
          kind: "page",
          useQuery: (input: QueryInput, options: QueryOptions) => {
            requests.push({ kind: "page", input, options });
            queryEntries.set(JSON.stringify(["page", input]), {
              kind: "page",
              input,
              state: pageState,
            });
            return {
              ...pageState,
              dataUpdatedAt: pageState.revision,
              data: dto("page", input, pageState),
            };
          },
        },
      },
    },
  });
  vm.runInContext(code, context);
  const hook = context.hook as typeof useRunHistory;
  function render() {
    for (let count = 0; count < 60; count++) {
      cursor = 0;
      dirty = false;
      effects.clear();
      result = hook(params.projectId, params.organizationId, {
        active: params.active,
        limit: params.limit,
      });
      if (dirty) continue;
      const callback = beforeCommit;
      beforeCommit = null;
      callback?.();
      for (const effect of effects.values()) effect();
      if (!dirty) return result;
    }
    throw Error("Reader hook did not settle");
  }
  function setSDK(sessionId: string | null, userId = "cl") {
    sdk.session = sessionId ? { id: sessionId, user: { id: userId } } : null;
    for (const listener of [...listeners]) listener();
  }
  render();
  return {
    auth,
    sdk,
    params,
    accessState,
    pageState,
    requests,
    listeners,
    cacheListeners,
    setSDK,
    render,
    beforeCommit: (callback: () => void) => {
      beforeCommit = callback;
    },
    emitCache: () => {
      for (const callback of [...cacheListeners]) callback();
    },
    unmount: () => {
      unmounted = true;
      for (const slot of slots) slot.cleanup?.();
    },
    get reader() {
      return result;
    },
  };
}
describe("actual run-history hook with independent hook auth/SDK/native-shaped RPC; no native calls", () => {
  it("completes nonce/native bootstrap and page once, no custom schema/privilege upgrade; current callback is independently fresh", () => {
    const h = harness();
    expect(h.reader.origin).toEqual({
      projectId: "p",
      organizationId: "o",
      clerkActorId: "cl",
      nativeActorId: "n",
    });
    expect(h.reader.fresh!.rows[0]!.id).toBe("run-b");
    expect(h.reader.current()).toBe(h.reader.snapshot);
    expect(h.reader.observedSessionId).toBe("A");
    const page = h.requests.filter((row) => row.kind === "page").at(-1);
    expect(page!.options.enabled).toBe(true);
    expect(page!.input.expectedNativeActorId).toBe("n");
  });
  it.each(["nonce", "key", "native", "org", "Clerk", "NULL", "unknown"])(
    "page %s mismatch withholds data and preserves pinned scope",
    (wrong) => {
      const h = harness(),
        origin = h.reader.origin;
      h.pageState.wrong = wrong;
      expect(h.render().fresh).toBeNull();
      expect(h.reader.current()).toBeNull();
      expect(h.reader.origin).toBe(origin);
      expect(h.reader.refresh()).toBe(true);
    },
  );
  it.each(["error", "isFetching", "isPaused", "isFetchedAfterMount"])(
    "%s cached page cannot grant display/export",
    (key) => {
      const h = harness();
      Object.assign(h.pageState, {
        [key]:
          key === "error"
            ? Error("private-late-error")
            : key !== "isFetchedAfterMount",
      });
      expect(h.render().fresh).toBeNull();
      expect(h.reader.current()).toBeNull();
      expect(h.reader.error ?? "").not.toContain("private-late-error");
    },
  );
  it("SDK-only change before auth hook/React commit immediately denies pagination/CSV; A-B-A resource emits require explicit native refresh", () => {
    const h = harness(),
      origin = h.reader.origin,
      old = h.reader,
      review = reviewRunHistoryPage(old.snapshot!),
      download = vi.fn();
    h.setSDK("B");
    expect(h.auth.sessionId).toBe("A");
    expect(old.current()).toBeNull();
    expect(old.older()).toBe(false);
    expect(old.refresh()).toBe(false);
    h.setSDK("A");
    expect(old.current()).toBeNull();
    expect(downloadReviewedRunHistoryPage(review, old.current, download)).toBe(
      false,
    );
    h.render();
    expect(h.reader.fresh).toBeNull();
    expect(h.reader.origin).toBe(origin);
    expect(h.reader.refresh()).toBe(true);
    h.render();
    expect(h.reader.fresh).not.toBeNull();
    expect(
      downloadReviewedRunHistoryPage(review, h.reader.current, download),
    ).toBe(false);
    expect(download).not.toHaveBeenCalled();
  });
  it("renewed same-actor session does not auto-adopt; explicit refresh independently verifies original native scope", () => {
    const h = harness(),
      origin = h.reader.origin;
    h.setSDK("renewed");
    h.auth.sessionId = "renewed";
    h.render();
    expect(h.reader.fresh).toBeNull();
    expect(h.reader.refresh()).toBe(true);
    h.render();
    expect(h.reader.origin).toBe(origin);
    expect(h.reader.observedSessionId).toBe("renewed");
    expect(
      h.requests.filter((row) => row.kind === "access").at(-1)!.input
        .expectedNativeActorId,
    ).toBe("n");
  });
  it("older/newer/first retain exact anchor, rotate page nonce, no stale back-page cache or obsolete handler revocation", () => {
    const h = harness(),
      old = h.reader,
      anchor = h.reader.fresh!.readContext.asOf,
      firstNonce = h.reader.fresh!.readContext.requestId;
    expect(old.older()).toBe(true);
    h.render();
    expect(h.reader.fresh!.rows[0]!.id).toBe("run-a");
    expect(h.reader.fresh!.readContext.asOf).toBe(anchor);
    expect(old.older()).toBe(false);
    expect(h.reader.current()).not.toBeNull();
    expect(h.reader.newer()).toBe(true);
    h.render();
    expect(h.reader.fresh!.rows[0]!.id).toBe("run-b");
    expect(h.reader.fresh!.readContext.requestId).not.toBe(firstNonce);
    expect(h.reader.fresh!.readContext.asOf).toBe(anchor);
    expect(h.reader.first()).toBe(true);
    h.render();
    expect(h.reader.canNewer).toBe(false);
  });
  it("close/reopen, project/org/account A-B-A cannot revive cached history or reset native origin; fresh original intent remains refreshable", () => {
    for (const change of ["active", "project", "org", "account"]) {
      const h = harness(),
        origin = h.reader.origin;
      if (change === "active") h.params.active = false;
      if (change === "project") h.params.projectId = "other";
      if (change === "org") h.params.organizationId = "other";
      if (change === "account") {
        h.auth.userId = "other";
        h.setSDK("B", "other");
        h.auth.sessionId = "B";
      }
      h.render();
      expect(h.reader.fresh).toBeNull();
      if (change !== "active") expect(h.reader.refresh()).toBe(false);
      h.params.active = true;
      h.params.projectId = "p";
      h.params.organizationId = "o";
      h.auth.userId = "cl";
      h.auth.sessionId = "A";
      h.setSDK("A");
      h.render();
      expect(h.reader.fresh).toBeNull();
      expect(h.reader.origin).toBe(origin);
      expect(h.reader.refresh()).toBe(true);
      h.render();
      expect(h.reader.fresh).not.toBeNull();
    }
  });
  it("native refusal/malformed bootstrap permits explicit original Refresh but no page authority; original scope cannot be replaced", () => {
    const h = harness(),
      origin = h.reader.origin;
    h.accessState.wrong = "native";
    h.reader.refresh();
    h.render();
    expect(h.reader.fresh).toBeNull();
    expect(h.reader.origin).toBe(origin);
    expect(h.reader.refresh()).toBe(true);
    h.accessState.wrong = null;
    h.render();
    expect(h.reader.fresh).not.toBeNull();
  });
  it("SDK A-B-A between render and layout commit cannot publish the previously admitted private page", () => {
    const h = harness(),
      old = h.reader,
      review = reviewRunHistoryPage(old.snapshot!),
      download = vi.fn();
    h.beforeCommit(() => {
      h.setSDK("B");
      h.setSDK("A");
      expect(h.auth.sessionId).toBe("A");
      expect(old.current()).toBeNull();
    });
    h.render();
    expect(h.reader.fresh).toBeNull();
    expect(
      downloadReviewedRunHistoryPage(review, h.reader.current, download),
    ).toBe(false);
    expect(h.reader.refresh()).toBe(true);
    h.render();
    expect(h.reader.fresh).not.toBeNull();
    expect(download).not.toHaveBeenCalled();
  });
  it("dead SDK and query-cache subscribers cannot publish after unmount", () => {
    const h = harness(),
      old = h.reader,
      listeners = [...h.listeners],
      cacheListeners = [...h.cacheListeners];
    h.setSDK("B");
    h.unmount();
    expect(h.listeners.size).toBe(0);
    expect(h.cacheListeners.size).toBe(0);
    expect(old.current()).toBeNull();
    h.sdk.session = { id: "A", user: { id: "cl" } };
    expect(() => {
      for (const callback of [...listeners, ...cacheListeners]) callback();
    }).not.toThrow();
    expect(old.refresh()).toBe(false);
  });
  it.each(["error", "isFetching", "isPaused", "wrong"])(
    "native cache %s A-B-A without React commits revokes current page and CSV until explicit native refresh",
    (key) => {
      const h = harness(),
        old = h.reader,
        review = reviewRunHistoryPage(old.snapshot!),
        download = vi.fn();
      const prior = { ...h.pageState };
      Object.assign(h.pageState, {
        [key]:
          key === "error"
            ? Error("private cached refusal")
            : key === "wrong"
              ? "nonce"
              : true,
      });
      h.emitCache();
      expect(old.current()).toBeNull();
      Object.assign(h.pageState, prior);
      h.emitCache();
      expect(old.current()).toBeNull();
      expect(
        downloadReviewedRunHistoryPage(review, old.current, download),
      ).toBe(false);
      h.render();
      expect(h.reader.fresh).toBeNull();
      expect(h.reader.refresh()).toBe(true);
      h.render();
      expect(h.reader.fresh).not.toBeNull();
      expect(
        downloadReviewedRunHistoryPage(review, h.reader.current, download),
      ).toBe(false);
      expect(download).not.toHaveBeenCalled();
    },
  );
  it("action-time native cache state revokes export even before the cache listener event", () => {
    const h = harness(),
      old = h.reader,
      review = reviewRunHistoryPage(old.snapshot!),
      download = vi.fn();
    h.pageState.isFetching = true;
    expect(downloadReviewedRunHistoryPage(review, old.current, download)).toBe(
      false,
    );
    h.pageState.isFetching = false;
    expect(old.current()).toBeNull();
    h.render();
    expect(h.reader.fresh).toBeNull();
    expect(h.reader.refresh()).toBe(true);
    h.render();
    expect(h.reader.fresh).not.toBeNull();
    expect(download).not.toHaveBeenCalled();
  });
  it.each(["active", "limit", "intent", "data"])(
    "render %s revokes old current/export/refresh/paging before layout publishes any new frame",
    (change) => {
      const h = harness(),
        old = h.reader,
        review = reviewRunHistoryPage(old.snapshot!),
        download = vi.fn();
      if (change === "active") h.params.active = false;
      if (change === "limit") h.params.limit = 2;
      if (change === "intent") expect(old.refresh()).toBe(true);
      if (change === "data") h.pageState.wrong = "unavailable";
      h.beforeCommit(() => {
        expect(old.current()).toBeNull();
        expect(
          downloadReviewedRunHistoryPage(review, old.current, download),
        ).toBe(false);
        expect(old.refresh()).toBe(false);
        expect(old.older()).toBe(false);
        expect(h.reader.current()).toBeNull();
      });
      h.render();
      expect(download).not.toHaveBeenCalled();
    },
  );
  it("native cache A-B-A between render and an already posted layout cannot rebind a revoked read or CSV", () => {
    const h = harness(),
      old = h.reader,
      review = reviewRunHistoryPage(old.snapshot!),
      download = vi.fn();
    h.pageState.revision = 2;
    h.beforeCommit(() => {
      h.pageState.isFetching = true;
      h.emitCache();
      h.pageState.isFetching = false;
      h.emitCache();
      expect(old.current()).toBeNull();
    });
    h.render();
    expect(h.reader.fresh).toBeNull();
    expect(h.reader.current()).toBeNull();
    expect(
      downloadReviewedRunHistoryPage(review, h.reader.current, download),
    ).toBe(false);
    expect(h.reader.refresh()).toBe(true);
    h.render();
    expect(h.reader.fresh).not.toBeNull();
    expect(download).not.toHaveBeenCalled();
  });
  it("cache loss before the first layout of a newly paginated native candidate is latched even with no committed view", () => {
    const h = harness();
    expect(h.reader.older()).toBe(true);
    h.beforeCommit(() => {
      h.pageState.error = Error("private pending-page refusal");
      h.emitCache();
      h.pageState.error = null;
      h.emitCache();
      expect(h.reader.current()).toBeNull();
    });
    h.render();
    expect(h.reader.fresh).toBeNull();
    expect(h.reader.current()).toBeNull();
    expect(h.reader.refresh()).toBe(true);
    h.render();
    expect(h.reader.fresh).not.toBeNull();
  });
  it("supported unavailable progress stays NULL, no successful zero substitution", () => {
    const h = harness();
    h.pageState.wrong = "unavailable";
    h.render();
    expect(h.reader.fresh!.rows[0]!.progress).toBeNull();
    expect(h.reader.fresh!.rows[0]!.progressUnavailableReason).toContain(
      "Head mismatch",
    );
  });
});
