import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { DeviceCapturePublicationOwner, capturePublicationRefusal } from "./device-capture-publication-lease";
import { captureJsonContentCost, fitsCaptureRetainedContent, retainCaptureJson } from "./device-capture-ownership";
import { ownedDeviceSemanticCapture } from "../../api/src/services/deviceCaptureAccessSchema";
import { currentSessionScope } from "./auth-query-cache";
import * as connections from "./device-connector-connection";
import { DEVICE_HELPER_HEALTH_URL, deviceHelperHealthResponseRefusal, readDeviceHelperHealthResponse } from "./device-helper-health-response";

const source = readFileSync(new URL("../app/projects/[projectId]/live-app-generation/page.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), printer = ts.createPrinter();
const page = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "LiveAppGenerationPage");
if (!page || !ts.isFunctionDeclaration(page) || !page.body) throw Error("Actual page function unavailable");
const names = ["currentCaptureClientScope", "ownsCaptureClientScope", "captureInputFrameKey", "updateCaptureInput", "retainLiveValue", "currentCaptureFrame", "generate", "selectCapture", "captureCurrentScreen", "commit", "discard", "connectorRequest", "discoverAndroidDevices", "refreshAndroidDevices", "connectToDeviceConnector", "cancelHelperSetupChecks"];
const ownerClass = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === "LiveCapturePageOwnership");
if (!ownerClass) throw Error("Actual mounted ownership class unavailable");
const handlers = page.body.statements.filter(node => ts.isFunctionDeclaration(node) && !!node.name && names.includes(node.name.text));
const sdkEffect = page.body.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) &&
  node.expression.expression.getText(ast) === "useLayoutEffect" && node.expression.arguments[0]?.getText(ast).includes("captureSdk.subscribe"));
if (!sdkEffect || !ts.isExpressionStatement(sdkEffect) || !ts.isCallExpression(sdkEffect.expression)) throw Error("Actual SDK effect unavailable");
const connectionEffect = page.body.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) &&
  node.expression.expression.getText(ast) === "useLayoutEffect" && node.expression.arguments[0]?.getText(ast).includes("const connection = connectionAttemptRef.current"));
