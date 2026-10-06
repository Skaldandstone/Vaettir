// Actual hook and reader with synthetic React/Clerk/RPC boundaries. Installed
// TanStack QueryClient/cache/QueryObserver are real; no native or browser proof.
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { expect, it } from "vitest";
import { currentSessionScope, sameAuthScope } from "./auth-query-cache";
import {
  admitPlanExecutionRead,
  inspectPlanExecutionReadWire,
  planExecutionReadIdentity,
  planExecutionReviewedReadKey,
  samePlanExecutionReadOrigin,
  PlanExecutionReadRenderGuard,
  PLAN_EXECUTION_BROWSER_BOUNDS,
  planExecutionCandidateBrowserKey,
  planExecutionReadWireSignature,
  type PlanExecutionReadProjection,
  type PlanExecutionReadInput,
  type PlanExecutionReadPageWire,
  isPlanExecutionPageInput,
} from "./plan-execution-reviewed-reader";
import type {
  PlanExecutionReadAdapter,
  usePlanExecutionReviewedAccess,
} from "./use-plan-execution-reviewed-access";
const source = readFileSync(
    new URL("./use-plan-execution-reviewed-access.ts", import.meta.url),
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
      .join("\n") + "\nthis.hook=usePlanExecutionReviewedAccess;",
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.None,
      },
    },
  ).outputText;
