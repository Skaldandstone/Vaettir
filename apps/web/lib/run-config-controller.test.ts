// Execute the ACTUAL modal function with synthetic hook/Clerk/RPC adapters.
// No browser authentication, network, database or production proof is implied.
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createHash } from "node:crypto";
import ts from "typescript";
import React from "react";
import { describe, expect, it } from "vitest";
import {
  RunConfigCompletionController,
  emptyRunStartCompletion,
} from "./run-config-completion";
import { currentSessionScope } from "./auth-query-cache";
import {
  freezeRunConfiguration,
  MAX_MANUAL_CASES,
  reviewedRunCasesMatch,
  type ReviewedRunConfiguration,
} from "./run-configuration-request";
import { applyRunBulkSelection } from "./run-bulk-selection";
import {
  admitRunStartRead,
  runStartReadIdentity,
  runStartReviewedReadKey,
  type RunStartReadSnapshot,
} from "./manual-run-start-reviewed-reader";
import type { ReviewedRunStartEnvelope } from "./run-start-reviewed-write";
const source = readFileSync(
  new URL("../components/RunConfigurationModal.tsx", import.meta.url),
  "utf8",
);
const ast = ts.createSourceFile(
  "modal.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const component = ast.statements.find(
  (node) =>
    ts.isFunctionDeclaration(node) &&
    node.name?.text === "RunConfigurationModal",
)!;
const constants = ast.statements.filter(
  (node) =>
    ts.isVariableStatement(node) &&
    node.declarationList.declarations.some(
      (declaration) =>
        ts.isIdentifier(declaration.name) &&
        ["labels", "emptyContext"].includes(declaration.name.text),
    ),
);
const screens = ast.statements.find(
  (node) => ts.isFunctionDeclaration(node) && node.name?.text === "screensFor",
)!;
const compiled = ts.transpileModule(
  `${[...constants, screens, component]
    .map((node) =>
      ts
        .createPrinter()
        .printNode(ts.EmitHint.Unspecified, node, ast)
        .replace(/^export /, ""),
    )
    .join("\n")}\nthis.component = RunConfigurationModal;`,
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.React,
      module: ts.ModuleKind.None,
    },
  },
).outputText;
const sdkSource = readFileSync(
    new URL("./run-start-reviewed-write.ts", import.meta.url),
    "utf8",
  ),
  sdkAST = ts.createSourceFile(
    "sdk.ts",
    sdkSource,
    ts.ScriptTarget.Latest,
    true,
  );
