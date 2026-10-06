// Actual hook and reader with synthetic React/Clerk/RPC boundaries. Installed
// TanStack QueryClient/cache/QueryObserver are real; no native or browser proof.
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { expect, it } from "vitest";
import { currentSessionScope, sameAuthScope } from "./auth-query-cache";
import {
  admitRunStartRead,
  inspectRunStartReadWire,
  runStartReadIdentity,
  runStartReviewedReadKey,
  sameRunStartReadOrigin,
  RunStartReadRenderGuard,
  RUN_START_READ_BOUNDS,
  runStartReadWireSignature,
  type RunStartProjection,
  type RunStartReadInput,
} from "./manual-run-start-reviewed-reader";
import type {
  ManualRunStartReadAdapter,
  useManualRunStartReviewedAccess,
} from "./use-manual-run-start-reviewed-access";
const source = readFileSync(
    new URL("./use-manual-run-start-reviewed-access.ts", import.meta.url),
    "utf8",
  ),
  ast = ts.createSourceFile("hook.ts", source, ts.ScriptTarget.Latest, true),
  code = ts.transpileModule(
    ast.statements
      .filter(ts.isFunctionDeclaration)
      .map((n) =>
        ts
          .createPrinter()
          .printNode(ts.EmitHint.Unspecified, n, ast)
          .replace(/\bexport\s+/, ""),
      )
      .join("\n") + "\nthis.hook=useManualRunStartReviewedAccess;",
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.None,
      },
    },
  ).outputText;