type Reader = ReturnType<typeof usePlanExecutionReviewedAccess>;
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
      testPlanId: string;
      organizationId: string | null | undefined;
      active: boolean;
      originalNativeActorId?: string | null;
    } = {
      projectId: "p",
      testPlanId: "plan",
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
      projection: PlanExecutionReadProjection;
      input: PlanExecutionReadInput;
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
  function dto(projection: PlanExecutionReadProjection, input: PlanExecutionReadInput) {
    const pageInput = "search" in input ? input : { ...input, expectedNativeActorId: "n", search: "", limit: 2 };
    const accessInput = { projectId: input.projectId, testPlanId: input.testPlanId, originalOrganizationId: input.originalOrganizationId, expectedClerkActorId: input.expectedClerkActorId, requestId: input.requestId, ...(input.expectedNativeActorId === undefined ? {} : { expectedNativeActorId: input.expectedNativeActorId }) };
    const key = JSON.stringify([projection,input,state.wrong,state.full,state.unsupported]);
    if (rows.has(key)) return rows.get(key);
    const scope = { projectId: state.wrong === "project" ? "foreign" : input.projectId, testPlanId: state.wrong === "plan" ? "foreign" : input.testPlanId, organizationId: state.wrong === "org" ? "foreign" : "o", actorClerkUserId: state.wrong === "Clerk" ? "other" : "cl", actorId: state.wrong === "native" ? "M" : "n" };
    const readContext = { requestId: state.wrong === "nonce" ? "6ee2ec04-4d34-40bf-b0e9-000000999999" : input.requestId, requestedKey: state.wrong === "key" ? "stale" : planExecutionReviewedReadKey(JSON.parse(JSON.stringify(projection === "PAGE" ? pageInput : accessInput)),projection), projection, scope };
    let raw: unknown = { readContext, hasFullEditorAccess: state.full };
    if(projection === "PAGE") {
      const configuration = { configuration: "", environment: "", platform: "", build: "", hardwareRevision: "", firmwareVersion: "", rig: "", batchOrLot: "", calibrationReference: "", protocolReference: "" };
      const nativeTemplate = { version: 1, testCaseIds: ["case","missing"], configurations: [{ id:"00000000-0000-4000-8000-000000000001",name:" Config ",context:{} }] };
      const template = { ...nativeTemplate, configurations:[{id:nativeTemplate.configurations[0]!.id,name:"Config",context:configuration}] };
      const meta = (id:string) => ({id,title:" Raw\\n title ",displayId:"",reviewStatus:"APPROVED",archived:false});
      const scopeKey = planExecutionCandidateBrowserKey(pageInput);
      const candidateIds = pageInput.cursor ? ["c"] : ["a","b"];
      raw = { readContext,hasFullEditorAccess:state.full,plan:{id:input.testPlanId,projectId:input.projectId,name:" Exact\\n plan ",status:"ACTIVE"},
        rawTemplate:{sqlNull:false,jsonText:JSON.stringify(nativeTemplate)},template,templateHash:"a".repeat(64),interpretation:"LEGACY_NORMALIZED",
        selected:[{testCaseId:"case",state:"AVAILABLE",metadata:meta("case")},{testCaseId:"missing",state:"MISSING",metadata:null}],candidates:candidateIds.slice(0,pageInput.limit).map(meta),
        search:pageInput.search,limit:pageInput.limit,candidateScopeKey:scopeKey,nextCursor:pageInput.cursor?null:{scopeKey,lastId:candidateIds.slice(0,pageInput.limit).at(-1)},limitations:["Template/current candidates only, not approval or receipt."]};
      if(state.unsupported) (raw as {rawTemplate:{jsonText:string}}).rawTemplate.jsonText = "null";
    }
    if(state.wrong==="NULL")raw=null;
    rows.set(key,raw);return raw;
  }
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const originalCache = client.getQueryCache();
  let activeCache = originalCache;
  client.getQueryCache = () => activeCache;
  const adapter: PlanExecutionReadAdapter = {
    access: async (i) => dto("ACCESS", i),
    page: async (i) => dto("PAGE", i),
    key: (projection, input) => [projection, JSON.parse(JSON.stringify(input))],
  };
  let transport: PlanExecutionReadAdapter | undefined = adapter;
  function query(options: {
    queryKey: readonly unknown[];
    enabled: boolean;
    queryFn: () => Promise<unknown>;
  }) {
    const projection = options.queryKey[1] === "PAGE" ? "PAGE" : "ACCESS",
      input = options.queryKey[2]
        ? (JSON.parse(JSON.stringify(options.queryKey[2])) as PlanExecutionReadInput)
        : {
            projectId: "p",
            testPlanId: "plan",
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
    admitPlanExecutionRead: (
      raw: unknown,
      i: PlanExecutionReadInput,
      p: PlanExecutionReadProjection,
      cl: string,
      o: Parameters<typeof admitPlanExecutionRead>[4],
    ) =>
      admitPlanExecutionRead(
        raw,
        JSON.parse(JSON.stringify(i)) as PlanExecutionReadInput,
        p,
        cl,
        o,
      ),
    planExecutionReviewedReadKey: (input: PlanExecutionReadInput, projection: PlanExecutionReadProjection) => planExecutionReviewedReadKey(JSON.parse(JSON.stringify(input)) as PlanExecutionReadInput, projection),
    isPlanExecutionPageInput: (input: PlanExecutionReadInput) => isPlanExecutionPageInput(JSON.parse(JSON.stringify(input)) as PlanExecutionReadInput),
    inspectPlanExecutionReadWire: (value: unknown, cap: number) => inspectPlanExecutionReadWire(JSON.parse(JSON.stringify(value)), cap),
    planExecutionReadIdentity,
    samePlanExecutionReadOrigin,
    PlanExecutionReadRenderGuard,
    planExecutionReadWireSignature: (
      value: unknown,
      projection: PlanExecutionReadProjection,
    ) => {
      signatureReads++;
      return planExecutionReadWireSignature(value, projection);
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
  const hook = context.hook as typeof usePlanExecutionReviewedAccess;
  function render(commit = true) {
    for (let i = 0; i < 70; i++) {
      cursor = 0;
      dirty = false;
      effects.clear();
      reader = hook(params.projectId, params.testPlanId, params.organizationId, transport, params);
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
    setAdapter: (next: PlanExecutionReadAdapter | undefined) => {
      transport = next;
    },
    adapter,
    signatureReads: () => signatureReads,
    setterCalls: () => setterCalls,
    guard: () =>
      slots.find((slot) => slot.value instanceof PlanExecutionReadRenderGuard)!
        .value as PlanExecutionReadRenderGuard,
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
function pageData(reader: Reader): PlanExecutionReadPageWire {
  const data = reader.fresh;
  if (reader.projection !== "PAGE" || !data || !("plan" in data)) throw Error("Expected an admitted complete PAGE");
  return data as PlanExecutionReadPageWire;
}

it("actual hook admits ACCESS only as current membership/N, never automatically loads template or claims start/save/receipt",()=>{
 const h=harness();expect(h.reader.current()).toBe(h.reader.snapshot);expect(h.reader.origin).toEqual({projectId:"p",testPlanId:"plan",organizationId:"o",clerkActorId:"cl",nativeActorId:"n"});
 expect(h.requests.filter(r=>r.enabled).every(r=>r.projection==="ACCESS")).toBe(true);
 expect(h.reader.canStart).toBe(false);expect(h.reader.canSave).toBe(false);expect(h.reader.receiptVerified).toBe(false);
 expect(h.reader.readPage({search:"",limit:2})).toBe(true);const page=h.render();expect(page.current()).toBe(page.snapshot);expect(page.projection).toBe("PAGE");
 expect(pageData(page).selected.map(row=>row.state)).toEqual(["AVAILABLE","MISSING"]);
});
it.each(["missing","void","throw","getter"] as const)("SDK listener %s cannot admit a native read or cached template",mode=>{const h=harness(mode);expect(h.reader.current()).toBeNull();expect(h.reader.origin).toBeNull();expect(h.requests.some(r=>r.enabled)).toBe(false);});
it("explicit null original native pin withholds; wrong parent N cannot establish replacement native authority",()=>{for(const pin of[null,"M"]){const h=harness("ok",false,pin);expect(h.reader.current()).toBeNull();expect(h.reader.origin).toBeNull();}});
it("SDK-only session B then A without hook update permanently revokes old nonce; refresh requires a completed new read",()=>{
 const h=harness(),held=h.reader,nonce=held.snapshot!.data.readContext.requestId;
 h.sdk.session={id:"B",user:{id:"cl"}};h.emit();h.sdk.session={id:"A",user:{id:"cl"}};h.emit();expect(held.current()).toBeNull();expect(held.readPage({search:"",limit:2})).toBe(false);
 h.render();expect(h.reader.current()).toBeNull();expect(h.reader.refresh()).toBe(true);const next=h.render();expect(next.current()).not.toBeNull();expect(next.snapshot!.data.readContext.requestId).not.toBe(nonce);
});
it("same original native owner session B becomes observed only after explicit ACCESS refresh",()=>{
 const h=harness(),origin=h.reader.origin;h.sdk.session={id:"B",user:{id:"cl"}};h.emit();h.auth.sessionId="B";h.render();expect(h.reader.current()).toBeNull();expect(h.reader.refresh()).toBe(true);
 const next=h.render();expect(next.current()).not.toBeNull();expect(next.observedSessionId).toBe("B");expect(next.origin).toBe(origin);
});
it("cached rows/error/fetch/pause/current native mismatch cannot seed PAGE authority",()=>{
 for(const kind of["error","fetch","pause","native","plan","nonce","key","NULL"]){const h=harness();h.reader.readPage({search:"",limit:2});if(kind==="error")h.state.error=Error("PRIVATE");else if(kind==="fetch")h.state.fetching=true;else if(kind==="pause")h.state.paused=true;else h.state.wrong=kind;
 expect(h.render().current()).toBeNull();expect(h.reader.error??"").not.toContain("PRIVATE");}
});
it("cache fetch A-B-A revokes synchronously and posted old layout cannot restore rows",()=>{
 const h=harness();h.reader.readPage({search:"",limit:2});h.render();const held=h.reader;h.beforeLayout();
 const q=h.client.getQueryCache().getAll().find(row=>row.state.data===held.snapshot!.data)||h.client.getQueryCache().getAll().find(row=>row.queryKey[1]==="PAGE"&&row.queryKey[2]&&JSON.stringify(row.queryKey[2]).includes(held.snapshot!.data.readContext.requestId))!;
 const previous=q.state;q.setState({...previous,fetchStatus:"fetching"});q.setState(previous);
 expect(held.current()).toBeNull();expect(h.render().current()).toBeNull();
});
it("active false before layout and later valid render both refuse captured old current/refresh/page handlers",()=>{
 const h=harness(),old=h.reader;h.params.active=false;h.beforeLayout();expect(old.current()).toBeNull();expect(old.refresh()).toBe(false);expect(old.readPage({search:"",limit:2})).toBe(false);
 h.render();h.params.active=true;h.render();h.reader.refresh();h.render();expect(old.current()).toBeNull();expect(old.refresh()).toBe(false);
});
it("plan A-B-A never transfers original scope or revives its prior current snapshot",()=>{
 const h=harness(),held=h.reader,origin=held.origin;h.params.testPlanId="other";h.render();expect(held.current()).toBeNull();h.params.testPlanId="plan";h.render();expect(h.reader.current()).toBeNull();expect(h.reader.origin).toBe(origin);expect(h.reader.refresh()).toBe(true);expect(h.render().current()).not.toBeNull();
});
it("PAGE keeps exact scoped literal search/limit/cursor and selection cannot be mutated after its read intent",()=>{
 const h=harness(),selection={search:" exact,%_ ",limit:2};expect(h.reader.readPage(selection)).toBe(true);selection.search="changed";const reader=h.render();const data=pageData(reader);
 expect(data.search).toBe(" exact,%_ ");expect(data.limit).toBe(2);
 if(!data.nextCursor)throw Error("Expected synthetic next cursor");
 const next={search:data.search,limit:data.limit,cursor:{...data.nextCursor}};expect(reader.readPage(next)).toBe(true);next.cursor.lastId="bad";const result=pageData(h.render());expect(result.candidates.map(row=>row.id)).toEqual(["c"]);
 expect(h.reader.readPage({search:"changed",limit:2,cursor:data.nextCursor})).toBe(false);
});
it.each(["projectId", "testPlanId", "expectedNativeActorId", "requestId"])("injected PAGE selection %s refuses before intent/read dispatch and preserves original current snapshot/nonce", key => {
  const h = harness(); h.reader.readPage({ search: "", limit: 2 }); h.render();
  const held = h.reader, snapshot = held.current(), nonce = snapshot!.data.readContext.requestId;
  const before = h.requests.length, setters = h.setterCalls();
  const injected = { search: "", limit: 2, [key]: key === "requestId" ? "00000000-0000-4000-8000-000000000009" : "foreign" };
  expect(held.readPage(injected)).toBe(false);
  expect(h.requests.length).toBe(before); expect(h.setterCalls()).toBe(setters);
  expect(held.current()).toBe(snapshot); expect(held.current()!.data.readContext.requestId).toBe(nonce);
  expect(h.render().current()).toBe(snapshot);
});
it("SDK replacement/cleanup revoke before callback or throwing unsubscribe, without returning private rows",()=>{
 const h=harness(),held=h.reader;h.cleanup.work=()=>{expect(held.current()).toBeNull();expect(held.refresh()).toBe(false);throw Error("PRIVATE_CLEANUP");};
 expect(()=>h.unmount()).not.toThrow();expect(held.current()).toBeNull();
 const replacement=harness(),old=replacement.reader;const original=replacement.context.window.Clerk;replacement.context.window.Clerk={...original};expect(old.current()).toBeNull();replacement.context.window.Clerk=original;expect(old.current()).toBeNull();
});
it("unadmitted/previously revoked repeated current() calls dispatch no render-publication updates",()=>{
 const h=harness(),held=h.reader;h.sdk.session={id:"B",user:{id:"cl"}};expect(held.current()).toBeNull();const before=h.setterCalls();for(let i=0;i<30;i++)expect(held.current()).toBeNull();expect(h.setterCalls()).toBe(before);
});
it.each(["windowClerk", "loaded", "session", "sessionId", "user", "userId"] as const)("independent SDK %s getter failure suppresses private view and error text without reviving old read", field => {
  const h = harness(), held = h.reader, restore = installSDKGetterFault(h, field);
  expect(() => held.current()).not.toThrow(); expect(held.current()).toBeNull();
  const next = h.render(); expect(next.current()).toBeNull(); expect(next.error ?? "").not.toContain("PRIVATE");
  restore(); h.render(); expect(h.reader.current()).toBeNull();
});
it("silent SDK change after render before commit refuses the posted native view even without SDK event/useAuth update", () => {
  const h = harness(); h.beforeCommit(() => { h.sdk.session = { id: "B", user: { id: "cl" } }; });
  expect(h.render().current()).toBeNull(); h.sdk.session = { id: "A", user: { id: "cl" } };
  expect(h.render().current()).toBeNull(); expect(h.reader.refresh()).toBe(true); expect(h.render().current()).not.toBeNull();
});
it("actual installed QueryObserver invalidation A-B-A cannot authorize old current/template view", () => {
  const h = harness(); h.reader.readPage({ search: "", limit: 2 }); h.render(); const held = h.reader;
  const q = h.client.getQueryCache().getAll().find(item => item.queryKey[1] === "PAGE" && JSON.stringify(item.queryKey[2]).includes(held.snapshot!.data.readContext.requestId))!;
  const observer = new QueryObserver(h.client, { queryKey: q.queryKey, queryFn: async () => q.state.data, enabled: false, refetchOnMount: false, retry: false, gcTime: 0 });
  const detach = observer.subscribe(() => {}), prior = q.state;
  q.invalidate(); expect(held.current()).toBeNull(); q.setState(prior);
  expect(held.current()).toBeNull(); expect(h.render().current()).toBeNull(); detach(); observer.destroy();
});
it("bounded original reader retires unknown/malformed nonces rather than pruning to revive their views", () => {
  const h = harness(), guard = h.guard(); guard.revokeCache("malformed");
  expect(guard.canRenew()).toBe(false); expect(h.reader.current()).toBeNull(); expect(h.reader.refresh()).toBe(false);
  expect(PLAN_EXECUTION_BROWSER_BOUNDS.PAGE).toBe(2097152);
});
