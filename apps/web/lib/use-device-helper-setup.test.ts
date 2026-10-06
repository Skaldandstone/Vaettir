import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
vi.mock("./trpcReact", () => ({ trpcReact: {} }));
import { currentSessionScope, sameAuthScope } from "./auth-query-cache";
import { DeviceHelperSetup } from "./device-helper-setup";
import { captureAccessClientRequestKey, captureJsonContentCost, retainCaptureJson } from "./device-capture-ownership";
import { deviceHelperSetupAccessInput, deviceHelperSetupAccessOutput, deviceHelperSetupAccessRequestText, deviceHelperSetupMetadataBytes } from "../../api/src/services/deviceHelperSetupAccessSchema";
import type { DeviceHelperSetupAccessInput } from "../../api/src/services/deviceHelperSetupAccessSchema";
import type { DeviceCaptureAccessInput } from "../../api/src/services/deviceCaptureAccessSchema";
import type { DeviceHelperSetupWorkflow, HelperSetupIntent } from "./use-device-helper-setup";
import { DeviceHelperSetupOwner } from "./use-device-helper-setup";

const source = readFileSync(new URL("./use-device-helper-setup.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("setup.ts", source, ts.ScriptTarget.Latest, true);
const body = ast.statements.filter(ts.isFunctionDeclaration).map(node => ts.createPrinter().printNode(ts.EmitHint.Unspecified, node, ast).replace(/\bexport\s+/g, "")).join("\n");
const executable = ts.transpileModule(body + "\nthis.hook=useDeviceHelperSetup;this.key=deviceHelperSetupClientKey;", { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function harness(listenerMode: "normal" | "throw" | "void" = "normal") {
  const hooks: unknown[] = [], effects: Array<() => void> = [], cleanups = new Map<number, () => void>(), listeners = new Set<() => void>();
  const auth = { isLoaded: true, isSignedIn: true, userId: "cl", sessionId: "A" };
  const sdk = { loaded: true, session: { id: "A", user: { id: "cl" } } as null | { id: string; user: { id: string } }, addListener: (fn: () => void) => {
    if (listenerMode === "throw") throw Error("synthetic listener failure");
    listeners.add(fn); fn(); if (listenerMode === "void") return undefined; return () => { listeners.delete(fn); }; } };
  const browser = { Clerk: sdk };
  const intent: HelperSetupIntent = { projectId: "p", originalOrganizationId: "o", active: true, platform: "windows", mode: "android", pairingCode: "ABCDEF123456", connectionEpoch: 1, buffers: { note: " exact\nprivate ", empty: "", missing: null, zero: 0, disabled: false } };
  const sent: Array<{ kind: "bootstrap" | "read" | "health"; input: unknown }> = [];
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  let cursor = 0, dirty = false, workflow: DeviceHelperSetupWorkflow, nativeRole = "EDITOR", nativeActor = "n", beforeCommit: (() => void) | null = null;
  let bootstrapResponder: ((input: DeviceHelperSetupAccessInput) => Promise<unknown>) | null = null;
  let healthResponder: (() => Promise<unknown>) | null = null;
  const context = vm.createContext({ window: browser, crypto, AbortController, TextEncoder, Object, JSON,
    currentSessionScope, sameAuthScope, DeviceHelperSetupOwner, DeviceHelperSetup, captureJsonContentCost, retainCaptureJson,
    deviceHelperSetupAccessInput, deviceHelperSetupAccessOutput, deviceHelperSetupAccessRequestText, deviceHelperSetupMetadataBytes,
    useAuth: () => auth,
    useState: (initial: unknown) => { const index = cursor++; if (!Object.hasOwn(hooks, index)) hooks[index] = typeof initial === "function" ? initial() : initial;
      return [hooks[index], (value: unknown) => { const next = typeof value === "function" ? value(hooks[index]) : value; if (!Object.is(next, hooks[index])) { hooks[index] = next; dirty = true; } }]; },
    useRef: (initial: unknown) => { const index = cursor++; if (!Object.hasOwn(hooks, index)) hooks[index] = { current: initial }; return hooks[index]; },
    useLayoutEffect: (fn: () => void | (() => void), deps: unknown[]) => { const index = cursor++, previous = hooks[index] as unknown[] | undefined;
      if (!previous || deps.some((value, n) => !Object.is(value, previous[n]))) { hooks[index] = deps; effects.push(() => { cleanups.get(index)?.(); const cleanup = fn(); if (cleanup) cleanups.set(index, cleanup); }); } },
  });
  vm.runInContext(executable, context);
  const key = (context as unknown as { key(input: DeviceHelperSetupAccessInput): Promise<string> }).key;
  const scope = () => ({ projectId: "p", organizationId: "o", nativeActorId: nativeActor, clerkActorId: "cl" });
  async function bootstrapReply(input: DeviceHelperSetupAccessInput) { return { readRequestId: input.readRequestId, requestKey: await key(input), scope: scope(), role: nativeRole, seatType: "FULL", authorization: "CURRENT_LOCKED_FULL_EDITOR_READ", identityEstablishment: "CURRENT_SETUP_SCOPE_ONLY", deviceOperationPerformed: false, helperLaunchPerformed: false, windowsLaunchAcceptanceVerified: false, foregroundTargetVerified: false, captureConsentGranted: false, processingPermissionGranted: false, spendingApprovalGranted: false, legacyDraftAttributionVerified: false }; }
  const utils = { deviceHelperSetupAccess: { establishCurrent: { fetch: async (input: DeviceHelperSetupAccessInput) => client.fetchQuery({ queryKey: ["bootstrap", input], queryFn: async () => { sent.push({ kind: "bootstrap", input }); return bootstrapResponder ? bootstrapResponder(input) : bootstrapReply(input); }, staleTime: 0 }) } },
    deviceCaptureAccess: { read: { fetch: async (input: DeviceCaptureAccessInput) => client.fetchQuery({ queryKey: ["read", input], queryFn: async () => { sent.push({ kind: "read", input }); return { readRequestId: input.readRequestId, requestKey: await captureAccessClientRequestKey(input), scope: scope(), role: nativeRole, seatType: "FULL", authorization: "CURRENT_LOCKED_FULL_EDITOR_READ", processingPermissionGranted: false, foregroundTargetVerified: false, deviceOperationPerformed: false }; }, staleTime: 0 }) } } };
  Object.assign(context, { trpcReact: { useUtils: () => utils } });
  const health = async (input: unknown) => { sent.push({ kind: "health", input }); return healthResponder ? healthResponder() : { connected: true, version: 2 }; };
  const invoke = (context as unknown as { hook(intent: HelperSetupIntent, injectedHealth?: typeof health): DeviceHelperSetupWorkflow }).hook;
  function render(commit = true, withHealth = true) { for (let n = 0; n < 40; n++) { cursor = 0; dirty = false; workflow = invoke(intent, withHealth ? health : undefined);
      if (!commit) return workflow; beforeCommit?.(); beforeCommit = null; effects.splice(0).forEach(fn => fn()); if (!dirty) return workflow; }
    throw Error("Synthetic setup hook failed to settle."); }
  render();
  return { intent, auth, sdk, sent, client, render, bootstrapReply, get workflow() { return workflow; }, replaceResource(value: typeof sdk) { browser.Clerk = value; }, listenerCount: () => listeners.size, setRole(value: string) { nativeRole = value; }, setNative(value: string) { nativeActor = value; },
    setBootstrap(value: typeof bootstrapResponder) { bootstrapResponder = value; }, setHealth(value: typeof healthResponder) { healthResponder = value; }, beforeCommit(fn: () => void) { beforeCommit = fn; },
    emit(session: typeof sdk.session) { sdk.session = session; Array.from(listeners).forEach(fn => fn()); },
    unmount() { Array.from(cleanups.values()).forEach(fn => fn()); cleanups.clear(); client.clear(); } };
}

describe("actual setup hook/owner + real TanStack; Clerk/RPC/health synthetic only", () => {
  it("does nothing on mount and explicitly reviews only current metadata, never pairing or source over hosted RPC", async () => {
    const h = harness(); expect(h.sent).toEqual([]); expect(h.workflow.view.canReview).toBe(true);
    await h.workflow.review(); h.render(); expect(h.sent.map(value => value.kind)).toEqual(["bootstrap", "read"]);
    expect(h.workflow.view.currentScope?.nativeActorId).toBe("n"); expect(h.workflow.view.canCheck).toBe(true);
    expect(JSON.stringify(h.sent)).not.toMatch(/ABCDEF|private|android|windows/);
    expect(h.workflow.view).toMatchObject({ deviceOperationPerformed: false, processingPermissionGranted: false, spendingApprovalGranted: false, paired: false });
    h.unmount();
  });
  it("one explicit paired check requires fresh native reads before/after and never performs discovery or capture", async () => {
    const h = harness(); await h.workflow.review(); h.render(); await h.workflow.checkPaired(); h.render();
    expect(h.sent.map(row => row.kind)).toEqual(["bootstrap", "read", "read", "health", "read"]);
    expect(h.workflow.view.paired).toBe(true); expect(h.workflow.view.description).toContain("not verified safe/redacted");
    const requests = h.sent.filter(row => row.kind === "read").map(row => row.input as DeviceCaptureAccessInput);
    expect(new Set(requests.map(row => row.readRequestId)).size).toBe(3); expect(requests.every(row => row.expectedNativeActorId === "n")).toBe(true);
    await h.workflow.checkPaired(); expect(h.sent.filter(row => row.kind === "health")).toHaveLength(1); h.unmount();
  });
  it("independent SDK A-B-A hides late bootstrap before a React commit; explicit retry obtains another nonce", async () => {
    const h = harness(), entered = deferred<void>(), response = deferred<unknown>(); h.setBootstrap(async () => { entered.resolve(); return response.promise; });
    const pending = h.workflow.review(); await entered.promise; const input = h.sent[0]!.input as DeviceHelperSetupAccessInput;
    h.emit({ id: "B", user: { id: "cl" } }); h.emit({ id: "A", user: { id: "cl" } }); response.resolve(await h.bootstrapReply(input)); await pending;
    expect(h.render(false).view.currentScope).toBeNull(); expect(h.sent.map(row => row.kind)).toEqual(["bootstrap"]);
    h.setBootstrap(null); h.render(); await h.workflow.review(); h.render(); expect(h.workflow.view.currentScope?.nativeActorId).toBe("n");
    expect((h.sent[1]?.input as DeviceHelperSetupAccessInput).readRequestId).not.toBe(input.readRequestId); h.unmount();
  });
  it("render-intent changes refuse old handlers before layout and retain buffers unchanged", async () => {
    const h = harness(); await h.workflow.review(); h.render(); const old = h.workflow, count = h.sent.length, buffers = JSON.stringify(h.intent.buffers);
    Object.assign(h.intent, { active: false }); expect(h.render(false).view.currentScope).toBeNull(); await old.checkPaired(); await old.review(); expect(h.sent).toHaveLength(count);
    h.render(); Object.assign(h.intent, { active: true }); h.render(); expect(h.workflow.view.currentScope).toBeNull(); await h.workflow.review(); h.render();
    expect(JSON.stringify(h.intent.buffers)).toBe(buffers); expect(h.sent.filter(row => row.kind === "bootstrap")).toHaveLength(1); h.unmount();
  });
  it("SDK movement during busy publication cannot invoke hosted reads", async () => {
    const h = harness(); h.sdk.session = { id: "B", user: { id: "cl" } }; await h.workflow.review(); expect(h.sent).toHaveLength(0);
    expect(h.render(false).view.currentScope).toBeNull(); h.unmount();
  });
  it("native mapping cannot rebind established setup to another current actor; denied metadata hides old scope", async () => {
    const h = harness(); await h.workflow.review(); h.render(); h.setNative("other-native"); await h.workflow.review(); h.render();
    expect(h.workflow.view.currentScope).toBeNull(); expect(h.workflow.view.paired).toBe(false); expect(h.sent.filter(row => row.kind === "bootstrap")).toHaveLength(1);
    h.setNative("n"); await h.workflow.review(); h.render(); expect(h.workflow.view.currentScope?.nativeActorId).toBe("n");
    h.setRole("VIEWER"); await h.workflow.review(); h.render(); expect(h.workflow.view.currentScope).toBeNull(); h.unmount();
  });
  it("a lost health response survives auth loss and retries only explicit metadata under original native pins", async () => {
    const h = harness(); await h.workflow.review(); h.render(); const entered = deferred<void>(), response = deferred<unknown>();
    h.setHealth(async () => { entered.resolve(); return response.promise; }); const pending = h.workflow.checkPaired(); await entered.promise;
    h.emit({ id: "B", user: { id: "cl" } }); h.emit({ id: "A", user: { id: "cl" } }); response.resolve({ connected: true, version: 2 }); await pending; h.render();
    expect(h.workflow.view.paired).toBe(false); await h.workflow.review(); h.render(); expect(h.workflow.view.canCheck).toBe(true);
    expect(h.sent.filter(row => row.kind === "health")).toHaveLength(1); expect(h.sent.filter(row => row.kind === "bootstrap")).toHaveLength(1); h.unmount();
  });
  it("reported launch refusal is public/local only; manual review does not reveal pairing or run health", async () => {
    const h = harness(); await h.workflow.review(); h.render(); const count = h.sent.length; h.workflow.reportBlocked(); h.render();
    expect(h.workflow.view.status).toBe("BLOCKED"); expect(h.workflow.view.currentScope).toBeNull(); await h.workflow.review(); h.render();
    expect(h.workflow.view.status).toBe("BLOCKED"); expect(h.workflow.view.canCheck).toBe(false); expect(h.sent.filter(row => row.kind === "health")).toHaveLength(0);
    expect(h.sent.length).toBe(count + 1); expect(JSON.stringify(h.workflow.view)).not.toContain("ABCDEF"); h.unmount();
  });
  it("no health transport, refused version or changed original project/org/Clerk cannot invoke fallback operations", async () => {
    const h = harness(); await h.workflow.review(); h.render(true, false); await h.workflow.checkPaired(); expect(h.sent.filter(row => row.kind === "health")).toHaveLength(0);
    h.render(); h.setHealth(async () => ({ connected: true, version: 3 })); await h.workflow.checkPaired(); h.render(); expect(h.workflow.view.paired).toBe(false);
    const count = h.sent.length; Object.assign(h.intent, { originalOrganizationId: "foreign" }); h.render(); await h.workflow.review(); expect(h.sent).toHaveLength(count); h.unmount();
  });
  it("a single mounted SDK listener revokes access and unmount leaves no installed listener or automatic read", async () => {
    const h = harness(); expect(h.listenerCount()).toBe(1); await h.workflow.review(); h.render(); expect(h.listenerCount()).toBe(1);
    const old = h.workflow, count = h.sent.length; h.unmount(); expect(h.listenerCount()).toBe(0);
    h.emit({ id: "B", user: { id: "cl" } }); h.emit({ id: "A", user: { id: "cl" } }); await old.review(); await old.checkPaired(); expect(h.sent).toHaveLength(count);
  });
  it("missing installed listener/SDK readiness and changed raw buffer content keep current setup private", async () => {
    const h = harness(); await h.workflow.review(); h.render(); const count = h.sent.length;
    h.sdk.loaded = false; expect(h.render(false).view.currentScope).toBeNull(); await h.workflow.review(); expect(h.sent).toHaveLength(count);
    h.sdk.loaded = true; h.render(); Object.assign(h.intent, { buffers: { ...h.intent.buffers, note: "different retained draft" } });
    expect(h.render(false).view.canReview).toBe(false); expect(h.workflow.view.currentScope).toBeNull(); await h.workflow.review(); expect(h.sent).toHaveLength(count); h.unmount();
  });
  it("refuses overbound primitive buffers and missing installed listener without body serialization, substitution or transport", async () => {
    const h = harness(); await h.workflow.review(); h.render(); const count = h.sent.length;
    Object.assign(h.intent, { buffers: { note: "x".repeat(65537) } });
    expect(h.render(false).view.status).toBe("PRIVATE"); await h.workflow.review(); expect(h.sent).toHaveLength(count);
    Object.assign(h.sdk, { addListener: undefined }); expect(h.render(false).view.canReview).toBe(false); await h.workflow.checkPaired(); expect(h.sent).toHaveLength(count); h.unmount();
  });
  it.each(["throw", "void"] as const)("an installed listener returning %s never grants read/action authority", async mode => {
    const h = harness(mode); expect(h.workflow.view.canReview).toBe(false); await h.workflow.review(); await h.workflow.checkPaired();
    expect(h.sent).toEqual([]); expect(h.workflow.view.currentScope).toBeNull(); h.unmount();
  });
  it("SDK resource replacement with the same session revokes old actions before layout and requires fresh native review", async () => {
    const h = harness(); await h.workflow.review(); h.render(); const old = h.workflow, count = h.sent.length;
    h.replaceResource({ ...h.sdk }); await old.checkPaired(); await old.review(); expect(h.sent).toHaveLength(count); expect(h.render(false).view.currentScope).toBeNull();
    h.render(); await h.workflow.review(); h.render(); expect(h.workflow.view.currentScope?.nativeActorId).toBe("n");
    expect(h.sent.filter(row => row.kind === "health")).toHaveLength(0); h.unmount();
  });
  it("observed resource A-B-A cannot revive original metadata but permits a reinstalled listener and new explicit native review", async () => {
    const h = harness(); await h.workflow.review(); h.render(); const old = h.workflow, count = h.sent.length;
    h.replaceResource({ ...h.sdk }); await old.checkPaired(); h.replaceResource(h.sdk);
    expect(h.render(false).view.currentScope).toBeNull(); await old.review(); expect(h.sent).toHaveLength(count);
    h.render(); expect(h.workflow.view.currentScope).toBeNull(); await h.workflow.review(); h.render(); expect(h.workflow.view.currentScope?.nativeActorId).toBe("n");
    expect(h.sent.filter(row => row.kind === "health")).toHaveLength(0); h.unmount();
  });
  it.each(["getter", "scopeGetter", "extraBody", "oversize", "symbol"])("complete %s bootstrap metadata refuses before parsing/adoption or strict followup read", async kind => {
    const h = harness(); let getters = 0;
    h.setBootstrap(async input => {
      const good = await h.bootstrapReply(input) as Record<string, unknown>;
      if (kind === "getter") return Object.defineProperty(good, "role", { enumerable: true, get() { getters++; return "EDITOR"; } });
      if (kind === "scopeGetter") return { ...good, scope: Object.defineProperty({ projectId: "p", organizationId: "o", nativeActorId: "n", clerkActorId: "cl" }, "nativeActorId", { enumerable: true, get() { getters++; return "n"; } }) };
      if (kind === "extraBody") return { ...good, privateSource: { body: "private".repeat(50000) } };
      if (kind === "oversize") return { ...good, role: "x".repeat(50000) };
      return { ...good, [Symbol("private")]: "hidden" };
    });
    await h.workflow.review(); h.render(); expect(getters).toBe(0); expect(h.workflow.view.currentScope).toBeNull(); expect(h.sent.map(row => row.kind)).toEqual(["bootstrap"]);
    expect(JSON.stringify(h.workflow.view)).not.toContain("privateprivate"); h.unmount();
  });
});
