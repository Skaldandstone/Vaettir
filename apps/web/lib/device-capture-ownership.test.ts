import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { deviceCaptureAccessRequestText, type DeviceCaptureAccessInput } from "../../api/src/services/deviceCaptureAccessSchema";
import { DeviceCaptureOwnership, captureAccessClientRequestKey, retainCaptureJson, type CaptureSession, type DeviceCaptureFrame } from "./device-capture-ownership";

function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((r, j) => { resolve = r; reject = j; }); return { promise, resolve, reject }; }
function semantic(screen = "one", appName = "synthetic.app", deviceName = "Same model") { return { version: 1, source: "ANDROID_ADB", deviceName, appName, capturedAt: "2026-10-06T08:00:00.000Z", screens: [{ id: screen, label: " exact screen ", elements: [{ role: "button", name: " exact button " }] }] }; }
function fixture() {
  const origin = { projectId: "p", organizationId: "o", nativeActorId: "n", clerkActorId: "c" };
  let session: CaptureSession | null = { userId: "c", sessionId: "A" };
  let frame: DeviceCaptureFrame | null = { origin, active: true, loaded: true, signedIn: true, hookSession: session,
    connection: { connected: true, epoch: 1, pairingCode: "ABCDEF123456" },
    selection: { mode: "android", serial: "physical-one", approvedForegroundAppLabel: " approved foreground app " }, screenLabel: " raw label " };
  const listeners = new Set<() => void>();
  const sdk = { current: () => session, subscribe: (callback: () => void) => { listeners.add(callback); callback(); return () => { listeners.delete(callback); }; } };
  const controller = new DeviceCaptureOwnership(origin, sdk, () => frame, [{ title: " paid draft ", unknown: [0, false, null, ""] }]); controller.update(frame);
  const read = vi.fn(async (input: DeviceCaptureAccessInput) => ({ readRequestId: input.readRequestId, requestKey: await captureAccessClientRequestKey(input), scope: origin,
    role: "EDITOR", seatType: "FULL", authorization: "CURRENT_LOCKED_FULL_EDITOR_READ", processingPermissionGranted: false, foregroundTargetVerified: false, deviceOperationPerformed: false }));
  function patch(value: Partial<DeviceCaptureFrame>) { frame = { ...frame!, ...value }; controller.update(frame); }
  return { controller, origin, read, patch, frame: () => frame, setRawFrame: (value: DeviceCaptureFrame | null) => { frame = value; },
    sdkChange(value: CaptureSession | null) { session = value; listeners.forEach(callback => callback()); } };
}
describe("unmounted capture ownership foundation: synthetic transports only, no devices/providers", () => {
  it("requires explicit foreground intent/current SDK and sends only native access metadata", async () => {
    const h = fixture(); expect(h.controller.beginIntent(false)).toBeNull(); const op = h.controller.beginIntent(true)!;
    expect(h.controller.beginIntent(true)).toBeNull(); expect(h.controller.view().drafts).toEqual([]);
    expect(await h.controller.authorize(op, h.read)).toBe(true);
    expect(Object.keys(h.read.mock.calls[0]![0]).sort()).toEqual(["projectId", "originalOrganizationId", "expectedClerkActorId", "expectedNativeActorId", "readRequestId"].sort());
    expect(JSON.stringify(h.read.mock.calls)).not.toMatch(/physical-one|ABCDEF|approved foreground|raw label/);
    expect(h.controller.view().drafts).toEqual([{ title: " paid draft ", unknown: [0, false, null, ""] }]);
    expect(await captureAccessClientRequestKey(op.accessInput)).toBe(createHash("sha256").update(deviceCaptureAccessRequestText(op.accessInput)).digest("hex"));
  });
  it("rejects nonce/key/scope/role/private-extra mismatches without invoking capture", async () => {
    for (const kind of ["nonce", "key", "scope", "role", "extra"]) { const h = fixture(), op = h.controller.beginIntent(true)!;
      const read = async (input: DeviceCaptureAccessInput) => { const good = await h.read(input); return { ...good, ...(kind === "nonce" ? { readRequestId: crypto.randomUUID() } : kind === "key" ? { requestKey: "f".repeat(64) } : kind === "scope" ? { scope: { ...h.origin, nativeActorId: "other" } } : kind === "role" ? { role: "VIEWER" } : { appiumSessionId: "private" }) }; };
      expect(await h.controller.authorize(op, read)).toBe(false); const send = vi.fn(); expect(await h.controller.capture(op, send)).toBe(false); expect(send).not.toHaveBeenCalled(); }
  });
  it("marks access busy before hash and suppresses duplicate authorization", async () => {
    const h = fixture(), op = h.controller.beginIntent(true)!, entered = deferred<void>(), reply = deferred<unknown>();
    const pending = h.controller.authorize(op, async () => { entered.resolve(); return reply.promise; });
    expect(await h.controller.authorize(op, h.read)).toBe(false); await entered.promise; reply.resolve(await h.read(op.accessInput)); expect(await pending).toBe(true); expect(h.read).toHaveBeenCalledTimes(1);
  });
  it("late fresh access reply after selection change cannot authorize a new device", async () => {
    const h = fixture(), op = h.controller.beginIntent(true)!, entered = deferred<void>(), reply = deferred<unknown>();
    const pending = h.controller.authorize(op, async () => { entered.resolve(); return reply.promise; }); await entered.promise;
    h.patch({ selection: { mode: "android", serial: "physical-two", approvedForegroundAppLabel: " approved foreground app " } }); reply.resolve(await h.read(op.accessInput));
    expect(await pending).toBe(false); const send = vi.fn(); expect(await h.controller.capture(op, send)).toBe(false); expect(send).not.toHaveBeenCalled(); expect(h.controller.view().drafts).toEqual([]);
  });
  it("SDK A-B-A with no hook update permanently revokes old admitted action", async () => {
    const h = fixture(), op = h.controller.beginIntent(true)!; await h.controller.authorize(op, h.read);
    h.sdkChange({ userId: "c", sessionId: "B" }); h.sdkChange({ userId: "c", sessionId: "A" }); const send = vi.fn();
    expect(await h.controller.capture(op, send)).toBe(false); expect(send).not.toHaveBeenCalled(); expect(h.controller.view().drafts).toEqual([]);
    h.controller.update(h.frame()); const next = h.controller.beginIntent(true)!; expect(next.id).not.toBe(op.id); expect(await h.controller.authorize(next, h.read)).toBe(true);
  });
  it("same-tick raw frame change before update refuses stale invoke", async () => {
    const h = fixture(), op = h.controller.beginIntent(true)!; await h.controller.authorize(op, h.read);
    h.setRawFrame({ ...h.frame()!, screenLabel: "new intent" }); const send = vi.fn(); expect(await h.controller.capture(op, send)).toBe(false); expect(send).not.toHaveBeenCalled();
  });
  it("private busy precedes send; exact raw request retains labels without appName override", async () => {
    const h = fixture(), op = h.controller.beginIntent(true)!; await h.controller.authorize(op, h.read); const entered = deferred<void>(), response = deferred<unknown>();
    const send = vi.fn(async (request, pairing, signal) => { expect(Object.isFrozen(request)).toBe(true); expect(request).toEqual({ source: "android", serial: "physical-one", label: " raw label " }); expect(pairing).toBe("ABCDEF123456"); expect(signal).toBeInstanceOf(AbortSignal); entered.resolve(); return response.promise; });
    const pending = h.controller.capture(op, send); await entered.promise; expect(h.controller.view().busy).toBe(true); expect(await h.controller.capture(op, send)).toBe(false); response.resolve({ capture: semantic() }); expect(await pending).toBe(true);
    expect(send).toHaveBeenCalledTimes(1); expect(h.controller.view().capture?.screens[0]?.label).toBe(" exact screen "); expect(Object.isFrozen(h.controller.view().capture)).toBe(true);
  });
  it("lost response is uncertain, never proof no operation or an automatic retry", async () => {
    const h = fixture(), op = h.controller.beginIntent(true)!; await h.controller.authorize(op, h.read); const send = vi.fn(async () => { throw Error("private provider credential must not escape"); });
    expect(await h.controller.capture(op, send)).toBe(false); expect(h.controller.view().uncertain).toBe(true); expect(h.controller.beginIntent(true)).toBeNull(); expect(await h.controller.capture(op, send)).toBe(false); expect(send).toHaveBeenCalledTimes(1);
  });
  it.each(["ios-connected", "ios-remote"] as const)("%s sends only exact original local session fields, never an appName override", async mode => {
    const h = fixture(), url = mode === "ios-connected" ? "http://127.0.0.1:4723" : "https://synthetic.invalid/wd/hub"; h.patch({ selection: { mode, appiumUrl: url, appiumSessionId: " exact private session ", approvedForegroundAppLabel: "approved foreground app" } });
    const op = h.controller.beginIntent(true)!; expect(await h.controller.authorize(op, h.read)).toBe(true);
    const send = vi.fn(async request => { expect(request).toEqual({ source: mode, label: " raw label ", appiumUrl: url, sessionId: " exact private session " }); return { capture: { ...semantic(), source: mode === "ios-connected" ? "IOS_CONNECTED" : "IOS_REMOTE" } }; });
    expect(await h.controller.capture(op, send)).toBe(true); expect(JSON.stringify(h.read.mock.calls)).not.toContain("private session"); expect(h.controller.view().capture?.source).toBe(mode === "ios-connected" ? "IOS_CONNECTED" : "IOS_REMOTE");
  });
  it.each(["collapse", "auth", "helper", "mode", "SDK"])("%s change aborts in-flight ownership and ignores late result", async kind => {
    const h = fixture(), op = h.controller.beginIntent(true)!; await h.controller.authorize(op, h.read); const entered = deferred<void>(), reply = deferred<unknown>(); let signal: AbortSignal | undefined;
    const pending = h.controller.capture(op, async (_request, _pairing, currentSignal) => { signal = currentSignal; entered.resolve(); return reply.promise; }); await entered.promise;
    if (kind === "SDK") { h.sdkChange({ userId: "other", sessionId: "B" }); h.sdkChange({ userId: "c", sessionId: "A" }); }
    else h.patch(kind === "collapse" ? { active: false } : kind === "auth" ? { signedIn: false } : kind === "helper" ? { connection: { ...h.frame()!.connection, epoch: 2 } } : { selection: { mode: "ios-remote", appiumUrl: "https://synthetic.invalid", appiumSessionId: "synthetic-session", approvedForegroundAppLabel: "another source" } });
    expect(signal?.aborted).toBe(true); reply.resolve({ capture: semantic() }); expect(await pending).toBe(false); expect(h.controller.view().capture).toBeNull(); expect(h.controller.view().drafts).toEqual([]); expect(h.controller.beginIntent(true)).toBeNull();
  });
  it("same-model different physical serial never aliases prior captures", async () => {
    const h = fixture(); async function record(id: string) { const op = h.controller.beginIntent(true)!; expect(await h.controller.authorize(op, h.read)).toBe(true); expect(await h.controller.capture(op, async () => ({ capture: semantic(id) }))).toBe(true); }
    await record("one"); h.patch({ selection: { mode: "android", serial: "physical-two", approvedForegroundAppLabel: " approved foreground app " } }); await record("two"); expect(h.controller.view().capture?.screens.map(screen => screen.id)).toEqual(["two"]);
    h.patch({ selection: { mode: "android", serial: "physical-one", approvedForegroundAppLabel: " approved foreground app " } }); const next = h.controller.beginIntent(true)!; await h.controller.authorize(next, h.read); expect(h.controller.view().capture?.screens.map(screen => screen.id)).toEqual(["one"]);
  });
  it("original captured values/paid drafts remain private across foreign origin and require a new read on return", async () => {
    const h = fixture(); let op = h.controller.beginIntent(true)!; await h.controller.authorize(op, h.read); await h.controller.capture(op, async () => ({ capture: semantic() }));
    h.patch({ origin: { ...h.origin, organizationId: "foreign" } }); expect(h.controller.view().capture).toBeNull(); expect(h.controller.beginIntent(true)).toBeNull();
    h.patch({ origin: h.origin }); expect(h.controller.view().capture).toBeNull(); op = h.controller.beginIntent(true)!; await h.controller.authorize(op, h.read);
    expect(h.controller.view().capture?.screens[0]?.label).toBe(" exact screen "); expect(h.controller.view().drafts).toEqual([{ title: " paid draft ", unknown: [0, false, null, ""] }]);
  });
  it("whole25-screen limit refuses26 without truncating the retained25", async () => {
    const h = fixture(), body = semantic(); body.screens = Array.from({ length: 25 }, (_, index) => ({ ...body.screens[0]!, id: `s${index}` })); let op = h.controller.beginIntent(true)!; await h.controller.authorize(op, h.read); expect(await h.controller.capture(op, async () => ({ capture: body }))).toBe(true);
    op = h.controller.beginIntent(true)!; await h.controller.authorize(op, h.read); expect(await h.controller.capture(op, async () => ({ capture: semantic("s25") }))).toBe(false); expect(h.controller.view().unsupported).toBe(true); expect(h.controller.view().capture?.screens).toHaveLength(25);
  });
  it.each(["app", "duplicate", "elements", "unknown", "source"])("unsupported %s retains prior complete capture without replacement", async kind => {
    const h = fixture(); let op = h.controller.beginIntent(true)!; await h.controller.authorize(op, h.read); await h.controller.capture(op, async () => ({ capture: semantic() }));
    op = h.controller.beginIntent(true)!; await h.controller.authorize(op, h.read); const next = semantic(kind === "duplicate" ? "one" : "two", kind === "app" ? "another.app" : "synthetic.app");
    const raw = kind === "unknown" ? { ...next, unknown: [0, null] } : kind === "source" ? { ...next, source: "IOS_REMOTE" } : next;
    if (kind === "elements") next.screens[0]!.elements = Array.from({ length: 151 }, () => ({ role: "button", name: "name" }));
    expect(await h.controller.capture(op, async () => ({ capture: raw }))).toBe(false); expect(h.controller.view().capture?.screens.map(screen => screen.id)).toEqual(["one"]); expect(h.controller.view().unsupported).toBe(true);
  });
  it("private credentials in Appium URL and invalid origin/full intent refuse before hosted read", () => {
    const h = fixture(); h.patch({ selection: { mode: "ios-remote", appiumUrl: "https://user:secret@synthetic.invalid", appiumSessionId: "s", approvedForegroundAppLabel: "app" } }); expect(h.controller.beginIntent(true)).toBeNull();
    h.patch({ origin: { ...h.origin, nativeActorId: "other" } }); expect(h.controller.beginIntent(true)).toBeNull(); expect(h.read).not.toHaveBeenCalled();
  });
  it("plain JSON bounds refuse getters, nonfinite/rounded scalars, cycles and oversized whole values", () => {
    const getter = vi.fn(); expect(() => retainCaptureJson({ get secret() { getter(); return "never"; } })).toThrow(); expect(getter).not.toHaveBeenCalled();
    const cyclic: { value?: unknown } = {}; cyclic.value = cyclic;
    for (const raw of [cyclic, { number: NaN }, { number: 9007199254740992 }, { number: -0 }, { date: new Date() }, "x".repeat(8388609)]) expect(() => retainCaptureJson(raw)).toThrow();
    expect(retainCaptureJson({ values: [0, false, null, "", " exact\n prose "] })).toEqual({ values: [0, false, null, "", " exact\n prose "] });
    const shared = { value: "same exact repeated field" }; expect(retainCaptureJson([shared, shared])).toEqual([shared, shared]);
  });
});