type Reader = ReturnType<typeof useManualRunStartReviewedAccess>;
function harness(
  mode: "ok" | "missing" | "void" | "throw" | "getter" = "ok",
  waiting = false,
  nativePin?: string | null,
) {
  const auth = {
      isLoaded: true,
      isSignedIn: true,
      userId: "cl",
      sessionId: "A",
    },
    params: {
      projectId: string;
      organizationId: string | null | undefined;
      active: boolean;
      originalNativeActorId?: string | null;
    } = {
      projectId: "p",
      organizationId: "o",
      active: true,
      ...(nativePin === undefined ? {} : { originalNativeActorId: nativePin }),
    };
  const listeners = new Set<() => void>(),
    cleanup = { work: () => {} },
    state = {
      error: null as unknown,
      fetching: waiting,
      paused: false,
      fetched: !waiting,
      wrong: "",
      revision: 1,
      full: true,
      unsupported: false,
    },
    rows = new Map<string, unknown>();
  const sdk: {
    loaded: boolean;
    session: { id: string; user: { id: string } } | null;
    addListener?: (cb: () => void) => unknown;
  } = {
    loaded: true,
    session: { id: "A", user: { id: "cl" } },
    addListener: (cb) => {
      listeners.add(cb);
      cb();
      return () => {
        listeners.delete(cb);
        cleanup.work();
      };
    },
  };
  const normalListener = sdk.addListener!;
  if (mode === "missing") delete sdk.addListener;
  if (mode === "void") sdk.addListener = () => undefined;
  if (mode === "throw")
    sdk.addListener = () => {
      throw Error("PRIVATE_SDK");
    };
  if (mode === "getter")
    Object.defineProperty(sdk, "addListener", {
      configurable: true,
      get() {
        throw Error("PRIVATE_SDK_GETTER");
      },
    });
  const requests: Array<{
      projection: RunStartProjection;
      input: RunStartReadInput;
      enabled: boolean;
    }> = [],
    slots: Array<{
      value?: unknown;
      setter?: (v: unknown) => void;
      deps?: unknown[];
      cleanup?: () => void;
    }> = [],
    effects = new Map<number, () => void>();
  let dirty = false,
    cursor = 0,
    uuid = 0,
    reader: Reader,
    dead = false,
    beforeCommit: (() => void) | null = null;
  let signatureReads = 0,
    setterCalls = 0;
  function dto(projection: RunStartProjection, input: RunStartReadInput) {
    const key = JSON.stringify([
        projection,
        runStartReviewedReadKey(
          input,
          projection === "PREVIEW" && !input.expectedNativeActorId
            ? "ACCESS"
            : projection,
        ),
        state.wrong,
        state.full,
        state.unsupported,
      ]),
      previous = rows.get(key);
    if (previous !== undefined) return previous;
    const scope = {
        projectId: state.wrong === "project" ? "foreign" : input.projectId,
        organizationId: state.wrong === "org" ? "foreign" : "o",
        actorClerkUserId: state.wrong === "Clerk" ? "other" : "cl",
        actorId: state.wrong === "native" ? "M" : "n",
      },
      readContext = {
        requestId:
          state.wrong === "nonce"
            ? "6ee2ec04-4d34-40bf-b0e9-000000999999"
            : input.requestId,
        requestedKey:
          state.wrong === "key"
            ? "stale"
            : runStartReviewedReadKey(
                input,
                projection === "PREVIEW" && !input.expectedNativeActorId
                  ? "ACCESS"
                  : projection,
              ),
        projection,
        scope,
      };
    let raw: unknown = {
      readContext,
      canConfigure: state.full,
      canRecover: state.full,
    };
    if (projection === "PREVIEW")
      raw = {
        readContext,
        canConfigure: state.full,
        canRecover: state.full,
        canStart: state.full && !state.unsupported,
        profile: state.unsupported
          ? { kind: "UNSUPPORTED", reason: "PROFILE_UNAVAILABLE" }
          : {
              kind: "SUPPORTED",
              experience: null,
              profileHash: "a".repeat(64),
            },
        limitations: ["Profile metadata only. Writer admission is required."],
      };
    if (state.wrong === "NULL") raw = null;
    rows.set(key, raw);
    return raw;
  }
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const originalCache = client.getQueryCache();
  let activeCache = originalCache;
  client.getQueryCache = () => activeCache;
  const adapter: ManualRunStartReadAdapter = {
    access: async (i) => dto("ACCESS", i),
    preview: async (i) => dto("PREVIEW", i),
    key: (projection, input) => [projection, JSON.parse(JSON.stringify(input))],
  };
  let transport: ManualRunStartReadAdapter | undefined = adapter;
  function query(options: {
    queryKey: readonly unknown[];
    enabled: boolean;
    queryFn: () => Promise<unknown>;
  }) {
    const projection = options.queryKey[1] === "PREVIEW" ? "PREVIEW" : "ACCESS",
      input = options.queryKey[2]
        ? (JSON.parse(JSON.stringify(options.queryKey[2])) as RunStartReadInput)
        : {
            projectId: "p",
            originalOrganizationId: "o",
            expectedClerkActorId: "cl",
            requestId: "00000000-0000-4000-8000-000000000000",
          };
    requests.push({ projection, input, enabled: options.enabled });
    const raw = dto(projection, input),
      q = activeCache.build(client, {
        queryKey: options.queryKey,
        queryFn: options.queryFn,
      });
    const status = state.error ? ("error" as const) : ("success" as const),
      fetchStatus = state.paused
        ? ("paused" as const)
        : state.fetching
          ? ("fetching" as const)
          : ("idle" as const);
    if (
      q.state.data !== raw ||
      q.state.dataUpdatedAt !== state.revision ||
      q.state.status !== status ||
      q.state.fetchStatus !== fetchStatus
    )
      q.setState({
        data: raw,
        dataUpdatedAt: state.revision,
        status,
        fetchStatus,
        error: state.error as Error | null,
      });
    return {
      data: raw,
      dataUpdatedAt: state.revision,
      error: state.error,
      isFetching: state.fetching,
      isPaused: state.paused,
      isFetchedAfterMount: state.fetched,
    };
  }
  // Recreate typed RPC input only across VM realms as actual JSON transport does;
  // do not normalize/repair output. Source key wrapper uses actual cache keys.
  const context = vm.createContext({
    window: { Clerk: sdk },
    crypto: {
      randomUUID: () =>
        `6ee2ec04-4d34-40bf-b0e9-${String(++uuid).padStart(12, "0")}`,
    },
    currentSessionScope,
    sameAuthScope,
    admitRunStartRead: (
      raw: unknown,
      i: RunStartReadInput,
      p: RunStartProjection,
      cl: string,
      o: Parameters<typeof admitRunStartRead>[4],
    ) =>
      admitRunStartRead(
        raw,
        JSON.parse(JSON.stringify(i)) as RunStartReadInput,
        p,
        cl,
        o,
      ),
    inspectRunStartReadWire,
    runStartReadIdentity,
    sameRunStartReadOrigin,
    RunStartReadRenderGuard,
    runStartReadWireSignature: (
      value: unknown,
      projection: RunStartProjection,
    ) => {
      signatureReads++;
      return runStartReadWireSignature(value, projection);
    },
    useAuth: () => auth,
    useQueryClient: () => client,
    useQuery: query,
    useState: (initial: unknown) => {
      const at = cursor++;
      slots[at] ??= {
        value: typeof initial === "function" ? initial() : initial,
      };
      slots[at]!.setter ??= (v: unknown) => {
        setterCalls++;
        if (dead) throw Error("State after unmount");
        const next = typeof v === "function" ? v(slots[at]!.value) : v;
        if (!Object.is(next, slots[at]!.value)) {
          slots[at]!.value = next;
          dirty = true;
        }
      };
      return [slots[at]!.value, slots[at]!.setter];
    },
    useRef: (v: unknown) => {
      const at = cursor++;
      slots[at] ??= { value: { current: v } };
      return slots[at]!.value;
    },
    useMemo: (make: () => unknown, deps: unknown[]) => {
      const at = cursor++;
      if (
        !slots[at]?.deps ||
        deps.length !== slots[at]!.deps!.length ||
        deps.some((v, i) => !Object.is(v, slots[at]!.deps![i]))
      )
        slots[at] = { value: make(), deps };
      return slots[at]!.value;
    },
    useLayoutEffect: (make: () => void | (() => void), deps?: unknown[]) => {
      const at = cursor++;
      slots[at] ??= {};
      if (
        !deps ||
        !slots[at]!.deps ||
        deps.some((v, i) => !Object.is(v, slots[at]!.deps![i]))
      )
        effects.set(at, () => {
          slots[at]!.cleanup?.();
          slots[at]!.deps = deps;
          slots[at]!.cleanup = make() || undefined;
        });
    },
  });
  vm.runInContext(code, context);
  const hook = context.hook as typeof useManualRunStartReviewedAccess;
  function render(commit = true) {
    for (let i = 0; i < 70; i++) {
      cursor = 0;
      dirty = false;
      effects.clear();
      reader = hook(params.projectId, params.organizationId, transport, params);
      if (!commit) return reader;
      if (dirty) continue;
      const before = beforeCommit;
      beforeCommit = null;
      before?.();
      for (const effect of effects.values()) effect();
      if (!dirty) return reader;
    }
    throw Error("Hook did not settle");
  }
  render();
  return {
    auth,
    sdk,
    client,
    context,
    params,
    state,
    requests,
    cleanup,
    render,
    setAdapter: (next: ManualRunStartReadAdapter | undefined) => {
      transport = next;
    },
    adapter,
    signatureReads: () => signatureReads,
    setterCalls: () => setterCalls,
    guard: () =>
      slots.find((slot) => slot.value instanceof RunStartReadRenderGuard)!
        .value as RunStartReadRenderGuard,
    replaceCache: () => {
      activeCache = new QueryClient().getQueryCache();
      return () => {
        activeCache = originalCache;
      };
    },
    beforeLayout: () => render(false),
    beforeCommit: (f: () => void) => {
      beforeCommit = f;
    },
    emit: () => {
      for (const cb of [...listeners]) cb();
    },
    restoreListener: () => {
      Object.defineProperty(sdk, "addListener", {
        configurable: true,
        enumerable: true,
        writable: true,
        value: normalListener,
      });
    },
    unmount: () => {
      dead = true;
      for (const slot of slots) slot.cleanup?.();
      client.clear();
    },
    get reader() {
      return reader;
    },
  };
}
type SDKFault =
  "windowClerk" | "loaded" | "session" | "sessionId" | "user" | "userId";
