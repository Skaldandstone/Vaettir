import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { expect, it } from "vitest";
import { currentSessionScope, sameAuthScope } from "./auth-query-cache";
import {
  admitManualRunCurrent,
  ManualRunCurrentRenderGuard,
  sameManualRunCurrentOrigin,
  manualRunCurrentBrowserKey,
  type ManualRunCurrentInput,
  type ManualRunCurrentWire,
} from "./manual-run-current-reader";
import type { useManualRunCurrentReader } from "./use-manual-run-current-reader";
const source = readFileSync(
    new URL("./use-manual-run-current-reader.ts", import.meta.url),
    "utf8",
  ),
  ast = ts.createSourceFile("actual.ts", source, ts.ScriptTarget.Latest, true),
  functions = ast.statements
    .filter(ts.isFunctionDeclaration)
    .map((node) =>
      ts
        .createPrinter()
        .printNode(ts.EmitHint.Unspecified, node, ast)
        .replace(/\bexport\s+/, ""),
    )
    .join("\n"),
  code = ts.transpileModule(
    `${functions}\nthis.hook=useManualRunCurrentReader;`,
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.None,
      },
    },
  ).outputText;
type State = {
  error: unknown;
  isFetching: boolean;
  isPaused: boolean;
  isFetchedAfterMount: boolean;
  wrong: string | null;
  revision: number;
};
type Options = {
  enabled: boolean;
  retry: boolean;
  staleTime: number;
  refetchOnWindowFocus: boolean;
};
type Slot = { value?: unknown; deps?: unknown[]; cleanup?: () => void };
type Reader = ReturnType<typeof useManualRunCurrentReader>;
function harness(
  initialWrong: string | null = null,
  listenerMode: "installed" | "missing" | "throws" | "void" = "installed",
) {
  let cleanupCallback: (() => void) | null = null;
  const auth = {
      isLoaded: true,
      isSignedIn: true,
      userId: "cl",
      sessionId: "A",
    },
    params = {
      projectId: "p",
      testRunId: "run",
      organizationId: "o",
      active: true,
      ready: true,
    },
    state: State = {
      error: null,
      isFetching: false,
      isPaused: false,
      isFetchedAfterMount: true,
      wrong: initialWrong,
      revision: 1,
    },
    listeners = new Set<() => void>(),
    cacheListeners = new Set<() => void>(),
    sdk: {
      loaded: boolean;
      session: null | { id: string; user: { id: string } };
      addListener?: (listener: () => void) => unknown;
    } = {
      loaded: true,
      session: { id: "A", user: { id: "cl" } } as null | {
        id: string;
        user: { id: string };
      },
      addListener: (listener: () => void) => {
        listeners.add(listener);
        listener();
        return () => {
          listeners.delete(listener);
          cleanupCallback?.();
        };
      },
    };
  const originalListener = sdk.addListener!;
  if (listenerMode === "missing") delete sdk.addListener;
  if (listenerMode === "throws")
    sdk.addListener = () => {
      throw Error("private SDK failure");
    };
  if (listenerMode === "void") sdk.addListener = () => undefined;
  const requests: Array<{ input: ManualRunCurrentInput; options: Options }> =
      [],
    cache = new Map<string, unknown>(),
    entries = new Map<string, ManualRunCurrentInput>(),
    slots: Slot[] = [],
    effects = new Map<number, () => void>();
  let cursor = 0,
    dirty = false,
    uuid = 0,
    reader: Reader,
    dead = false,
    beforeCommit: (() => void) | null = null;
  function equal(a: unknown[], b: unknown[] | undefined) {
    return (
      !!b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]))
    );
  }
  function dto(input: ManualRunCurrentInput) {
    const key = JSON.stringify([
        manualRunCurrentBrowserKey(input),
        state.wrong,
      ]),
      prior = cache.get(key);
    if (prior) return prior;
    const raw: ManualRunCurrentWire = {
      readContext: {
        requestId:
          state.wrong === "nonce"
            ? "6ee2ec04-4d34-40bf-b0e9-000000999999"
            : input.requestId,
        requestedKey:
          state.wrong === "key" ? "other" : manualRunCurrentBrowserKey(input),
        projection: "CURRENT_WHOLE_MANUAL_RUN_VIEW",
        scope: {
          projectId: input.projectId,
          testRunId: input.testRunId,
          organizationId: state.wrong === "org" ? "foreign" : "o",
          actorId: state.wrong === "native" ? "replacement" : "n",
          actorClerkUserId: state.wrong === "Clerk" ? "other" : "cl",
        },
      },
      view: {
        testRunId: input.testRunId,
        projectId: input.projectId,
        organizationId: "o",
        originalOrganizationId: "o",
        actorId: "n",
        clerkActorId: "cl",
        canWrite: false,
        readRequestKey: JSON.stringify({
          testRunId: input.testRunId,
          projectId: input.projectId,
          originalOrganizationId: input.originalOrganizationId,
          expectedClerkActorId: input.expectedClerkActorId,
        }),
        plannedCaseIds: ["case"],
        unavailableCases: [],
        scopeAvailability: {
          plannedCount: 1,
          availableCount: 1,
          unavailableCount: 0,
          complete: true,
          procedureBasis: "LEGACY_CURRENT_CASE_DEFINITIONS",
        },
        status: "RUNNING",
        stepFieldLabels: {},
        executionContext: null,
        datasetBatchRuns: [],
        cases: [
          {
            testCaseId: "case",
            displayId: null,
            title: "Private fixture title",
            background: null,
            prerequisiteIds: [],
            validationDomain: "SOFTWARE",
            verificationProfile: {
              setup: "",
              safety: "",
              instruments: "",
              acceptanceCriteria: "",
            },
            given: [""],
            when: [],
            then: [],
            steps: [
              {
                order: 7,
                action: " action\n ",
                expectedActionOrData: "",
                expectedResult: null,
                expectedResponse: " response ",
                mediaAttachmentIds: [],
              },
            ],
            stepExecutionAvailable: false,
            stepResults: [],
            currentResult: null,
          },
        ],
      },
      provenance: {
        procedures: "LEGACY_CURRENT_CASE_DEFINITIONS",
        observations: "CURRENT_SUPPORTED_API_VIEW_NOT_RAW_NATIVE_JSON",
        history: "CURRENT_HEADS_NOT_COMPLETE_REVISION_HISTORY",
        media: "IDENTIFIER_REFERENCES_NO_FILES_FETCHED",
      },
    };
    if (state.wrong === "unknown") Object.assign(raw, { futurePrivate: true });
    if (state.wrong === "count") raw.view.scopeAvailability.plannedCount = 2;
    if (state.wrong === "unavailable") {
      raw.view.plannedCaseIds.push("missing");
      raw.view.unavailableCases = [
        { testCaseId: "missing", reason: "MISSING_CASE_AND_FROZEN_DEFINITION" },
      ];
      Object.assign(raw.view.scopeAvailability, {
        plannedCount: 2,
        unavailableCount: 1,
        complete: false,
      });
    }
    if (state.wrong === "empty") {
      raw.view.plannedCaseIds = [];
      raw.view.cases = [];
      Object.assign(raw.view.scopeAvailability, {
        plannedCount: 0,
        availableCount: 0,
      });
    }
    const data = state.wrong === "NULL" ? null : raw;
    cache.set(key, data);
    return data;
  }
  const client = {
    getQueryCache: () => ({
      subscribe: (listener: () => void) => {
        cacheListeners.add(listener);
        return () => cacheListeners.delete(listener);
      },
    }),
    getQueryState: (key: unknown) => {
      const input = entries.get(JSON.stringify(key));
      return input
        ? {
            status: state.error ? "error" : "success",
            fetchStatus: state.isPaused
              ? "paused"
              : state.isFetching
                ? "fetching"
                : "idle",
            data: dto(input),
            dataUpdatedAt: state.revision,
          }
        : undefined;
    },
  };
  const context = vm.createContext({
    window: { Clerk: sdk },
    crypto: {
      randomUUID: () =>
        `6ee2ec04-4d34-40bf-b0e9-${String(++uuid).padStart(12, "0")}`,
    },
    currentSessionScope,
    sameAuthScope,
    admitManualRunCurrent,
    ManualRunCurrentRenderGuard,
    sameManualRunCurrentOrigin,
    useAuth: () => auth,
    useQueryClient: () => client,
    getQueryKey: (_procedure: unknown, input: ManualRunCurrentInput) => [
      "current",
      input,
    ],
    useState: (initial: unknown) => {
      const at = cursor++;
      if (!slots[at])
        slots[at] = {
          value: typeof initial === "function" ? initial() : initial,
        };
      return [
        slots[at]!.value,
        (value: unknown) => {
          if (dead) throw Error("State after unmount");
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
      manualRunReads: {
        current: {
          useQuery: (input: ManualRunCurrentInput, options: Options) => {
            requests.push({ input, options });
            entries.set(JSON.stringify(["current", input]), input);
            return {
              ...state,
              data: dto(input),
              dataUpdatedAt: state.revision,
            };
          },
        },
      },
    },
  });
  vm.runInContext(code, context);
  const hook = context.hook as typeof useManualRunCurrentReader;
  function render() {
    for (let i = 0; i < 60; i++) {
      cursor = 0;
      dirty = false;
      effects.clear();
      reader = hook(params.projectId, params.testRunId, params.organizationId, {
        active: params.active,
        ready: params.ready,
      });
      if (dirty) continue;
      const callback = beforeCommit;
      beforeCommit = null;
      callback?.();
      for (const effect of effects.values()) effect();
      if (!dirty) return reader;
    }
    throw Error("Reader did not settle");
  }
  function setSDK(session: string | null, userId = "cl") {
    sdk.session = session ? { id: session, user: { id: userId } } : null;
    for (const callback of [...listeners]) callback();
  }
  render();
  return {
    auth,
    params,
    state,
    sdk,
    listeners,
    cacheListeners,
    requests,
    setSDK,
    restoreListener: () => {
      sdk.addListener = originalListener;
    },
    cleanupCallback: (callback: () => void) => {
      cleanupCallback = callback;
    },
    rejectNextInstallation: () => {
      sdk.addListener = (listener: () => void) => {
        const cleanup = originalListener(listener);
        context.window.Clerk = { loaded: true, session: sdk.session };
        return cleanup;
      };
    },
    replaceSDK: () => {
      const replacementListeners = new Set<() => void>();
      const replacement = {
        loaded: true,
        session: { id: "A", user: { id: "cl" } },
        addListener: (listener: () => void) => {
          replacementListeners.add(listener);
          listener();
          return () => replacementListeners.delete(listener);
        },
      };
      context.window.Clerk = replacement;
      return {
        replacement,
        replacementListeners,
        restore: () => {
          context.window.Clerk = sdk;
        },
      };
    },
    render,
    emitCache: () => {
      for (const callback of [...cacheListeners]) callback();
    },
    beforeCommit: (callback: () => void) => {
      beforeCommit = callback;
    },
    unmount: () => {
      dead = true;
      for (const slot of slots) slot.cleanup?.();
    },
    get reader() {
      return reader;
    },
  };
}
it("actual native-shaped completed nonce/scope read pins native origin/session and full supported view, no case-field schema/native/provider calls", () => {
  const h = harness();
  expect(h.reader.origin).toEqual({
    projectId: "p",
    testRunId: "run",
    organizationId: "o",
    clerkActorId: "cl",
    nativeActorId: "n",
  });
  expect(h.reader.observedSessionId).toBe("A");
  expect(h.reader.fresh!.cases[0]!.steps[0]!.expectedActionOrData).toBe("");
  expect(h.reader.fresh!.cases[0]!.steps[0]!.expectedResult).toBeNull();
  expect(h.reader.current()).toBe(h.reader.snapshot);
  expect(h.requests.at(-1)!.options.enabled).toBe(true);
});
it.each(["missing", "throws", "void"] as const)(
  "SDK listener %s cannot admit/cache-authorize a native read; explicit installation retry retains original intent",
  (mode) => {
    const h = harness(null, mode);
    expect(h.reader.fresh).toBeNull();
    expect(h.reader.current()).toBeNull();
    expect(h.reader.origin).toBeNull();
    expect(h.requests.every((request) => !request.options.enabled)).toBe(true);
    expect(h.reader.error ?? "").not.toContain("private SDK failure");
    h.params.projectId = "foreign";
    h.render();
    expect(h.reader.refresh()).toBe(false);
    h.params.projectId = "p";
    h.render();
    h.restoreListener();
    expect(h.reader.refresh()).toBe(false); // installation only, not native authority
    h.render();
    expect(h.reader.current()).toBe(h.reader.snapshot);
    expect(h.reader.fresh).not.toBeNull();
  },
);
it("SDK object replacement with the SAME user/session revokes old actions before React commit and A-B-A cannot revive the old installation", () => {
  const h = harness(),
    old = h.reader,
    nonce = old.snapshot!.data.readContext.requestId;
  const replacement = h.replaceSDK();
  expect(old.current()).toBeNull();
  expect(old.refresh()).toBe(false);
  replacement.restore();
  expect(old.current()).toBeNull();
  h.render();
  expect(h.reader.fresh).toBeNull();
  expect(h.reader.refresh()).toBe(true);
  h.render();
  expect(h.reader.snapshot!.data.readContext.requestId).not.toBe(nonce);
});
it("SDK object replacement observed during render installs independent monitoring but requires explicit native refresh; retired listeners cannot publish", () => {
  const h = harness(),
    oldListeners = [...h.listeners],
    origin = h.reader.origin;
  const replacement = h.replaceSDK();
  h.render();
  expect(h.listeners.size).toBe(0);
  expect(replacement.replacementListeners.size).toBe(1);
  expect(h.reader.fresh).toBeNull();
  for (const callback of oldListeners) callback();
  expect(h.reader.fresh).toBeNull();
  expect(h.reader.refresh()).toBe(true);
  h.render();
  expect(h.reader.origin).toBe(origin);
  expect(h.reader.current()).toBe(h.reader.snapshot);
  const retired = [...replacement.replacementListeners];
  h.unmount();
  expect(replacement.replacementListeners.size).toBe(0);
  expect(() => {
    for (const callback of retired) callback();
  }).not.toThrow();
});
it("SDK object replacement between render and posted layout cannot publish the old proof even after pointer A-B-A", () => {
  const h = harness(),
    old = h.reader;
  h.state.revision = 2;
  h.beforeCommit(() => {
    const replacement = h.replaceSDK();
    expect(old.current()).toBeNull();
    replacement.restore();
    expect(old.current()).toBeNull();
  });
  h.render();
  expect(h.reader.current()).toBeNull();
  expect(h.reader.fresh).toBeNull();
  expect(h.reader.refresh()).toBe(true);
  h.render();
  expect(h.reader.current()).toBe(h.reader.snapshot);
});
it("installed listener detects SDK replacement without a React auth update; old resource A-B-A needs another exact native nonce", () => {
  const h = harness(),
    old = h.reader,
    listeners = [...h.listeners];
  const replacement = h.replaceSDK();
  for (const callback of listeners) callback();
  expect(old.current()).toBeNull();
  replacement.restore();
  for (const callback of listeners) callback();
  h.render();
  expect(h.reader.fresh).toBeNull();
  expect(h.reader.refresh()).toBe(true);
  h.render();
  expect(h.reader.current()).toBe(h.reader.snapshot);
});
it("action-time SDK session mismatch revokes monotonically even before its installed listener receives a notification", () => {
  const h = harness(),
    old = h.reader;
  h.sdk.session = { id: "B", user: { id: "cl" } };
  expect(old.current()).toBeNull();
  h.sdk.session = { id: "A", user: { id: "cl" } };
  expect(old.current()).toBeNull();
  h.render();
  expect(h.reader.fresh).toBeNull();
  expect(h.reader.refresh()).toBe(true);
  h.render();
  expect(h.reader.current()).toBe(h.reader.snapshot);
});
it("SDK cleanup revokes before invoking captured handlers and suppresses throwing cleanup without losing original pins", () => {
  const h = harness(),
    old = h.reader,
    origin = old.origin;
  let calls = 0;
  h.cleanupCallback(() => {
    calls++;
    expect(old.current()).toBeNull();
    expect(old.refresh()).toBe(false);
    throw Error("private cleanup exception");
  });
  h.auth.sessionId = "renewed";
  h.setSDK("renewed");
  expect(() => h.render()).not.toThrow();
  expect(calls).toBe(1);
  expect(h.reader.fresh).toBeNull();
  expect(h.reader.origin).toBe(origin);
  expect(h.reader.refresh()).toBe(true);
  h.render();
  expect(h.reader.current()).toBe(h.reader.snapshot);
  expect(() => h.unmount()).not.toThrow();
});
it("a real SDK cleanup returned by a rejected registration is invoked after revocation, even when it throws or calls old handlers", () => {
  const h = harness(),
    old = h.reader;
  let calls = 0;
  h.cleanupCallback(() => {
    calls++;
    expect(old.current()).toBeNull();
    expect(old.refresh()).toBe(false);
    throw Error("private rejected-registration cleanup");
  });
  h.rejectNextInstallation();
  h.auth.sessionId = "renewed";
  h.setSDK("renewed");
  expect(() => h.render()).not.toThrow();
  expect(calls).toBe(2); // old installation, then rejected new installation
  expect(h.listeners.size).toBe(0);
  expect(h.reader.current()).toBeNull();
  expect(h.reader.fresh).toBeNull();
});
it.each(["nonce", "key", "native", "Clerk", "org", "NULL", "unknown", "count"])(
  "%s invalid read withholds full private view but preserves original native intent for explicit fresh refresh",
  (wrong) => {
    const h = harness(),
      origin = h.reader.origin;
    h.state.wrong = wrong;
    expect(h.render().fresh).toBeNull();
    expect(h.reader.current()).toBeNull();
    expect(h.reader.origin).toBe(origin);
    expect(h.reader.refresh()).toBe(true);
  },
);
it.each(["error", "isFetching", "isPaused", "isFetchedAfterMount"])(
  "%s current query cannot publish stale private metadata or arbitrary errors",
  (key) => {
    const h = harness();
    Object.assign(h.state, {
      [key]:
        key === "error"
          ? Error("private-native-error")
          : key !== "isFetchedAfterMount",
    });
    expect(h.render().fresh).toBeNull();
    expect(h.reader.current()).toBeNull();
    expect(h.reader.error ?? "").not.toContain("private-native-error");
  },
);
it("observer fetched-after-mount A-B-A cannot resurrect a previously admitted whole view without another explicit native nonce", () => {
  const h = harness(),
    nonce = h.reader.snapshot!.data.readContext.requestId;
  h.state.isFetchedAfterMount = false;
  h.render();
  expect(h.reader.fresh).toBeNull();
  h.state.isFetchedAfterMount = true;
  h.render();
  expect(h.reader.fresh).toBeNull();
  expect(h.reader.refresh()).toBe(true);
  h.render();
  expect(h.reader.snapshot!.data.readContext.requestId).not.toBe(nonce);
});
it("installed SDK changes WITHOUT useAuth update immediately deny current/refresh; SDK A-B-A cannot revive private read without new native echo", () => {
  const h = harness(),
    old = h.reader,
    nonce = old.snapshot!.data.readContext.requestId;
  h.setSDK("B");
  expect(h.auth.sessionId).toBe("A");
  expect(old.current()).toBeNull();
  expect(old.refresh()).toBe(false);
  h.setSDK("A");
  expect(old.current()).toBeNull();
  h.render();
  expect(h.reader.fresh).toBeNull();
  expect(h.reader.refresh()).toBe(true);
  h.render();
  expect(h.reader.fresh).not.toBeNull();
  expect(h.reader.snapshot!.data.readContext.requestId).not.toBe(nonce);
});
it("renewed same actor session requires EXPLICIT native refresh with original native pin, not automatic adoption", () => {
  const h = harness(),
    origin = h.reader.origin;
  h.setSDK("renewed");
  h.auth.sessionId = "renewed";
  h.render();
  expect(h.reader.fresh).toBeNull();
  expect(h.reader.refresh()).toBe(true);
  h.render();
  expect(h.reader.observedSessionId).toBe("renewed");
  expect(h.reader.origin).toBe(origin);
  expect(h.requests.at(-1)!.input.expectedNativeActorId).toBe("n");
});
it.each(["project", "run", "org", "account", "active", "ready"])(
  "original %s A-B-A does not rebase native identity or resurrect cached body; unrelated exact write buffers remain untouched",
  (kind) => {
    const h = harness(),
      origin = h.reader.origin,
      buffer = {
        note: null,
        decimal: "0.10000000000000001",
        request: { requestId: "write-original", body: ["exact"] },
      },
      before = structuredClone(buffer);
    if (kind === "project") h.params.projectId = "other";
    if (kind === "run") h.params.testRunId = "other";
    if (kind === "org") h.params.organizationId = "other";
    if (kind === "active") h.params.active = false;
    if (kind === "ready") h.params.ready = false;
    if (kind === "account") {
      h.auth.userId = "other";
      h.auth.sessionId = "B";
      h.setSDK("B", "other");
    }
    h.render();
    expect(h.reader.fresh).toBeNull();
    expect(h.reader.refresh()).toBe(false);
    h.params.projectId = "p";
    h.params.testRunId = "run";
    h.params.organizationId = "o";
    h.params.active = true;
    h.params.ready = true;
    h.auth.userId = "cl";
    h.auth.sessionId = "A";
    h.setSDK("A");
    h.render();
    expect(h.reader.fresh).toBeNull();
    expect(h.reader.origin).toBe(origin);
    expect(h.reader.refresh()).toBe(true);
    h.render();
    expect(h.reader.fresh).not.toBeNull();
    expect(buffer).toEqual(before);
  },
);
it("first unsupported native body cannot let a different account/project rebase the already captured original read intent", () => {
  const h = harness("unknown");
  expect(h.reader.origin).toBeNull();
  h.params.projectId = "other";
  h.auth.userId = "other";
  h.auth.sessionId = "B";
  h.setSDK("B", "other");
  h.render();
  expect(h.reader.refresh()).toBe(false);
  h.params.projectId = "p";
  h.auth.userId = "cl";
  h.auth.sessionId = "A";
  h.setSDK("A");
  h.render();
  h.state.wrong = null;
  expect(h.reader.refresh()).toBe(true);
  h.render();
  expect(h.reader.fresh).not.toBeNull();
});
it.each(["error", "isFetching", "isPaused", "wrong"])(
  "query-cache %s A-B-A without a React commit is monotonically revoked, even restored exact identity/revision is not authority",
  (key) => {
    const h = harness(),
      old = h.reader,
      prior = { ...h.state };
    Object.assign(h.state, {
      [key]:
        key === "error"
          ? Error("private-refusal")
          : key === "wrong"
            ? "nonce"
            : true,
    });
    h.emitCache();
    expect(old.current()).toBeNull();
    Object.assign(h.state, prior);
    h.emitCache();
    expect(old.current()).toBeNull();
    h.render();
    expect(h.reader.fresh).toBeNull();
    expect(h.reader.refresh()).toBe(true);
    h.render();
    expect(h.reader.fresh).not.toBeNull();
  },
);
it.each(["active", "ready", "intent", "data"])(
  "render %s revokes old handlers before layout publishes any candidate",
  (kind) => {
    const h = harness(),
      old = h.reader;
    if (kind === "active") h.params.active = false;
    if (kind === "ready") h.params.ready = false;
    if (kind === "intent") old.refresh();
    if (kind === "data") h.state.wrong = "count";
    h.beforeCommit(() => {
      expect(old.current()).toBeNull();
      expect(old.refresh()).toBe(false);
    });
    h.render();
  },
);
it("SDK/query-cache A-B-A between render and posted layout cannot rebind a revoked whole native view", () => {
  for (const type of ["SDK", "cache"]) {
    const h = harness(),
      old = h.reader;
    h.state.revision = 2;
    h.beforeCommit(() => {
      if (type === "SDK") {
        h.setSDK("B");
        h.setSDK("A");
      } else {
        h.state.isFetching = true;
        h.emitCache();
        h.state.isFetching = false;
        h.emitCache();
      }
      expect(old.current()).toBeNull();
    });
    h.render();
    expect(h.reader.fresh).toBeNull();
    expect(h.reader.current()).toBeNull();
    expect(h.reader.refresh()).toBe(true);
    h.render();
    expect(h.reader.fresh).not.toBeNull();
  }
});
it("captured old handlers stay refused AFTER a later valid committed frame; only that frame may refresh or expose its exact snapshot", () => {
  const h = harness(),
    old = h.reader;
  expect(old.refresh()).toBe(true);
  h.render();
  const current = h.reader,
    nonce = current.snapshot!.data.readContext.requestId;
  expect(current.current()).toBe(current.snapshot);
  expect(old.current()).toBeNull();
  expect(old.refresh()).toBe(false);
  expect(h.requests.at(-1)!.input.requestId).toBe(nonce);
  h.setSDK("renewed");
  h.auth.sessionId = "renewed";
  h.render();
  expect(h.reader.refresh()).toBe(true);
  h.render();
  expect(current.current()).toBeNull();
  expect(current.refresh()).toBe(false);
  expect(h.reader.current()).toBe(h.reader.snapshot);
});
it("action-time query inspection refuses without waiting for listener/React state, and original refresh can recover", () => {
  const h = harness(),
    old = h.reader;
  h.state.isFetching = true;
  expect(old.current()).toBeNull();
  h.state.isFetching = false;
  expect(old.current()).toBeNull();
  h.render();
  expect(h.reader.fresh).toBeNull();
  expect(h.reader.refresh()).toBe(true);
  h.render();
  expect(h.reader.fresh).not.toBeNull();
});
it("unavailable planned identity and genuine empty native scope remain explicit full wire reads, not zero substitution", () => {
  const h = harness("unavailable");
  expect(h.reader.fresh!.scopeAvailability.plannedCount).toBe(2);
  expect(h.reader.fresh!.unavailableCases).toHaveLength(1);
  expect(h.reader.fresh!.cases).toHaveLength(1);
  const empty = harness("empty");
  expect(empty.reader.fresh!.plannedCaseIds).toEqual([]);
  expect(empty.reader.refresh()).toBe(true);
});
it("dead SDK/cache subscribers and old refresh handler cannot publish after unmount", () => {
  const h = harness(),
    old = h.reader,
    listeners = [...h.listeners],
    cacheListeners = [...h.cacheListeners];
  h.unmount();
  expect(h.listeners.size).toBe(0);
  expect(h.cacheListeners.size).toBe(0);
  h.sdk.session = { id: "B", user: { id: "cl" } };
  expect(() => {
    for (const callback of [...listeners, ...cacheListeners]) callback();
  }).not.toThrow();
  expect(old.current()).toBeNull();
  expect(old.refresh()).toBe(false);
});
it.each(["isLoaded", "isSignedIn"] as const)(
  "hook %s=false cannot use SDK's old session as native read authority",
  (key) => {
    const h = harness();
    h.auth[key] = false;
    h.render();
    expect(h.reader.fresh).toBeNull();
    expect(h.reader.refresh()).toBe(false);
    expect(h.requests.at(-1)!.options.enabled).toBe(false);
  },
);
