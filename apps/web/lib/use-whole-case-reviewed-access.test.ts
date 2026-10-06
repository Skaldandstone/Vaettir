// Actual hook, synthetic auth/SDK/RPC only; no native authorization evidence.
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { expect, it } from "vitest";
import { currentSessionScope } from "./auth-query-cache";
import { manualCaseReviewedReadKey, type ManualCaseReviewedAccess } from "@vaettir/api/src/services/manualCaseResultSchema";
import type { ManualRunCurrentOrigin } from "./manual-run-current-reader";
import type { useWholeCaseReviewedAccess } from "./use-whole-case-reviewed-access";
const source = readFileSync(new URL("./use-whole-case-reviewed-access.ts", import.meta.url), "utf8"),
  ast = ts.createSourceFile("actual.ts", source, ts.ScriptTarget.Latest, true),
  functions = ast.statements.filter(ts.isFunctionDeclaration).map(node => ts.createPrinter().printNode(ts.EmitHint.Unspecified, node, ast).replace(/\bexport\s+/, "")).join("\n"),
  executable = ts.transpileModule(functions + "\nthis.hook=useWholeCaseReviewedAccess;", { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const parentScope = (): ManualRunCurrentOrigin => ({ projectId: "p", testRunId: "r", organizationId: "o", clerkActorId: "cl", nativeActorId: "n" });
function harness(parent: ManualRunCurrentOrigin | null | undefined = undefined, initialActor = "n", parentCurrent?: (() => boolean) | null, parentActivation?: string, listenerMode: "ok" | "missing" | "void" | "throw" = "ok") {
  const slots: Array<{ value?: unknown; deps?: unknown[]; cleanup?: () => void; setter?: (value: unknown) => void }> = [], effects: Array<() => void> = [], listeners = new Set<() => void>();
  const cleanup = { work: () => {} };
  const auth = { isLoaded: true, isSignedIn: true, userId: "cl", sessionId: "A" },
    sdk = { loaded: true, session: { id: "A", user: { id: "cl" } }, addListener: listenerMode === "missing" ? undefined : (callback: () => void) => { if (listenerMode === "throw") throw Error("PRIVATE_SDK_MARKER"); listeners.add(callback); callback(); if (listenerMode === "void") return; return () => { listeners.delete(callback); cleanup.work(); }; } },
    state = { projectId: "p", testRunId: "r", parent, parentCurrent, parentActivation, actor: initialActor, organization: "o", active: true, canRecover: true, projectError: null as unknown, error: null as unknown, fetched: true, fetching: false, paused: false, wrongNonce: false },
    requests: Array<{ input: ManualCaseReviewedAccess; enabled: boolean }> = [], metadataRequests: boolean[] = [], metadataRefetches = { count: 0 };
  let cursor = 0, dirty = false, counter = 0, result: ReturnType<typeof useWholeCaseReviewedAccess>;
  const context = vm.createContext({ window: { Clerk: sdk }, currentSessionScope, manualCaseReviewedReadKey,
    crypto: { randomUUID: () => `6ee2ec04-4d34-40bf-b0e9-${String(++counter).padStart(12, "0")}` }, useAuth: () => auth,
    useState: (initial: unknown) => { const index = cursor++; if (!slots[index]) slots[index] = { value: typeof initial === "function" ? initial() : initial }; slots[index]!.setter ??= (value: unknown) => { const next = typeof value === "function" ? value(slots[index]!.value) : value; if (!Object.is(next, slots[index]!.value)) { slots[index]!.value = next; dirty = true; } }; return [slots[index].value, slots[index]!.setter]; },
    useRef: (initial: unknown) => { const index = cursor++; if (!slots[index]) slots[index] = { value: { current: initial } }; return slots[index].value; },
    useMemo: (make: () => unknown, deps: unknown[]) => { const index = cursor++, previous = slots[index]; if (!previous?.deps || deps.length !== previous.deps.length || deps.some((value, i) => !Object.is(value, previous.deps![i]))) slots[index] = { value: make(), deps }; return slots[index]!.value; },
    useLayoutEffect: (make: () => void | (() => void), deps: unknown[]) => { const index = cursor++, previous = slots[index]; if (!previous?.deps || deps.length !== previous.deps.length || deps.some((value, i) => !Object.is(value, previous.deps![i]))) { if (!slots[index]) slots[index] = {}; effects.push(() => { slots[index]!.cleanup?.(); slots[index]!.deps = deps; slots[index]!.cleanup = make() || undefined; }); } },
    trpcReact: { project: { byId: { useQuery: (_input: unknown, options: { enabled: boolean }) => { metadataRequests.push(options.enabled); return { isFetchedAfterMount: true, error: state.projectError, isFetching: false, isPaused: false, data: { id: state.projectId, organizationId: state.organization }, refetch: async () => { metadataRefetches.count++; } }; } } }, manualCaseResults: { accessReviewed: { useQuery: (input: ManualCaseReviewedAccess, options: { enabled: boolean }) => {
      requests.push({ input, enabled: options.enabled }); return { isFetchedAfterMount: state.fetched, error: state.error, isFetching: state.fetching, isPaused: state.paused, data: { readContext: { requestId: state.wrongNonce ? "wrong" : input.readRequestId, requested: manualCaseReviewedReadKey(input), projection: "ACCESS", scope: { projectId: input.projectId, organizationId: state.organization, actorId: state.actor, clerkActorId: auth.userId }, canRecover: state.canRecover } } };
    } } } } });
  vm.runInContext(executable, context);
  const invoke = context.hook as typeof useWholeCaseReviewedAccess;
  function render() { for (let i = 0; i < 40; i++) { dirty = false; cursor = 0; effects.splice(0); result = invoke(state.projectId, state.testRunId, "c", state.active, state.parent, state.parentCurrent, state.parentActivation); if (dirty) continue; for (const effect of effects.splice(0)) effect(); if (!dirty) return result; } throw Error("Hook did not settle"); }
  render();
  return { auth, sdk, context, cleanup, state, requests, metadataRequests, metadataRefetches, render, get result() { return result; }, emit: () => { for (const callback of listeners) callback(); }, unmount: () => { for (const slot of slots) slot.cleanup?.(); } };
}
it("first native ACCESS already forwards the verified parent native actor, org and Clerk pins, but only its own completed echo grants access", () => {
  const h = harness(parentScope());
  expect(h.requests.filter(request => request.enabled)[0]!.input).toMatchObject({ expectedNativeActorId: "n", expectedScope: { projectId: "p", organizationId: "o", clerkActorId: "cl" } });
  expect(h.result.origin).toMatchObject({ nativeActorId: "n", organizationId: "o" });
  expect(h.result.readable).toBe(true);
});
it("native mapping drift before FIRST child read cannot adopt the replacement actor from a complete response", () => {
  const h = harness(parentScope(), "replacement");
  expect(h.result.origin).toBeNull(); expect(h.result.readable).toBe(false); expect(h.result.canRecover).toBe(false);
  expect(h.requests.filter(request => request.enabled).every(request => request.input.expectedNativeActorId === "n")).toBe(true);
  h.state.actor = "n"; h.result.refresh(); expect(h.render().readable).toBe(true);
});
it("explicit null parent refuses bootstrap, while later valid pins are captured before the first enabled request", () => {
  const h = harness(null);
  expect(h.requests.every(request => !request.enabled)).toBe(true); expect(h.result.origin).toBeNull();
  h.state.parent = parentScope(); h.render();
  expect(h.requests.filter(request => request.enabled)[0]!.input.expectedNativeActorId).toBe("n");
  expect(h.result.readable).toBe(true);
});
it("undefined remains standalone compatible; enabling parent mode can never rebase an already accepted origin", () => {
  const h = harness(undefined, "standalone"); expect(h.result.readable).toBe(true);
  expect(h.requests[0]!.input.expectedNativeActorId).toBeUndefined();
  const origin = h.result.origin;
  h.state.parent = parentScope(); h.render();
  expect(h.result.readable).toBe(false); expect(h.result.origin).toBe(origin);
  h.state.parent = undefined; h.render(); expect(h.result.readable).toBe(false);
});
it.each(["projectId", "testRunId", "organizationId", "clerkActorId", "nativeActorId"] as const)("changed parent %s refuses rather than rebinding the immutable original pin", key => {
  const h = harness(parentScope()), origin = h.result.origin;
  h.state.parent = { ...parentScope(), [key]: "foreign" }; h.render();
  expect(h.result.readable).toBe(false); expect(h.result.origin).toBe(origin); expect(h.requests.at(-1)!.enabled).toBe(false);
  h.state.parent = parentScope(); h.render(); expect(h.result.origin).toBe(origin); expect(h.result.readable).toBe(true);
});
it("removing/NULLing supplied pins or mutating the caller object cannot remove required parent mode", () => {
  const pin = { ...parentScope() }, h = harness(pin), origin = h.result.origin;
  pin.nativeActorId = "replacement"; h.render(); expect(h.result.readable).toBe(false);
  h.state.parent = null; h.render(); expect(h.result.readable).toBe(false);
  h.state.parent = undefined; h.render(); expect(h.result.readable).toBe(false);
  expect(h.result.origin).toBe(origin);
});
it.each(["fetched", "fetching", "paused", "error", "wrongNonce"] as const)("parent pins cannot bypass current child %s admission", field => {
  const h = harness(parentScope()); Object.assign(h.state, { [field]: field === "fetched" ? false : field === "error" ? Error("PRIVATE_FIXTURE_MARKER") : true });
  expect(h.render().readable).toBe(false); expect(h.result.error ?? "").not.toContain("PRIVATE_FIXTURE_MARKER");
});
it("READ_ONLY current child remains readable without recovery/write authority and SDK loss retains its exact native origin", () => {
  const h = harness(parentScope()), origin = h.result.origin; h.state.canRecover = false;
  expect(h.render()).toMatchObject({ readable: true, canRecover: false });
  h.sdk.session = { id: "B", user: { id: "other" } }; h.emit();
  expect(h.render().readable).toBe(false); expect(h.result.origin).toBe(origin);
});
it.each([null, () => false, () => { throw Error("PRIVATE_PARENT_MARKER"); }])("missing/refused/throwing parent callback admits no query/body or refresh intent", parentCurrent => {
  const h = harness(parentScope(), "n", parentCurrent, "parentA"), activation = h.result.activation;
  expect(h.requests.every(request => !request.enabled)).toBe(true); expect(h.result.origin).toBeNull();
  h.result.refresh(); expect(h.render().activation).toBe(activation); expect(h.result.error ?? "").not.toContain("PRIVATE_PARENT_MARKER");
});
it("parent frame loss blocks captured refresh before React changes; token renewal generates a new child nonce without changing native origin", () => {
  let current = true;
  const h = harness(parentScope(), "n", () => current, "parentA"), origin = h.result.origin, old = h.result, initial = old.activation;
  current = false; old.refresh(); expect(h.render().readable).toBe(false);
  const refused = h.result.activation; current = true; h.state.parentActivation = "parentB"; h.render();
  expect(h.result.readable).toBe(true); expect(h.result.origin).toBe(origin); expect(h.result.activation).not.toBe(initial); expect(h.result.activation).not.toBe(refused);
  h.state.parentCurrent = undefined; h.render(); expect(h.result.readable).toBe(false);
});
it("required parent callback needs its explicit primitive activation, and parent-native reads do not refetch shared discovery metadata", () => {
  const h = harness(parentScope(), "n", () => true); expect(h.result.readable).toBe(false);
  h.state.parentActivation = "parentA"; h.render(); expect(h.result.readable).toBe(true);
  expect(h.metadataRequests.every(enabled => !enabled)).toBe(true); h.result.refresh(); h.render(); expect(h.metadataRefetches.count).toBe(0);
  h.state.projectError = Error("IRRELEVANT_DISABLED_DISCOVERY"); h.render(); expect(h.result.readable).toBe(true); expect(h.result.error).toBeNull();
  h.state.organization = "foreign-discovery"; h.state.actor = "n"; // native RPC echo changes too in this fixture, so refusal remains honest
  expect(h.render().readable).toBe(false);
});
it("same-owner session renewal requires explicit fresh native read and retains historical origin A", () => {
  const h = harness(parentScope()), original = h.result.origin, old = h.result;
  expect(old.current()).toBe(true);
  h.sdk.session = { id: "B", user: { id: "cl" } }; h.emit();
  expect(old.current()).toBe(false); expect(old.refresh()).toBe(false);
  h.auth.sessionId = "B"; h.render();
  expect(h.result.readable).toBe(false); expect(h.result.observedSessionId).toBeNull();
  expect(h.result.refresh()).toBe(true); h.state.fetched = false; h.render();
  expect(h.result.current()).toBe(false); expect(h.result.observedSessionId).toBeNull();
  h.state.fetched = true; h.render();
  expect(h.result.current()).toBe(true); expect(h.result.observedSessionId).toBe("B");
  expect(h.result.origin).toBe(original); expect(h.result.origin?.sessionId).toBe("A");
  expect(h.requests.filter(r => r.enabled).every(r => r.input.expectedNativeActorId === "n")).toBe(true);
  expect(old.refresh()).toBe(false); expect(old.current()).toBe(false);
});
it("SDK-only A-B-A cannot revive old read even when hook auth never changed", () => {
  const h = harness(parentScope()), old = h.result;
  h.sdk.session = { id: "B", user: { id: "cl" } }; h.emit();
  h.sdk.session = { id: "A", user: { id: "cl" } }; h.emit();
  expect(old.current()).toBe(false); h.render(); expect(h.result.current()).toBe(false);
  expect(h.result.refresh()).toBe(true); h.render(); expect(h.result.current()).toBe(true);
});
it("action-time SDK change without a listener callback withholds old current and refresh before hook state commits", () => {
  const h = harness(parentScope()), old = h.result;
  h.sdk.session = { id: "B", user: { id: "cl" } };
  expect(old.current()).toBe(false); expect(old.refresh()).toBe(false);
  h.sdk.session = { id: "A", user: { id: "cl" } }; h.render(); expect(h.result.current()).toBe(false);
  h.result.refresh(); h.render(); expect(h.result.current()).toBe(true); expect(old.current()).toBe(false);
});
it("explicit renewed read with a foreign native author or org never adopts B, while READ_ONLY B remains inspect-only", () => {
  const h = harness(parentScope()), original = h.result.origin;
  h.sdk.session = { id: "B", user: { id: "cl" } }; h.emit(); h.auth.sessionId = "B"; h.render(); h.result.refresh();
  h.state.actor = "foreign"; h.render(); expect(h.result.current()).toBe(false); expect(h.result.origin).toBe(original);
  h.state.actor = "n"; h.state.organization = "foreign"; h.render(); expect(h.result.current()).toBe(false);
  h.state.organization = "o"; h.state.canRecover = false; h.render(); expect(h.result.current()).toBe(true); expect(h.result.observedSessionId).toBe("B"); expect(h.result.canRecover).toBe(false);
});
it.each(["missing", "void", "throw"] as const)("%s independent listener cannot admit private scope or a native read", mode => {
  const h = harness(parentScope(), "n", undefined, undefined, mode);
  expect(h.result.current()).toBe(false); expect(h.result.readable).toBe(false);
  expect(h.requests.every(r => !r.enabled)).toBe(true); expect(h.result.origin).toBeNull();
  expect(h.result.refresh()).toBe(false); h.render(); expect(h.result.current()).toBe(false);
  expect(h.result.error ?? "").not.toContain("PRIVATE_SDK_MARKER");
});
it("SDK resource replacement and return do not revive the old installation; explicit native refresh is required", () => {
  const h = harness(parentScope()), old = h.result, original = old.origin;
  h.context.window.Clerk = { ...h.sdk }; expect(old.current()).toBe(false); h.render();
  expect(h.result.current()).toBe(false);
  h.context.window.Clerk = h.sdk; h.render(); expect(h.result.current()).toBe(false);
  h.result.refresh(); h.render(); expect(h.result.current()).toBe(true); expect(h.result.origin).toBe(original);
});
it("cleanup revokes captured current/refresh before a throwing unsubscribe", () => {
  const h = harness(parentScope()), old = h.result;
  h.cleanup.work = () => { expect(old.current()).toBe(false); expect(old.refresh()).toBe(false); throw Error("PRIVATE_CLEANUP_MARKER"); };
  expect(() => h.unmount()).not.toThrow(); expect(old.current()).toBe(false); expect(old.refresh()).toBe(false);
});