const sdkCode = ts.transpileModule(
  ts
    .createPrinter()
    .printNode(
      ts.EmitHint.Unspecified,
      sdkAST.statements.find(
        (n) =>
          ts.isFunctionDeclaration(n) && n.name?.text === "safeRunStartSDKRead",
      )!,
      sdkAST,
    )
    .replace(/\bexport\s+/, ""),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
    },
  },
).outputText;
function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<unknown>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
type Element = {
  type: unknown;
  props: {
    children?: unknown;
    onClick?: () => unknown;
    onChange?: (event: unknown) => unknown;
    disabled?: boolean;
    id?: string;
    value?: string;
  };
};
function children(node: unknown): Element[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(children);
  const current = node as Element;
  return current.props ? [current, ...children(current.props.children)] : [];
}
function text(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  return node && typeof node === "object" && "props" in node
    ? text((node as Element).props.children)
    : "";
}
function harness(
  monitorMode: "normal" | "absent" | "void" | "throw" = "normal",
) {
  const hooks: unknown[] = [],
    effects: Array<() => void> = [],
    cleanups = new Map<number, () => void>();
  let cursor = 0,
    dirty = false,
    tree: unknown,
    uuid = 0,
    setterCalls = 0;
  const auth = {
    isLoaded: true,
    isSignedIn: true,
    userId: "clerk",
    sessionId: "session-A",
  };
  const access = {
    ready: true,
    canWrite: true,
    origin: { organizationId: "org", clerkActorId: "clerk" },
    refresh: async () => [
      {
        data: { id: "project", organizationId: "org" },
        isSuccess: true,
        fetchStatus: "idle",
        isError: false,
        isFetching: false,
        isPaused: false,
        isFetchedAfterMount: true,
      },
      {
        data: [{ id: "org", seatType: "FULL", role: "OWNER" }],
        isSuccess: true,
        fetchStatus: "idle",
        isError: false,
        isFetching: false,
        isPaused: false,
        isFetchedAfterMount: true,
      },
    ],
  };
  const permissions = {
    loaded: true,
    canEdit: true,
    accessError: null,
    retryAccess: () => {},
  };
  const query = {
    data: { experience: null, profileHash: "a".repeat(64) },
    error: null,
    isFetching: false,
    isPaused: false,
    isFetchedAfterMount: true,
    refetch: async () => ({
      data: query.data,
      isSuccess: true,
      fetchStatus: "idle",
      error: null,
      isError: false,
      isFetching: query.isFetching,
      isPaused: query.isPaused,
      isFetchedAfterMount: query.isFetchedAfterMount,
    }),
  };
  const listeners = new Set<() => void>();
  const addListener = (listener: () => void): unknown => {
    if (monitorMode === "throw") throw Error("Private listener diagnostic");
    listeners.add(listener);
    listener();
    if (monitorMode === "void") return undefined;
    return () => {
      listeners.delete(listener);
    };
  };
  const browser = {
    Clerk: {
      loaded: true,
      session: { id: auth.sessionId, user: { id: auth.userId } },
      addListener: monitorMode === "absent" ? undefined : addListener,
    },
  };
  const sent: ReviewedRunStartEnvelope[] = [],
    opened: unknown[] = [];
  let waiting: ReturnType<typeof deferred> | null = null,
    badAck = false;
  const props = {
    open: true,
    projectId: "project",
    caseCount: 2,
    testCaseIds: ["one", "two"],
    bulkScopes: [
      { key: "all", label: "Approved", testCaseIds: ["one", "two", "three"] },
    ],
    bulkScopesReady: true,
    onSelectionChange: (ids: string[]) => {
      props.testCaseIds = ids;
      props.caseCount = ids.length;
    },
    onClose: () => {
      props.open = false;
    },
    onStart: async (request: ReviewedRunStartEnvelope) => {
      sent.push(request);
      if (waiting) return waiting.promise;
      return acknowledgement(request);
    },
    onConfirmedStart: (ack: unknown, request: ReviewedRunConfiguration) =>
      opened.push({ ack, request }),
  };
  function acknowledgement(envelope: ReviewedRunStartEnvelope) {
    const request = envelope.request;
    return {
      mode: "START",
      currentScope: {
        projectId: envelope.projectId,
        organizationId: envelope.originalOrganizationId,
        actorId: envelope.expectedNativeActorId,
        actorClerkUserId: envelope.expectedClerkActorId,
      },
      idempotencyKey: request.idempotencyKey,
      legacyAck: {
        testRunId: `manual_${createHash("sha256")
          .update(
            JSON.stringify([
              envelope.projectId,
              envelope.expectedNativeActorId,
              request.idempotencyKey,
            ]),
          )
          .digest("hex")}`,
        originalOrganizationId: request.originalOrganizationId,
        expectedClerkActorId: request.expectedClerkActorId,
        idempotencyKey: badAck ? "wrong" : request.idempotencyKey,
      },
      historicalOuterProvenance: "UNRECORDED",
      interpretation: "LEGACY_NORMALIZED_NOT_RAW_LOSSLESS",
    };
  }
  const nativeState = {
    blocked: false,
    projection: "PREVIEW" as "ACCESS" | "PREVIEW",
    nonce: 1,
    nativeActorId: "native",
    unsupported: false,
    full: true,
  };
  const metadataRows = new Map<string, RunStartReadSnapshot>();
  function currentMetadata(): RunStartReadSnapshot | null {
    if (
      !props.open ||
      !auth.isSignedIn ||
      !access.ready ||
      !access.canWrite ||
      !permissions.canEdit ||
      nativeState.blocked ||
      query.error ||
      query.isFetching ||
      query.isPaused ||
      !query.isFetchedAfterMount
    ) {
      if (!props.open || !permissions.canEdit || !access.canWrite)
        nativeState.blocked = true;
      return null;
    }
    try {
      if (
        browser.Clerk.session.id !== auth.sessionId ||
        browser.Clerk.session.user.id !== auth.userId
      )
        return null;
    } catch {
      return null;
    }
    const key = JSON.stringify([nativeState, query.data, auth.sessionId]);
    const existing = metadataRows.get(key);
    if (existing) return existing;
    const input = {
      projectId: "project",
      originalOrganizationId: "org",
      expectedClerkActorId: "clerk",
      expectedNativeActorId: nativeState.nativeActorId,
      requestId: `10000000-0000-4000-8000-${String(nativeState.nonce).padStart(12, "0")}`,
    };
    const readContext = {
      projection: nativeState.projection,
      requestId: input.requestId,
      requestedKey: runStartReviewedReadKey(input, nativeState.projection),
      scope: {
        projectId: "project",
        organizationId: "org",
        actorId: nativeState.nativeActorId,
        actorClerkUserId: "clerk",
      },
    };
    const raw =
      nativeState.projection === "ACCESS"
        ? {
            readContext,
            canConfigure: nativeState.full,
            canRecover: nativeState.full,
          }
        : {
            readContext,
            canConfigure: nativeState.full,
            canRecover: nativeState.full,
            canStart: nativeState.full && !nativeState.unsupported,
            profile: nativeState.unsupported
              ? { kind: "UNSUPPORTED", reason: "PROFILE_UNAVAILABLE" }
              : {
                  kind: "SUPPORTED",
                  experience: null,
                  profileHash: query.data.profileHash,
                },
            limitations: [],
          };
    const admitted = admitRunStartRead(
      raw,
      input,
      nativeState.projection,
      "clerk",
    );
    if (!admitted) return null;
    const snapshot = Object.freeze({
      origin: admitted.origin,
      observedSessionId: auth.sessionId,
      projection: nativeState.projection,
      epoch: 0,
      revision: 1,
      receivedAt: "2026-10-06T00:00:00.000Z",
      data: admitted.data,
    });
    metadataRows.set(key, snapshot);
    return snapshot;
  }
  const metadata = {
    current: currentMetadata,
    get snapshot() {
      return currentMetadata();
    },
    get error() {
      return nativeState.blocked ||
        query.error ||
        query.isPaused ||
        !query.isFetchedAfterMount ||
        (nativeState.projection === "PREVIEW" &&
          !/^[a-f0-9]{64}$/.test(query.data.profileHash))
        ? "Current metadata withheld"
        : null;
    },
    get loading() {
      return query.isFetching;
    },
    refresh: () => {
      try {
        if (
          browser.Clerk.session.id !== auth.sessionId ||
          !props.open ||
          !permissions.canEdit
        )
          return false;
      } catch {
        return false;
      }
      nativeState.blocked = false;
      nativeState.projection = "ACCESS";
      nativeState.nonce++;
      dirty = true;
      return true;
    },
    readPreview: () => {
      if (!currentMetadata()) return false;
      nativeState.projection = "PREVIEW";
      nativeState.nonce++;
      dirty = true;
      return true;
    },
  };
  const utils = {
    client: {
      manualRunStartReviewed: {
        access: { query: async () => null },
        preview: { query: async () => null },
      },
    },
  };
  const effect = (work: () => void | (() => void), deps: unknown[]) => {
    const at = cursor++,
      prior = hooks[at] as unknown[] | undefined;
    if (
      !prior ||
      deps.some((value, index) => !Object.is(value, prior[index]))
    ) {
      hooks[at] = deps;
      effects.push(() => {
        cleanups.get(at)?.();
        const cleanup = work();
        if (cleanup) cleanups.set(at, cleanup);
      });
    }
  };
  const context = vm.createContext({
    React,
    Modal: "synthetic-modal",
    RunConfigCompletionController,
    emptyRunStartCompletion,
    currentSessionScope,
    runStartReadIdentity,
    freezeRunConfiguration,
    MAX_MANUAL_CASES,
    reviewedRunCasesMatch,
    applyRunBulkSelection,
    GAME_PLATFORMS: [],
    resolveQualityExperience: () => {
      throw Error("Null fixture profile only");
    },
    window: browser,
    crypto: {
      randomUUID: () =>
        `00000000-0000-4000-8000-${String(++uuid).padStart(12, "0")}`,
    },
    useAuth: () => auth,
    useManualExecutionAccess: () => access,
    useProjectPermissions: () => permissions,
    trpcReact: { useUtils: () => utils },
    useManualRunStartReviewedAccess: () => metadata,
    useMemo: (factory: () => unknown, deps: unknown[]) => {
      const at = cursor++;
      const previous = hooks[at] as
        { deps: unknown[]; value: unknown } | undefined;
      if (!previous || deps.some((v, i) => !Object.is(v, previous.deps[i])))
        hooks[at] = { deps, value: factory() };
      return (hooks[at] as { value: unknown }).value;
    },
    useState: (initial: unknown) => {
      const at = cursor++;
      if (!Object.hasOwn(hooks, at))
        hooks[at] =
          typeof initial === "function"
            ? (initial as () => unknown)()
            : initial;
      return [
        hooks[at],
        (value: unknown) => {
          setterCalls++;
          const next =
            typeof value === "function"
              ? (value as (before: unknown) => unknown)(hooks[at])
              : value;
          if (!Object.is(next, hooks[at])) {
            hooks[at] = next;
            dirty = true;
          }
        },
      ];
    },
    useRef: (initial: unknown) => {
      const at = cursor++;
      if (!Object.hasOwn(hooks, at)) hooks[at] = { current: initial };
      return hooks[at];
    },
    useId: () => {
      cursor++;
      return "synthetic-prefix";
    },
    useLayoutEffect: effect,
    useEffect: effect,
  });
  vm.runInContext(sdkCode + compiled, context);
  function render() {
    let loops = 0;
    do {
      dirty = false;
      cursor = 0;
      tree = (context.component as (p: typeof props) => unknown)(props);
      while (effects.length) effects.shift()!();
      if (++loops > 35) throw Error("Modal render did not settle");
    } while (dirty);
    return tree;
  }
  function button(label: string) {
    const node = children(tree).find(
      (node) => node.type === "button" && text(node.props.children) === label,
    );
    if (!node) throw Error(`Missing button ${label}: ${text(tree)}`);
    return node;
  }
  function click(label: string) {
    const node = button(label);
    if (node.props.disabled) throw Error(`Disabled ${label}`);
    const result = node.props.onClick?.();
    render();
    return result;
  }
  function edit(key: string, value: string) {
    const node = children(tree).find(
      (node) => node.props.id === `synthetic-prefix-${key}`,
    );
    if (!node) throw Error("Field unavailable");
    node.props.onChange?.({ target: { value } });
    render();
  }
  function session(id: string, commit = true) {
    nativeState.blocked = true;
    auth.sessionId = id;
    browser.Clerk.session.id = id;
    for (const listener of [...listeners]) listener();
    if (commit) render();
  }
  render();
  return {
    props,
    access,
    permissions,
    query,
    nativeState,
    browser,
    listeners,
    sent,
    opened,
    render,
    click,
    edit,
    session,
    button,
    acknowledgement,
    get content() {
      return text(tree);
    },
    get ids() {
      return uuid;
    },
    setterCalls: () => setterCalls,
    value(key: string) {
      return children(tree).find(
        (node) => node.props.id === `synthetic-prefix-${key}`,
      )?.props.value;
    },
    wait() {
      waiting = deferred();
      return waiting;
    },
    releaseWait() {
      waiting = null;
    },
    malformed() {
      badAck = true;
    },
    async flush() {
      for (let tick = 0; tick < 8; tick++) await Promise.resolve();
      for (let tick = 0; tick < 8; tick++)
        await new Promise<void>((resolve) => setImmediate(resolve));
      render();
    },
    async recheck() {
      await click("Recheck original access");
      render();
    },
    review() {
      click("Continue");
      click("Continue");
    },
  };
}
describe("actual mounted run configuration synthetic controller", () => {
  it("stable repeated render invokes no setters and staged metadata never creates a native write", () => {
    const h = harness();
    const before = h.setterCalls();
    for (let n = 0; n < 50; n++) h.render();
    expect(h.setterCalls()).toBe(before);
    expect(h.sent).toHaveLength(0);
    expect(h.ids).toBe(0);
  });
  it.each(["Clerk", "loaded", "session", "user", "userId"] as const)(
    "throwing SDK %s getter hides private form generically and does not dispatch on repeated renders",
    (field) => {
      const h = harness();
      h.edit("build", "private original draft");
      const resource = h.browser.Clerk,
        session = resource.session;
      const target =
        field === "Clerk"
          ? h.browser
          : field === "loaded" || field === "session"
            ? resource
            : field === "user"
              ? session
              : session.user;
      const key =
        field === "Clerk" ? "Clerk" : field === "userId" ? "id" : field;
      Object.defineProperty(target, key, {
        configurable: true,
        get() {
          throw Error("PRIVATE_GETTER_CAUSE");
        },
      });
      expect(() => h.render()).not.toThrow();
      const settled = h.setterCalls();
      for (let n = 0; n < 20; n++) expect(() => h.render()).not.toThrow();
      expect(h.setterCalls()).toBe(settled);
      expect(h.content).not.toContain("private original draft");
      expect(h.content).not.toContain("PRIVATE_GETTER_CAUSE");
      expect(h.sent).toHaveLength(0);
    },
  );
  it("owned lost response recovers same UUID/body with current unsupported profile using ACCESS only", async () => {
    const h = harness();
    h.review();
    const wait = h.wait();
    h.click("Start execution record");
    const envelope = h.sent[0]!;
    wait.reject(Error("lost"));
    await h.flush();
    h.releaseWait();
    h.nativeState.unsupported = true;
    h.props.open = false;
    h.render();
    h.props.open = true;
    h.render();
    await h.recheck();
    expect(h.nativeState.projection).toBe("ACCESS");
    h.click("Retry retained run start");
    await h.flush();
    expect(h.sent).toHaveLength(2);
    expect(h.sent[1]).toBe(envelope);
    expect(h.ids).toBe(1);
    expect(h.opened).toHaveLength(1);
  });
  it("current matching ACK invokes only guarded confirmation, with exact original payload and one UUID", async () => {
    const h = harness();
    h.edit("configuration", "  exact multi\nline configuration  ");
    h.review();
    h.click("Start execution record");
    await h.flush();
    expect(h.sent).toHaveLength(1);
    expect(h.opened).toHaveLength(1);
    expect(h.sent[0]?.request.executionContext?.configuration).toBe(
      "exact multi\nline configuration",
    );
    expect(h.ids).toBe(1);
    expect(h.content).toContain("Run start confirmed");
    expect(h.button("Open confirmed run").props.disabled).toBe(true);
  });
  it.each(["authority", "closed", "ABA"])(
    "late ACK after %s retains form and privately confirms; restoration requires explicit Open",
    async (reason) => {
      const h = harness();
      h.edit("build", "reviewed build");
      h.review();
      const wait = h.wait();
      h.click("Start execution record");
      const input = h.sent[0]!;
      if (reason === "authority") {
        h.access.canWrite = false;
        h.permissions.canEdit = false;
        h.render();
      }
      if (reason === "closed") {
        h.props.open = false;
        h.render();
      }
      if (reason === "ABA") {
        h.session("session-B");
        h.session("session-A");
      }
      wait.resolve(h.acknowledgement(input));
      await h.flush();
      expect(h.opened).toHaveLength(0);
      expect(h.ids).toBe(1);
      h.access.canWrite = true;
      h.permissions.canEdit = true;
      h.props.open = true;
      h.render();
      await h.recheck();
      expect(h.content).toContain("Run start confirmed");
      expect(h.content).toContain("reviewed build");
      h.click("Open confirmed run");
      expect(h.opened).toHaveLength(1);
      expect(h.sent).toHaveLength(1);
    },
  );
  it("malformed ACK survives close/reopen and background selection changes with exact object/body/UUID retry", async () => {
    const h = harness();
    h.review();
    h.malformed();
    h.click("Start execution record");
    await h.flush();
    const input = h.sent[0]!,
      body = JSON.stringify(input);
    h.props.open = false;
    h.render();
    h.props.testCaseIds = ["replacement"];
    h.props.caseCount = 1;
    h.props.open = true;
    h.render();
    await h.recheck();
    h.click("Retry retained run start");
    await h.flush();
    expect(h.sent).toHaveLength(2);
    expect(h.sent[1]).toBe(input);
    expect(JSON.stringify(h.sent[1])).toBe(body);
    expect(h.ids).toBe(1);
    expect(h.opened).toHaveLength(0);
  });
  it("same-event duplicate stale start handler is stopped by private controller before a second UUID/RPC", async () => {
    const h = harness();
    h.review();
    const wait = h.wait(),
      handler = h.button("Start execution record").props.onClick!;
    handler();
    handler();
    h.render();
    expect(h.sent).toHaveLength(1);
    expect(h.ids).toBe(1);
    wait.resolve(h.acknowledgement(h.sent[0]!));
    await h.flush();
  });
  it("SDK session loss without React commit prevents a stale action from generating a UUID", async () => {
    const h = harness();
    h.review();
    const handler = h.button("Start execution record").props.onClick!;
    // SDK changes before any hook commit: the action-time session guard alone
    // must stop this old handler from submitting a new request.
    h.session("session-B", false);
    handler();
    await h.flush();
    expect(h.sent).toHaveLength(0);
    expect(h.ids).toBe(0);
  });
  it("SDK loss before a late matching ACK cannot publish an actionable confirmation in the old modal frame", async () => {
    const h = harness();
    h.review();
    const wait = h.wait();
    h.click("Start execution record");
    const request = h.sent[0]!;
    h.session("session-B", false);
    wait.resolve(h.acknowledgement(request));
    await h.flush();
    expect(h.opened).toHaveLength(0);
    expect(h.content).not.toContain("Run start confirmed");
    expect(h.ids).toBe(1);
    h.session("session-A");
    expect(h.content).not.toContain("Run start confirmed");
    await h.recheck();
    expect(h.content).toContain("Run start confirmed");
    h.click("Open confirmed run");
    expect(h.opened).toHaveLength(1);
    expect(h.sent).toHaveLength(1);
  });
  it("late rejection after SDK loss without a React commit keeps the original request private and retryable", async () => {
    const h = harness();
    h.edit("build", "retained rejection draft");
    h.review();
    const wait = h.wait();
    h.click("Start execution record");
    const request = h.sent[0]!;
    h.session("session-B", false);
    wait.reject({ data: { code: "FORBIDDEN" } });
    await h.flush();
    expect(h.opened).toHaveLength(0);
    expect(h.content).not.toContain("retained rejection draft");
    expect(h.content).not.toContain("Retry retained run start");
    h.session("session-A");
    expect(h.content).not.toContain("retained rejection draft");
    await h.recheck();
    expect(h.content).toContain("retained rejection draft");
    expect(h.button("Retry retained run start").props.disabled).toBe(false);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]).toBe(request);
    expect(h.ids).toBe(1);
  });
  it("SDK-only A-B-A without any hook commit blocks captured Start and bulk handlers; explicit recheck requires a new review", async () => {
    const h = harness();
    h.edit("configuration", "retained\nunsent configuration");
    const bulk = h.button("Apply Set selection").props.onClick!;
    h.review();
    const start = h.button("Start execution record").props.onClick!;
    h.session("session-B", false);
    h.session("session-A", false);
    start();
    bulk();
    await h.flush();
    expect(h.sent).toHaveLength(0);
    expect(h.ids).toBe(0);
    expect(h.props.testCaseIds).toEqual(["one", "two"]);
    expect(h.content).not.toContain("retained\nunsent configuration");
    await h.recheck();
    expect(h.content).toContain("retained\nunsent configuration");
    expect(h.button("Start execution record").props.disabled).toBe(true);
    // Explicitly move back and review again; merely returning A cannot start.
    h.click("Back");
    h.click("Continue");
    h.click("Start execution record");
    await h.flush();
    expect(h.sent).toHaveLength(1);
  });
  it("late exact ACK after SDK-only A-B-A is private, then fresh recheck permits only Open same confirmed run", async () => {
    const h = harness();
    h.edit("build", "original build");
    h.review();
    const waiting = h.wait();
    h.click("Start execution record");
    const input = h.sent[0]!;
    h.session("session-B", false);
    h.session("session-A", false);
    waiting.resolve(h.acknowledgement(input));
    await h.flush();
    expect(h.opened).toHaveLength(0);
    expect(h.content).not.toContain("Run start confirmed");
    expect(h.ids).toBe(1);
    await h.recheck();
    expect(h.content).toContain("Run start confirmed");
    expect(h.content).toContain("original build");
    h.click("Open confirmed run");
    expect(h.opened).toHaveLength(1);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]).toBe(input);
  });
  it.each(["rejection", "malformed"])(
    "SDK-only A-B-A late %s retains the original UUID/body until explicit fresh recheck",
    async (mode) => {
      const h = harness();
      h.edit("configuration", "original environment");
      h.review();
      const waiting = h.wait();
      h.click("Start execution record");
      const input = h.sent[0]!,
        body = JSON.stringify(input);
      h.session("session-B", false);
      h.session("session-A", false);
      if (mode === "rejection")
        waiting.reject(Error("private body test diagnostic"));
      else
        waiting.resolve({
          ...h.acknowledgement(input),
          idempotencyKey: "wrong",
        });
      await h.flush();
      expect(h.sent).toHaveLength(1);
      expect(h.content).not.toContain("original environment");
      expect(h.content).not.toContain("private body test diagnostic");
      await h.recheck();
      expect(h.content).toContain("Retry retained run start");
      h.click("Retry retained run start");
      await h.flush();
      expect(h.sent[1]).toBe(input);
      expect(JSON.stringify(h.sent[1])).toBe(body);
      expect(h.ids).toBe(1);
    },
  );
  it.each(["absent", "void", "throw"] as const)(
    "actual modal refuses %s monitor without publishing configuration or submitting",
    (mode) => {
      const h = harness(mode);
      expect(h.content).toContain("Private configuration is hidden");
      expect(h.sent).toHaveLength(0);
      expect(h.ids).toBe(0);
      expect(h.content).not.toContain("Private listener diagnostic");
    },
  );
  it.each(["paused", "cached", "profile", "role"])(
    "explicit recheck with %s metadata cannot renew blocked admission",
    async (mode) => {
      const h = harness();
      h.edit("build", "private retained build");
      h.session("session-B", false);
      h.session("session-A", false);
      h.render();
      if (mode === "paused") h.query.isPaused = true;
      if (mode === "cached") h.query.isFetchedAfterMount = false;
      if (mode === "profile") h.query.data.profileHash = "invalid";
      if (mode === "role") {
        h.nativeState.full = false;
      }
      await h.recheck();
      expect(h.content).not.toContain("private retained build");
      expect(h.content).toContain("could not be freshly verified");
      expect(h.sent).toHaveLength(0);
    },
  );
  it("resource replacement without SDK event is detected by captured action and requires new installation plus explicit recheck", async () => {
    const h = harness();
    h.review();
    const start = h.button("Start execution record").props.onClick!;
    h.browser.Clerk = { ...h.browser.Clerk };
    start();
    await h.flush();
    expect(h.sent).toHaveLength(0);
    expect(h.ids).toBe(0);
    expect(h.content).toContain("Private configuration is hidden");
    await h.recheck();
    expect(h.content).not.toContain("Private configuration is hidden");
    expect(h.button("Start execution record").props.disabled).toBe(true);
  });
  it("SDK loss while recheck awaits metadata rejects the old token even after A returns", async () => {
    const h = harness();
    h.edit("build", "private retained build");
    h.session("session-B", false);
    h.session("session-A", false);
    h.render();
    h.query.isFetching = true;
    const pending = h.button("Recheck original access").props.onClick!();
    h.session("session-B", false);
    h.session("session-A", false);
    h.query.isFetching = false;
    await pending;
    h.render();
    expect(h.content).not.toContain("private retained build");
    expect(h.sent).toHaveLength(0);
    await h.recheck();
    expect(h.value("build")).toBe("private retained build");
  });
  it("closing while fresh metadata is in flight cannot renew admission on reopening from the old token", async () => {
    const h = harness();
    h.edit("build", "original private build");
    h.session("session-B", false);
    h.session("session-A", false);
    h.render();
    h.query.isFetching = true;
    const pending = h.button("Recheck original access").props.onClick!();
    h.props.open = false;
    h.render();
    h.props.open = true;
    h.render();
    h.query.isFetching = false;
    await pending;
    h.render();
    expect(h.value("build")).toBeUndefined();
    expect(h.sent).toHaveLength(0);
    await h.recheck();
    expect(h.value("build")).toBe("original private build");
  });
  it("repairing an absent listener needs explicit installation retry then fresh metadata recheck, not automatic session restoration", async () => {
    const h = harness("absent");
    h.browser.Clerk.addListener = (listener) => {
      h.listeners.add(listener);
      listener();
      return () => {
        h.listeners.delete(listener);
      };
    };
    await h.recheck();
    expect(h.value("build")).toBeUndefined();
    expect(h.sent).toHaveLength(0);
    await h.recheck();
    expect(h.value("build")).toBe("");
    expect(h.ids).toBe(0);
  });
});