function installSDKGetterFault(h: ReturnType<typeof harness>, field: SDKFault) {
  const session = h.sdk.session!;
  const target =
    field === "windowClerk"
      ? h.context.window
      : field === "loaded" || field === "session"
        ? h.sdk
        : field === "sessionId" || field === "user"
          ? session
          : session.user;
  const key =
    field === "windowClerk"
      ? "Clerk"
      : field === "sessionId" || field === "userId"
        ? "id"
        : field;
  const descriptor = Object.getOwnPropertyDescriptor(target, key)!;
  Object.defineProperty(target, key, {
    configurable: true,
    get() {
      throw Error(`PRIVATE_${field}`);
    },
  });
  return () => Object.defineProperty(target, key, descriptor);
}
it("first completed ACCESS pins current N only and makes no automatic profile/cohort/receipt claim", () => {
  const h = harness();
  expect(h.reader.current()).toBe(h.reader.snapshot);
  expect(h.reader.origin).toEqual({
    projectId: "p",
    organizationId: "o",
    clerkActorId: "cl",
    nativeActorId: "n",
  });
  expect(
    h.requests.filter((r) => r.enabled).every((r) => r.projection === "ACCESS"),
  ).toBe(true);
  expect(h.reader.canStartMetadata).toBe(false);
  expect(h.reader.cohortVerified).toBe(false);
  expect(h.reader.receiptVerified).toBe(false);
  expect(h.reader.readPreview()).toBe(true);
  h.render();
  expect(h.reader.snapshot!.projection).toBe("PREVIEW");
  expect(h.reader.current()).toBe(h.reader.snapshot);
  expect(h.reader.canStartMetadata).toBe(true);
  expect(
    h.requests.filter((r) => r.enabled && r.projection === "PREVIEW").at(-1)!
      .input.expectedNativeActorId,
  ).toBe("n");
});
it("completed null experience is genuine metadata, unsupported profile separates recovery from new start", () => {
  const h = harness();
  h.state.unsupported = true;
  h.reader.readPreview();
  h.render();
  expect(h.reader.current()).toBe(h.reader.snapshot);
  expect(h.reader.canRecoverMetadata).toBe(true);
  expect(h.reader.canStartMetadata).toBe(false);
  expect(h.reader.snapshot!.data).toMatchObject({
    profile: { kind: "UNSUPPORTED", reason: "PROFILE_UNAVAILABLE" },
  });
});
it("read-only membership is readable but neither configure nor recovery permission", () => {
  const h = harness("ok", true);
  h.state.full = false;
  h.state.fetching = false;
  h.state.fetched = true;
  h.render();
  expect(h.reader.current()).toBe(h.reader.snapshot);
  expect(h.reader.canRecoverMetadata).toBe(false);
  h.reader.readPreview();
  h.render();
  expect(h.reader.canStartMetadata).toBe(false);
});
it("cache-only data cannot establish original N before newly completed read", () => {
  const h = harness("ok", true);
  h.state.fetching = false;
  h.render();
  expect(h.reader.origin).toBeNull();
  expect(h.reader.current()).toBeNull();
  const nonce = h.requests.filter((r) => r.enabled).at(-1)!.input.requestId;
  h.state.fetched = true;
  h.render();
  expect(h.reader.current()).toBe(h.reader.snapshot);
  expect(h.reader.snapshot!.data.readContext.requestId).toBe(nonce);
});
it.each(["missing", "void", "throw", "getter"] as const)(
  "SDK %s does not confer read authority; explicit installation retry remains fail-closed",
  (mode) => {
    const h = harness(mode);
    expect(h.reader.current()).toBeNull();
    expect(h.requests.every((r) => !r.enabled)).toBe(true);
    expect(h.reader.origin).toBeNull();
    expect(h.reader.error ?? "").not.toContain("PRIVATE_SDK");
    h.restoreListener();
    expect(h.reader.refresh()).toBe(false);
    h.render();
    expect(h.reader.current()).toBe(h.reader.snapshot);
  },
);
it.each(["org", "Clerk", "project", "nonce", "key", "NULL"])(
  "contradictory whole %s echo never admits private metadata or initial N",
  (wrong) => {
    const h = harness("ok", true);
    h.state.wrong = wrong;
    h.state.fetching = false;
    h.state.fetched = true;
    h.render();
    expect(h.reader.origin).toBeNull();
    expect(h.reader.current()).toBeNull();
  },
);
it("supplied original N rejects another mapping and is never replaced from ACCESS", () => {
  const h = harness("ok", true, "n");
  h.state.wrong = "native";
  h.state.fetching = false;
  h.state.fetched = true;
  h.render();
  expect(h.reader.origin).toBeNull();
  h.state.wrong = "";
  h.reader.refresh();
  h.render();
  expect(h.reader.current()).toBe(h.reader.snapshot);
  const original = h.reader.origin;
  h.params.originalNativeActorId = "M";
  h.render();
  expect(h.reader.current()).toBeNull();
  expect(h.reader.origin).toBe(original);
  expect(h.reader.refresh()).toBe(false);
});
it("renewed same-owner B needs explicit native refresh, preserving original project/org/Clerk/N", () => {
  const h = harness(),
    original = h.reader.origin,
    old = h.reader,
    nonce = old.snapshot!.data.readContext.requestId;
  h.sdk.session = { id: "B", user: { id: "cl" } };
  h.emit();
  expect(old.current()).toBeNull();
  expect(old.refresh()).toBe(false);
  h.auth.sessionId = "B";
  h.render();
  expect(h.reader.current()).toBeNull();
  expect(h.reader.refresh()).toBe(true);
  h.render();
  expect(h.reader.current()).toBe(h.reader.snapshot);
  expect(h.reader.origin).toBe(original);
  expect(h.reader.observedSessionId).toBe("B");
  expect(h.reader.snapshot!.data.readContext.requestId).not.toBe(nonce);
  expect(
    h.requests.filter((r) => r.enabled).at(-1)!.input.expectedNativeActorId,
  ).toBe("n");
  expect(old.current()).toBeNull();
  expect(old.refresh()).toBe(false);
});
it("SDK-only observed A-B-A permanently revokes old nonce without a React commit", () => {
  const h = harness(),
    old = h.reader;
  h.sdk.session = { id: "B", user: { id: "cl" } };
  h.emit();
  h.sdk.session = { id: "A", user: { id: "cl" } };
  h.emit();
  expect(old.current()).toBeNull();
  h.render();
  expect(h.reader.current()).toBeNull();
  h.reader.refresh();
  h.render();
  expect(h.reader.current()).toBe(h.reader.snapshot);
  expect(old.readPreview()).toBe(false);
});
it("action-time SDK change before listener/render commit cannot grant old Start metadata", () => {
  const h = harness(),
    old = h.reader;
  h.sdk.session = { id: "B", user: { id: "cl" } };
  expect(old.current()).toBeNull();
  expect(old.readPreview()).toBe(false);
  expect(old.refresh()).toBe(false);
});
it("empty revoked view returns null without any setter calls on repeated render-phase current reads", () => {
  const h = harness(),
    captured = h.reader;
  h.sdk.session = { id: "B", user: { id: "cl" } };
  expect(captured.current()).toBeNull();
  const afterRevocation = h.setterCalls();
  for (let n = 0; n < 100; n++) expect(captured.current()).toBeNull();
  expect(h.setterCalls()).toBe(afterRevocation);
  h.render();
  const afterRender = h.setterCalls();
  for (let n = 0; n < 100; n++) expect(h.reader.current()).toBeNull();
  expect(h.setterCalls()).toBe(afterRender);
  h.auth.sessionId = "B";
  h.render();
  expect(h.reader.refresh()).toBe(true);
  h.render();
  expect(h.reader.current()).toBe(h.reader.snapshot);
});
it.each([
  "windowClerk",
  "loaded",
  "session",
  "sessionId",
  "user",
  "userId",
] as const)(
  "throwing SDK %s getter stays a generic refusal in render/layout/listener/action paths",
  (field) => {
    const h = harness(),
      old = h.reader,
      original = old.origin;
    installSDKGetterFault(h, field);
    expect(() => old.current()).not.toThrow();
    expect(old.current()).toBeNull();
    expect(() => old.refresh()).not.toThrow();
    expect(old.refresh()).toBe(false);
    expect(() => h.emit()).not.toThrow();
    expect(() => h.render()).not.toThrow();
    expect(h.reader.snapshot).toBeNull();
    expect(h.reader.fresh).toBeNull();
    expect(h.reader.canStartMetadata).toBe(false);
    expect(h.reader.canRecoverMetadata).toBe(false);
    expect(h.reader.origin).toBe(original);
    expect(h.reader.error ?? "").not.toContain("PRIVATE_");
  },
);
it.each(
  (["render", "layout"] as const).flatMap((phase) =>
    (
      [
        "windowClerk",
        "loaded",
        "session",
        "sessionId",
        "user",
        "userId",
      ] as const
    ).map((field) => ({ phase, field })),
  ),
)(
  "direct SDK fault %j is caught before public publication without a prior handler revocation",
  ({ phase, field }) => {
    const h = harness();
    h.reader.readPreview();
    h.render();
    const original = h.reader.origin,
      nonce = h.reader.snapshot!.data.readContext.requestId;
    let restore = () => {};
    if (phase === "render") restore = installSDKGetterFault(h, field);
    else
      h.beforeCommit(() => {
        restore = installSDKGetterFault(h, field);
      });
    expect(() => h.render()).not.toThrow();
    expect(h.reader.snapshot).toBeNull();
    expect(h.reader.fresh).toBeNull();
    expect(h.reader.readable).toBe(false);
    expect(h.reader.canStartMetadata).toBe(false);
    expect(h.reader.canRecoverMetadata).toBe(false);
    expect(h.reader.origin).toBe(original);
    expect(h.reader.error ?? "").not.toContain("PRIVATE_");
    restore();
    h.render();
    expect(h.reader.snapshot).toBeNull();
    expect(h.reader.refresh()).toBe(true);
    h.render();
    expect(h.reader.current()).toBe(h.reader.snapshot);
    expect(h.reader.origin).toBe(original);
    expect(h.reader.snapshot!.data.readContext.requestId).not.toBe(nonce);
  },
);
it("actual installed QueryObserver fetch A-B-A invalidates old read despite same returned cache object", async () => {
  const h = harness(),
    old = h.reader;
  const q = h.client
    .getQueryCache()
    .getAll()
    .find(
      (q) =>
        q.queryKey[1] === "ACCESS" &&
        (q.queryKey[2] as RunStartReadInput).requestId ===
          old.snapshot!.data.readContext.requestId,
    )!;
  let resolve!: (value: unknown) => void;
  const observer = new QueryObserver(h.client, {
    queryKey: q.queryKey,
    queryFn: () =>
      new Promise<unknown>((done) => {
        resolve = done;
      }),
    enabled: false,
    retry: false,
  });
  const unsubscribe = observer.subscribe(() => {});
  const request = observer.refetch();
  expect(old.current()).toBeNull();
  resolve(q.state.data);
  await request;
  expect(old.current()).toBeNull();
  h.render();
  expect(h.reader.current()).toBeNull();
  h.reader.refresh();
  h.render();
  expect(h.reader.current()).toBe(h.reader.snapshot);
  expect(h.reader.snapshot!.data.readContext.requestId).not.toBe(
    old.snapshot!.data.readContext.requestId,
  );
  unsubscribe();
});
it("cache revision/identity/error/paused changes deny current metadata and never echo private failures", () => {
  const h = harness(),
    original = h.reader.origin;
  h.state.error = Error("PRIVATE_NATIVE_BODY");
  h.render();
  expect(h.reader.current()).toBeNull();
  expect(h.reader.fresh).toBeNull();
  expect(h.reader.origin).toBe(original);
  expect(h.reader.error).not.toContain("PRIVATE_NATIVE_BODY");
  h.state.error = null;
  h.state.paused = true;
  h.render();
  expect(h.reader.current()).toBeNull();
  h.state.paused = false;
  h.reader.refresh();
  h.render();
  expect(h.reader.current()).toBe(h.reader.snapshot);
});
it("in-place cache mutation without an event cannot keep a previously admitted metadata signature", () => {
  const h = harness(),
    old = h.reader;
  const q = h.client
    .getQueryCache()
    .getAll()
    .find(
      (q) =>
        q.queryKey[1] === "ACCESS" &&
        (q.queryKey[2] as RunStartReadInput).requestId ===
          old.snapshot!.data.readContext.requestId,
    )!;
  (q.state.data as { canRecover: boolean }).canRecover = false;
  expect(old.current()).toBeNull();
  expect(old.readPreview()).toBe(false);
  expect(old.snapshot!.data.canRecover).toBe(true);
});
it("unrelated installed cache events do not rescan private profile; exact captured query events remain guarded", () => {
  const h = harness();
  h.reader.readPreview();
  h.render();
  const before = h.signatureReads();
  h.client.setQueryData(["unrelated", "other-project"], {
    private: "not this reader",
  });
  expect(h.signatureReads()).toBe(before);
  const q = h.client
    .getQueryCache()
    .getAll()
    .find(
      (q) =>
        q.queryKey[1] === "PREVIEW" &&
        (q.queryKey[2] as RunStartReadInput).requestId ===
          h.reader.snapshot!.data.readContext.requestId,
    )!;
  q.setState({ dataUpdatedAt: q.state.dataUpdatedAt });
  expect(h.signatureReads()).toBe(before + 1);
  expect(h.reader.current()).toBe(h.reader.snapshot);
});
it("whole-reader bounded nonce exhaustion retains original pins and refuses refresh instead of pruning history", () => {
  const h = harness(),
    original = h.reader.origin,
    guard = h.guard();
  for (let n = 1; n <= RUN_START_READ_BOUNDS.retiredNonces + 1; n++)
    guard.revokeCache(`2eeeec04-4d34-40bf-b0e9-${String(n).padStart(12, "0")}`);
  h.render();
  expect(h.reader.snapshot).toBeNull();
  expect(h.reader.current()).toBeNull();
  expect(h.reader.refresh()).toBe(false);
  expect(h.reader.origin).toBe(original);
  expect(h.reader.error).toContain("bounded activation history");
});
it("render observation revokes captured handlers before layout; close/reopen never auto-refreshes", () => {
  const h = harness(),
    old = h.reader;
  h.params.active = false;
  h.beforeLayout();
  expect(old.current()).toBeNull();
  expect(old.refresh()).toBe(false);
  h.render();
  h.params.active = true;
  h.render();
  expect(h.reader.current()).toBeNull();
  h.reader.refresh();
  h.render();
  expect(h.reader.current()).toBe(h.reader.snapshot);
  expect(old.current()).toBeNull();
});
it("changed project/org/Clerk is not a new bootstrap within the mounted reader", () => {
  for (const field of ["projectId", "organizationId"] as const) {
    const h = harness(),
      origin = h.reader.origin;
    h.params[field] = "other";
    h.render();
    expect(h.reader.current()).toBeNull();
    expect(h.reader.refresh()).toBe(false);
    expect(h.reader.origin).toBe(origin);
  }
  const h = harness();
  h.auth.userId = "other";
  h.sdk.session = { id: "A", user: { id: "other" } };
  h.emit();
  h.render();
  expect(h.reader.current()).toBeNull();
  expect(h.reader.refresh()).toBe(false);
});
it("resource replacement and adapter disappearance never reuse cache or auto-adopt identity", () => {
  const h = harness(),
    old = h.reader;
  h.setAdapter(undefined);
  h.render();
  expect(h.reader.current()).toBeNull();
  expect(old.current()).toBeNull();
  h.setAdapter(h.adapter);
  h.render();
  expect(h.reader.current()).toBeNull();
  h.reader.refresh();
  h.render();
  expect(h.reader.current()).toBe(h.reader.snapshot);
  h.context.window.Clerk = { ...h.sdk };
  expect(h.reader.current()).toBeNull();
  h.render();
  expect(h.reader.current()).toBeNull();
  h.context.window.Clerk = h.sdk;
  h.render();
  expect(h.reader.current()).toBeNull();
  h.reader.refresh();
  h.render();
  expect(h.reader.current()).toBe(h.reader.snapshot);
});
it("installed query cache A-B-A cannot revive old object/nonce", () => {
  const h = harness(),
    old = h.reader,
    restore = h.replaceCache();
  expect(old.current()).toBeNull();
  h.render();
  expect(h.reader.current()).toBeNull();
  restore();
  h.render();
  expect(h.reader.current()).toBeNull();
  h.reader.refresh();
  h.render();
  expect(h.reader.current()).toBe(h.reader.snapshot);
});
it("layout cannot publish after SDK revocation between render and commit", () => {
  const h = harness(),
    old = h.reader;
  h.beforeCommit(() => {
    h.sdk.session = { id: "B", user: { id: "cl" } };
    h.emit();
    h.sdk.session = { id: "A", user: { id: "cl" } };
    h.emit();
  });
  h.render();
  expect(old.current()).toBeNull();
  expect(h.reader.current()).toBeNull();
});
it("silent SDK change between render and layout withholds all public metadata before paint and latches the old nonce", () => {
  const h = harness();
  h.reader.readPreview();
  h.render();
  const old = h.reader,
    original = old.origin,
    nonce = old.snapshot!.data.readContext.requestId;
  expect(old.canStartMetadata).toBe(true);
  h.beforeCommit(() => {
    h.sdk.session = { id: "B", user: { id: "cl" } };
  });
  h.render();
  expect(h.reader.snapshot).toBeNull();
  expect(h.reader.fresh).toBeNull();
  expect(h.reader.readable).toBe(false);
  expect(h.reader.canStartMetadata).toBe(false);
  expect(h.reader.canRecoverMetadata).toBe(false);
  expect(h.reader.origin).toBe(original);
  expect(old.current()).toBeNull();
  h.sdk.session = { id: "A", user: { id: "cl" } };
  h.render();
  expect(h.reader.snapshot).toBeNull();
  expect(h.reader.refresh()).toBe(true);
  h.render();
  expect(h.reader.current()).toBe(h.reader.snapshot);
  expect(h.reader.snapshot!.data.readContext.requestId).not.toBe(nonce);
  expect(h.reader.origin).toBe(original);
});
it("silent cache body mutation between render and layout withholds public metadata before paint", () => {
  const h = harness();
  h.reader.readPreview();
  h.render();
  const old = h.reader;
  const q = h.client
    .getQueryCache()
    .getAll()
    .find(
      (q) =>
        q.queryKey[1] === "PREVIEW" &&
        (q.queryKey[2] as RunStartReadInput).requestId ===
          old.snapshot!.data.readContext.requestId,
    )!;
  h.beforeCommit(() => {
    (q.state.data as { limitations: string[] }).limitations.push(
      "changed after rendering",
    );
  });
  h.render();
  expect(h.reader.snapshot).toBeNull();
  expect(h.reader.fresh).toBeNull();
  expect(h.reader.canStartMetadata).toBe(false);
  expect(old.current()).toBeNull();
});
it("throwing unsubscribe executes only after private cache/session/frame authority is gone", () => {
  const h = harness(),
    old = h.reader;
  h.cleanup.work = () => {
    expect(old.current()).toBeNull();
    expect(old.refresh()).toBe(false);
    throw Error("PRIVATE_CLEANUP");
  };
  expect(() => h.unmount()).not.toThrow();
  expect(old.current()).toBeNull();
  expect(old.readPreview()).toBe(false);
});
it("absent/invalid adapter stays withheld and fixed hook order has no mutation/controller/body adoption", () => {
  const h = harness();
  h.setAdapter({ ...h.adapter, key: () => [() => "private"] });
  h.render();
  expect(h.reader.current()).toBeNull();
  expect(h.requests.slice(-2).every((r) => !r.enabled)).toBe(true);
  expect(source).not.toContain("useMutation");
  expect(source).not.toContain("run-config-completion");
  expect(source).not.toContain("RouterInputs");
});