if (!connectionEffect || !ts.isExpressionStatement(connectionEffect) || !ts.isCallExpression(connectionEffect.expression)) throw Error("Actual connection effect unavailable");
const presentationNames = ["presentationSession", "presentationScope", "captureInputsAllowed", "presentedCapture", "presentedDrafts", "presentedCommittedTitles"];
const presentation = page.body.statements.filter(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => ts.isIdentifier(declaration.name) && presentationNames.includes(declaration.name.text)));
const code = ts.transpileModule([printer.printNode(ts.EmitHint.Unspecified, ownerClass, ast), ...handlers.map(node => printer.printNode(ts.EmitHint.Unspecified, node, ast)),
  "env.sdkEffect=" + sdkEffect.expression.arguments[0]!.getText(ast) + ";", "env.connectionEffect=" + connectionEffect.expression.arguments[0]!.getText(ast) + ";",
  "env.present=()=>{" + presentation.map(node => printer.printNode(ts.EmitHint.Unspecified, node, ast)).join("\n") + ";return {presentationScope,presentedCapture,presentedDrafts,presentedCommittedTitles,captureInputsAllowed};};",
  "env.Owner=LiveCapturePageOwnership;", ...names.map(name => `env.${name}=${name};`)].join("\n"),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const sdkSource = readFileSync(new URL("./use-device-helper-setup.ts", import.meta.url), "utf8"), sdkAst = ts.createSourceFile("sdk.ts", sdkSource, ts.ScriptTarget.Latest, true);
const sdkCode = ts.transpileModule(sdkAst.statements.filter(node => ts.isFunctionDeclaration(node) && !!node.name && ["helperResource", "currentHelperSetupSession", "createInstalledHelperSdk"].includes(node.name.text))
  .map(node => printer.printNode(ts.EmitHint.Unspecified, node, sdkAst).replace(/\bexport\s+/g, "")).join("\n") + "\nreturn createInstalledHelperSdk();",
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
type Scope = { projectId: string; organizationId: string; clerkActorId: string; sessionId: string; sdkGeneration: number; uiEpoch: number; connectionEpoch: number; mode: string };
type Read = { projectId: string; organizationId: string; actor: { isLoaded: boolean; isSignedIn: boolean; userId: string; sessionId: string }; helperActorAllowed: boolean;
  captureMode: string; startUrl: string; screenLabel: string; deviceSerial: string; appiumUrl: string; appiumSessionId: string; pairingCode: string };
type Owner = { read: Read; retained: Array<{ kind: string; value: unknown; cost?: { bytes: number; nodes: number } }>; commitLabels: Array<{ scope: Scope; label: { title: string } }>; owner: DeviceCapturePublicationOwner | null; epoch: number; observers: Set<() => void>;
  bind(read: Read): void; bindDrafts(drafts: unknown): void; setCaptureScope(scope: Scope): void; setDraftScope(scope: Scope): void };
type Handlers = { currentCaptureClientScope(): Scope | null; ownsCaptureClientScope(scope: Scope | null): boolean; updateCaptureInput(patch: Partial<Read>): void;
  selectCapture(file?: { size: number; text(): Promise<string> }): Promise<void>; captureCurrentScreen(): Promise<void>; generate(): Promise<void>; commit(index: number): Promise<void>; discard(index: number): void;
  refreshAndroidDevices(): Promise<void>; connectToDeviceConnector(): Promise<void>; cancelHelperSetupChecks(): void; sdkEffect(): () => void; connectionEffect(): () => void;
  present(): { presentationScope: Scope | null; presentedCapture: unknown; presentedDrafts: unknown; presentedCommittedTitles: string[]; captureInputsAllowed: boolean }; Owner: new(read: Read) => Owner };
function deferred<T>() { let resolve!: (value: T) => void, reject!: (cause: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const valid = () => ({ version: 1, source: "ANDROID_ADB", deviceName: "SYNTHETIC DEVICE", appName: "SYNTHETIC APP", capturedAt: "2026-10-06T12:00:00.000Z",
  screens: [{ id: "s1", label: " Exact\nfile label ", elements: [{ role: "button", name: " Exact raw control " }] }] });
function harness() {
  const listeners = new Set<() => void>(), clerk = { loaded: true, session: { id: "A", user: { id: "u" } }, addListener(callback: () => void) { listeners.add(callback); callback(); return () => listeners.delete(callback); } };
  const browser = { Clerk: clerk }, sdk = new Function("window", "currentSessionScope", sdkCode)(browser, currentSessionScope);
  const read: Read = { projectId: "p", organizationId: "o", actor: { isLoaded: true, isSignedIn: true, userId: "u", sessionId: "A" }, helperActorAllowed: true,
    captureMode: "android", startUrl: "https://synthetic.example", screenLabel: " Exact label ", deviceSerial: "DEVICE-A", appiumUrl: "https://synthetic.example/wd/hub", appiumSessionId: "SYNTHETIC-SESSION", pairingCode: "ABCDEF123456" };
  const initialCapture = valid(), initialDrafts = [{ title: " Legacy paid draft ", source: "synthetic" }];
  const values: Record<string, unknown> = { deviceCapture: initialCapture, drafts: initialDrafts, error: null, generating: false, busyIndex: null, committedTitles: [], scannedUrl: "original synthetic scope",
    captureMode: read.captureMode, startUrl: read.startUrl, screenLabel: read.screenLabel, deviceSerial: read.deviceSerial, appiumUrl: read.appiumUrl, appiumSessionId: read.appiumSessionId,
    connectorStatus: "connected", discoveringDevices: false, manualSetupOpen: false, manualSetupRevealed: false, helperMetadataCancellationEpoch: 0 };
  const queued: Array<() => void> = []; let delaySetters = false;
  const env: Record<string, unknown> = { ...values, ...connections, DeviceCapturePublicationOwner, capturePublicationRefusal, captureJsonContentCost, fitsCaptureRetainedContent, retainCaptureJson, ownedDeviceSemanticCapture,
    captureSdk: sdk, helperActorAllowed: true, actor: read.actor, projectId: "p", helperOrganizationId: "o", connectionAttemptRef: { current: connections.createDeviceConnectionGeneration() }, discoveryAttemptRef: { current: 0 },
    DEVICE_HELPER_HEALTH_URL, deviceHelperHealthResponseRefusal, readDeviceHelperHealthResponse,
    CONNECTOR_URL: "http://127.0.0.1:4774", CAPTURE_DISPATCH_GAP: "Native foreground verification and scoped consent are not implemented. No device request was made.",
    AbortController, DOMException, fetch: vi.fn(async () => { throw Error("No real/synthetic device HTTP dispatch allowed in this fixture"); }),
    window: { setTimeout: () => 1, clearTimeout: () => undefined }, pairingCode: read.pairingCode,
    generateMutation: { mutateAsync: vi.fn(async () => []) }, generateDeviceMutation: { mutateAsync: vi.fn(async () => []) }, commitMutation: { mutateAsync: vi.fn(async () => undefined) },
    setCaptureSdkRevision: vi.fn(), setDiscoveringDevices: vi.fn(), setAndroidDevices: vi.fn() };
  for (const key of Object.keys(values)) env[`set${key[0]?.toUpperCase()}${key.slice(1)}`] = (next: unknown) => {
    const update = () => { const value = typeof next === "function" ? next(env[key]) : next; env[key] = value; values[key] = value; if (key === "drafts") (env.capturePage as Owner).bindDrafts(value); };
    if (delaySetters) queued.push(update); else update();
  };
  // Trusted local declarations only; no component/module initialization, DOM,
  // user/vendor source evaluation or real HTTP/provider/service execution.
  new Function("env", `with(env){${code}}`)(env);
  const handlers = env as unknown as Handlers;
  const owner = new handlers.Owner(read); env.capturePage = owner;
  owner.bindDrafts(initialDrafts);
  const cleanup = handlers.sdkEffect();
  owner.setCaptureScope(handlers.currentCaptureClientScope()!); owner.setDraftScope(handlers.currentCaptureClientScope()!);
  function emit(id: string, user = "u") { clerk.session = { id, user: { id: user } }; listeners.forEach(callback => callback()); }
  return { handlers, owner, env, values, read, initialCapture, initialDrafts, emit, browser,
    holdSetters(value = true) { delaySetters = value; }, flush() { queued.splice(0).forEach(callback => callback()); }, cleanup,
    generation: env.generateDeviceMutation as { mutateAsync: ReturnType<typeof vi.fn> }, webGeneration: env.generateMutation as { mutateAsync: ReturnType<typeof vi.fn> }, commitMutation: env.commitMutation as { mutateAsync: ReturnType<typeof vi.fn> } };
}
const file = (text: string) => ({ size: new TextEncoder().encode(text).length, text: vi.fn(async () => text) });

describe("actual live-app handlers + mounted ownership/installed SDK; synthetic IO only", () => {
  it("actual explicit health transition and following import share the presentation epoch; liveness still grants no capture", async () => {
    const h = harness(), bytes = new TextEncoder().encode('{"connected":true,"version":2}'); let delivered = false;
    const reader = { read: vi.fn(async () => delivered ? { done: true, value: undefined } : (delivered = true, { done: false, value: bytes })), cancel: vi.fn(), releaseLock: vi.fn() };
    (h.env.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ url: DEVICE_HELPER_HEALTH_URL, status: 200, redirected: false,
      headers: { get: (key: string) => key === "content-type" ? "application/json" : String(bytes.length) }, body: { getReader: () => reader } });
    await h.handlers.connectToDeviceConnector(); expect(h.values.connectorStatus).toBe("connected");
    await h.handlers.selectCapture(file(JSON.stringify(valid())));
    expect(h.handlers.present().presentationScope).toEqual(h.handlers.currentCaptureClientScope()); expect(h.handlers.present().presentedCapture).toBe(h.values.deviceCapture);
    await h.handlers.captureCurrentScreen(); expect(h.env.fetch).toHaveBeenCalledOnce(); expect(h.values.error).toContain("No device request was made"); h.cleanup();
  });
  it("actual layout revoke/cleanup and public cancellation synchronously synchronize presentation ownership without deleting buffers", async () => {
    const h = harness(), cleanupConnection = h.handlers.connectionEffect();
    await h.handlers.selectCapture(file(JSON.stringify(valid()))); expect(h.handlers.present().presentationScope).toEqual(h.handlers.currentCaptureClientScope());
    const retained = h.values.deviceCapture; h.handlers.cancelHelperSetupChecks();
    expect(h.handlers.present().presentationScope).toEqual(h.handlers.currentCaptureClientScope()); expect(h.handlers.present().presentedCapture).toBeNull(); expect(h.values.deviceCapture).toBe(retained);
    cleanupConnection(); expect(h.handlers.present().presentationScope).toEqual(h.handlers.currentCaptureClientScope()); expect(h.values.deviceCapture).toBe(retained); expect(h.values.drafts).toBe(h.initialDrafts); h.cleanup();
  });
  it("actual capture refuses the absent native target/consent gate with zero dispatch and all entered/legacy values intact", async () => {
    const h = harness(); await h.handlers.captureCurrentScreen(); expect(h.env.fetch).not.toHaveBeenCalled();
    expect(h.values.error).toContain("No device request was made"); expect(h.values.deviceCapture).toBe(h.initialCapture); expect(h.values.drafts).toBe(h.initialDrafts);
    expect(h.values.screenLabel).toBe(" Exact label "); expect(h.owner.owner?.retainedMetadata()?.legacyUnattributedValues).toBe(2); h.cleanup();
  });
  it("actual mode/target changes revoke synchronously and never erase original capture or paid drafts", () => {
    const h = harness(), scope = h.handlers.currentCaptureClientScope()!; h.handlers.updateCaptureInput({ captureMode: "ios-remote", deviceSerial: "DEVICE-B" });
    expect(h.handlers.ownsCaptureClientScope(scope)).toBe(false); expect(h.values.deviceCapture).toBe(h.initialCapture); expect(h.values.drafts).toBe(h.initialDrafts);
    expect(h.values.captureMode).toBe("ios-remote"); expect(h.owner.read.deviceSerial).toBe("DEVICE-B"); h.cleanup();
  });
  it("failed/overbound/unsupported imports keep original pointers, emit generic errors and never run a device or provider", async () => {
    for (const selected of [file("private malformed provider-like content"), file(JSON.stringify({ ...valid(), private: "SYNTHETIC PRIVATE" })), { size: 8388609, text: vi.fn(async () => "must not read") }]) {
      const h = harness(); await h.handlers.selectCapture(selected); expect(h.values.deviceCapture).toBe(h.initialCapture); expect(h.values.drafts).toBe(h.initialDrafts);
      expect(h.values.error).toContain("complete selected capture file"); expect(h.values.error).not.toMatch(/SYNTHETIC PRIVATE|provider-like/); expect(h.env.fetch).not.toHaveBeenCalled(); expect(h.generation.mutateAsync).not.toHaveBeenCalled(); h.cleanup();
    }
  });
  it("current exact import publishes the privately retained immutable pointer without trimming or claiming device proof", async () => {
    const h = harness(); await h.handlers.selectCapture(file(JSON.stringify(valid())));
    expect(h.values.deviceCapture).not.toBe(h.initialCapture); expect((h.values.deviceCapture as ReturnType<typeof valid>).screens[0]?.label).toBe(" Exact\nfile label ");
    expect(Object.isFrozen(h.values.deviceCapture)).toBe(true); expect(h.owner.retained.find(value => value.kind === "CAPTURE")?.value).toBe(h.values.deviceCapture);
    expect(h.env.fetch).not.toHaveBeenCalled(); expect(h.values.drafts).toBe(h.initialDrafts); h.cleanup();
  });
  it("late file completion after target/mode or independent SDK A-B-A stays private; stale errors do not publish", async () => {
    for (const change of ["target", "mode", "sdk"]) {
      const h = harness(), entered = deferred<string>(), pending = h.handlers.selectCapture({ size: 1000, text: () => entered.promise });
      if (change === "sdk") { h.emit("B"); h.emit("A"); }
      else h.handlers.updateCaptureInput(change === "target" ? { deviceSerial: "DEVICE-B" } : { captureMode: "ios-remote" });
      entered.resolve(JSON.stringify(valid())); await pending; expect(h.values.deviceCapture).toBe(h.initialCapture); expect(h.values.error).toBeNull();
      expect(h.owner.retained.filter(value => value.kind === "CAPTURE")).toHaveLength(1); expect(h.values.screenLabel).toBe(" Exact label "); h.cleanup();
    }
  });
  it("functional import setter rechecks current original scope when React commits it later", async () => {
    const h = harness(); h.holdSetters(); await h.handlers.selectCapture(file(JSON.stringify(valid()))); h.emit("B"); h.emit("A"); h.flush();
    expect(h.values.deviceCapture).toBe(h.initialCapture); expect(h.owner.retained.filter(value => value.kind === "CAPTURE")).toHaveLength(1); h.cleanup();
  });
  it("current independent session/org/read admission refuses intake/capture before any IO", async () => {
    for (const change of ["sdk", "org", "readonly", "loaded"]) {
      const h = harness(); if (change === "sdk") h.emit("B", "other");
      if (change === "org") h.owner.bind({ ...h.read, organizationId: "other", helperActorAllowed: false });
      if (change === "readonly") h.owner.bind({ ...h.read, helperActorAllowed: false });
      if (change === "loaded") h.owner.bind({ ...h.read, actor: { ...h.read.actor, isLoaded: false } });
      const selected = file(JSON.stringify(valid())); await h.handlers.selectCapture(selected); await h.handlers.captureCurrentScreen();
      expect(selected.text).not.toHaveBeenCalled(); expect(h.env.fetch).not.toHaveBeenCalled(); expect(h.values.deviceCapture).toBe(h.initialCapture); expect(h.values.drafts).toBe(h.initialDrafts); h.cleanup();
    }
  });
  it("generation presentation preserves old paid drafts, blocks same-tick double invocation and retains late bodies privately", async () => {
    const h = harness(), response = deferred<unknown>(); h.generation.mutateAsync.mockImplementation(() => response.promise);
    const first = h.handlers.generate(), second = h.handlers.generate(); expect(h.generation.mutateAsync).toHaveBeenCalledOnce(); expect(h.values.drafts).toBe(h.initialDrafts);
    h.emit("B"); h.emit("A"); response.resolve([{ title: " Later synthetic paid result " }]); await Promise.all([first, second]);
    expect(h.values.drafts).toBe(h.initialDrafts); expect(h.values.scannedUrl).toBe("original synthetic scope"); expect(h.owner.retained.filter(value => value.kind === "DRAFTS")).toHaveLength(1);
    expect(h.values.generating).toBe(true); expect(h.env.fetch).not.toHaveBeenCalled(); h.cleanup();
  });
  it("old commit ACK/finally cannot delete a newer list by index or clear another frame's busy state", async () => {
    const h = harness(), ack = deferred<void>(); h.commitMutation.mutateAsync.mockImplementation(() => ack.promise);
    const pending = h.handlers.commit(0); expect(h.commitMutation.mutateAsync).toHaveBeenCalledOnce();
    const newer = [{ title: "Newer synthetic list" }]; h.env.drafts = newer; h.values.drafts = newer; h.emit("B"); h.emit("A"); ack.resolve(); await pending;
    expect(h.values.drafts).toBe(newer); expect(h.values.busyIndex).toBe(0); expect(h.values.committedTitles).toEqual([]); expect(h.owner.retained.filter(value => value.kind === "DRAFTS")).toHaveLength(1); h.cleanup();
  });
  it("only raw current commit labels are presented; an eligible different project/org and new draft never reveal original or legacy labels", async () => {
    const h = harness(); h.env.committedTitles = [" Legacy unscoped title "]; h.values.committedTitles = h.env.committedTitles;
    await h.handlers.commit(0); expect(h.handlers.present().presentedCommittedTitles).toEqual([" Legacy paid draft "]);
    expect(h.values.committedTitles).toEqual([" Legacy unscoped title "]); expect(h.owner.commitLabels).toHaveLength(1);
    const nextRead = { ...h.read, projectId: "p2", organizationId: "o2" }; h.owner.bind(nextRead); h.env.projectId = "p2"; h.env.helperOrganizationId = "o2";
    const nextDrafts = [{ title: " Different eligible draft " }]; h.env.drafts = nextDrafts; h.values.drafts = nextDrafts; h.owner.bindDrafts(nextDrafts); h.owner.setDraftScope(h.handlers.currentCaptureClientScope()!);
    expect(h.handlers.present().presentedDrafts).toBe(nextDrafts); expect(h.handlers.present().presentedCommittedTitles).toEqual([]);
    expect(h.owner.commitLabels[0]?.label.title).toBe(" Legacy paid draft "); expect(h.values.committedTitles).toEqual([" Legacy unscoped title "]); h.cleanup();
  });
  it("captured stale Save handler cannot dispatch a superseded same-scope draft list", async () => {
    const h = harness(), newer = [{ title: " Newer exact synthetic list " }];
    h.owner.bindDrafts(newer);
    await h.handlers.commit(0);
    expect(h.commitMutation.mutateAsync).not.toHaveBeenCalled();
    expect(h.owner.commitLabels).toHaveLength(0); expect(h.owner.retained).toHaveLength(0);
    expect(h.values.drafts).toBe(h.initialDrafts); h.cleanup();
  });
  it("late SDK/project ACK or replaced same-scope draft pointer never appends scoped commit labels", async () => {
    for (const change of ["sdk", "project", "pointer"]) {
      const h = harness(), ack = deferred<void>(); h.commitMutation.mutateAsync.mockImplementation(() => ack.promise); const pending = h.handlers.commit(0);
      if (change === "sdk") { h.emit("B"); h.emit("A"); }
      if (change === "project") h.owner.bind({ ...h.read, projectId: "p2", organizationId: "o2" });
      if (change === "pointer") h.owner.bindDrafts([{ title: "newer" }]);
      ack.resolve(); await pending; expect(h.owner.commitLabels).toHaveLength(0); expect(h.handlers.present().presentedCommittedTitles).toEqual([]); h.cleanup();
    }
  });
  it("label count or retained content refusal prevents commit dispatch without eviction or clipping", async () => {
    for (const cap of ["count", "budget", "label-budget"]) {
      const h = harness();
      if (cap === "count") for (let i = 0; i < 100; i++) h.owner.commitLabels.push({ scope: h.handlers.currentCaptureClientScope()!, label: { title: `synthetic-${i}` } });
      else if (cap === "budget") { const huge = [{ title: "x".repeat(8388609) }]; h.env.drafts = huge; h.values.drafts = huge; h.owner.bindDrafts(huge); }
      else {
        const scope = h.handlers.currentCaptureClientScope()!, draftsCost = captureJsonContentCost({ scope, kind: "DRAFTS", value: h.initialDrafts });
        h.owner.retained.push({ kind: "DRAFTS", value: "synthetic accounting fixture", cost: { bytes: 32 * 1024 * 1024 - draftsCost.bytes, nodes: 1 } });
      }
      const original = h.values.drafts; await h.handlers.commit(0); expect(h.commitMutation.mutateAsync).not.toHaveBeenCalled(); expect(h.values.drafts).toBe(original); expect(h.values.committedTitles).toEqual([]); h.cleanup();
      if (cap === "label-budget") { expect(h.owner.retained).toHaveLength(2); expect(h.owner.commitLabels).toHaveLength(0); }
    }
  });
  it("actual generic discovery transport errors never display raw connector/provider messages", async () => {
    const h = harness(); (h.env.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: "SYNTHETIC PRIVATE PROVIDER TOKEN" }) });
    await h.handlers.refreshAndroidDevices(); expect(h.values.error).toContain("Device discovery did not return"); expect(h.values.error).not.toContain("TOKEN"); h.cleanup();
  });
  it("source has no capture fetch/trim/25-screen clipping/reset, and paid request bodies remain existing APIs not a recovery claim", () => {
    const capture = handlers.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "captureCurrentScreen")!.getText(ast);
    expect(capture).not.toMatch(/connectorRequest|fetch\(|\.trim\(|\.slice\(|setScreenLabel|setCapturing/); expect(capture).toContain("CAPTURE_DISPATCH_GAP");
    expect(source).not.toContain("setDeviceCapture(null)"); expect(source).not.toContain("setDrafts(null)");
    expect(source).toContain("Existing paid mutation/receipt/recovery"); expect(source).toContain("foreground unverified");
    expect(source).not.toContain("setCommittedTitles"); expect(source).toContain("{presentedCommittedTitles.join"); expect(source).not.toContain("{committedTitles.join");
  });
});
