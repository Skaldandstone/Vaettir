import { describe, expect, it, vi } from "vitest";
import { DeviceCapturePublicationOwner, type CapturePublicationFrame, type CapturePublicationOrigin } from "./device-capture-publication-lease";
import type { CaptureSession, LocalCaptureRequest } from "./device-capture-ownership";

function fixture(prior: readonly unknown[] = [{ title: " Legacy paid draft\nexact ", note: null }]) {
  const origin: CapturePublicationOrigin = { projectId: "p", organizationId: "o", clerkActorId: "u" };
  let session: CaptureSession | null = { userId: "u", sessionId: "A" }, generation = 0;
  const listeners = new Set<() => void>(), cleanup = vi.fn();
  const sdk = { current: () => session, generation: () => generation, subscribe: (callback: () => void) => { listeners.add(callback); return () => { cleanup(); listeners.delete(callback); }; } };
  let frame: CapturePublicationFrame = { origin, active: true, readable: true, session, connection: { epoch: 1, pairingCode: "ABCDEF123456" }, selection: { mode: "android", serial: "DEVICE-A" }, screenLabel: " Exact\nlabel " };
  const owner = new DeviceCapturePublicationOwner(origin, sdk, () => frame, prior); owner.update(frame);
  const request = (): LocalCaptureRequest => frame.selection.mode === "android" ? { source: frame.selection.mode, label: frame.screenLabel, serial: frame.selection.serial } :
    { source: frame.selection.mode, label: frame.screenLabel, appiumUrl: frame.selection.appiumUrl, sessionId: frame.selection.appiumSessionId };
  return { owner, sdk, cleanup, prior, request, get frame() { return frame; }, replace(value: CapturePublicationFrame) { frame = value; owner.update(frame); },
    move(patch: Partial<CapturePublicationFrame>) { frame = { ...frame, ...patch }; owner.update(frame); },
    sdkOnly(value: CaptureSession | null, resourceChanged = false) { session = value; if (resourceChanged) generation++; listeners.forEach(callback => callback()); },
    restore() { frame = { ...frame, session }; owner.update(frame); }, listenerCount: () => listeners.size };
}
const capture = (id = "s1", patch = {}) => ({ capture: { version: 1, source: "ANDROID_ADB", deviceName: "Same model", appName: "Synthetic app", capturedAt: "2026-10-06T12:00:00.000Z",
  screens: [{ id, label: " Exact\nlabel ", elements: [{ role: "button", name: " Exact raw name " }] }], ...patch } });

describe("pure private capture publication leases; no transport/device/provider actions", () => {
  it("pins exact raw frame/request, private busy precedes any await and result never grants target/processing/spend", () => {
    const h = fixture(), lease = h.owner.begin(h.request()); expect(lease).not.toBeNull(); expect(h.owner.currentStatus().busy).toBe(true);
    expect(h.owner.begin(h.request())).toBeNull(); expect(h.owner.markDispatched(lease!)).toBe(true); expect(h.owner.receive(lease!, capture())).toBe(true);
    const publication = h.owner.currentPublication(lease!); expect(publication?.request.label).toBe(" Exact\nlabel "); expect(publication?.capture.screens[0]?.elements[0]?.name).toBe(" Exact raw name ");
    expect(publication?.requestText).toBe(JSON.stringify(h.request())); expect(Object.isFrozen(publication?.capture)).toBe(true);
    expect(publication).toMatchObject({ foregroundTargetVerified: false, processingPermissionGranted: false, spendingApprovalGranted: false, provenance: "CURRENT_CLIENT_REQUEST_RESPONSE_NOT_TARGET_VERIFICATION" });
    expect(h.owner.retainedMetadata()?.legacyUnattributedValues).toBe(1); expect(h.prior[0]).toEqual({ title: " Legacy paid draft\nexact ", note: null }); h.owner.dispose();
  });
  it("no trimmed/aliased/request replacement or extra request field is silently accepted", () => {
    const h = fixture(); expect(h.owner.begin({ ...h.request(), label: "Exact label" })).toBeNull(); expect(h.owner.begin({ ...h.request(), serial: "DEVICE-B" })).toBeNull();
    expect(h.owner.begin(Object.assign(h.request(), { unsupported: "private" }))).toBeNull(); expect(h.owner.retainedMetadata()?.intents).toBe(0); h.owner.dispose();
  });
  it("forged lease identity cannot dispatch/settle, and 100 retained intents are never silently evicted to admit 101", () => {
    const h = fixture();
    for (let n = 0; n < 100; n++) {
      h.move({ selection: { mode: "android", serial: `DEVICE-${n}` } }); const lease = h.owner.begin(h.request())!;
      expect(lease).not.toBeNull(); expect(h.owner.markDispatched({ ...lease })).toBe(false); expect(h.owner.receive({ ...lease }, capture())).toBe(false);
      expect(h.owner.markDispatched(lease)).toBe(true); expect(h.owner.receive(lease, capture(`s${n}`))).toBe(true);
    }
    expect(h.owner.retainedMetadata()?.intents).toBe(100); expect(h.owner.retainedMetadata()?.completeRawResponses).toBe(100);
    expect(h.owner.begin(h.request())).toBeNull(); expect(h.owner.currentStatus().canBegin).toBe(false); expect(h.owner.retainedMetadata()?.legacyUnattributedValues).toBe(1); h.owner.dispose();
  });
  it.each(["mode", "device", "label", "project", "organization", "connection", "readonly", "inactive"])("late %s response remains privately retained; old callbacks cannot clear/publicize another frame", change => {
    const h = fixture(), lease = h.owner.begin(h.request())!; expect(h.owner.markDispatched(lease)).toBe(true);
    if (change === "mode") h.move({ selection: { mode: "ios-remote", appiumUrl: "https://synthetic.example/wd/hub", appiumSessionId: "SYNTHETIC-SESSION" } });
    if (change === "device") h.move({ selection: { mode: "android", serial: "DEVICE-B" } });
    if (change === "label") h.move({ screenLabel: "new untouched label" });
    if (change === "project") h.move({ origin: { ...h.frame.origin, projectId: "other" } });
    if (change === "organization") h.move({ origin: { ...h.frame.origin, organizationId: "other" } });
    if (change === "connection") h.move({ connection: { ...h.frame.connection, epoch: 2 } });
    if (change === "readonly") h.move({ readable: false });
    if (change === "inactive") h.move({ active: false });
    expect(lease.signal.aborted).toBe(true); expect(h.owner.receive(lease, capture())).toBe(false);
    expect(h.owner.currentPublication(lease)).toBeNull(); expect(h.owner.ownsCurrentFrame(lease)).toBe(false);
    const origin = { projectId: "p", organizationId: "o", clerkActorId: "u" };
    h.replace({ ...h.frame, origin, active: true, readable: true, selection: { mode: "android", serial: "DEVICE-A" }, screenLabel: " Exact\nlabel ", connection: { epoch: 1, pairingCode: "ABCDEF123456" } });
    expect(h.owner.retainedMetadata()?.completeRawResponses).toBe(1); expect(h.owner.currentStatus().uncertain).toBe(true);
    expect(h.owner.begin(h.request())).toBeNull(); expect(h.owner.currentPublication(lease)).toBeNull(); h.owner.dispose();
  });
  it("SDK A-B-A and same-session resource generation cannot revive late/old publication without a new explicit frame", () => {
    const h = fixture(), lease = h.owner.begin(h.request())!; h.owner.markDispatched(lease);
    h.sdkOnly({ userId: "u", sessionId: "B" }); h.sdkOnly({ userId: "u", sessionId: "A" });
    expect(h.owner.receive(lease, capture())).toBe(false); expect(h.owner.currentPublication(lease)).toBeNull(); expect(h.owner.retainedMetadata()).toBeNull();
    h.restore(); expect(h.owner.retainedMetadata()?.completeRawResponses).toBe(1); expect(h.owner.begin(h.request())).toBeNull(); h.owner.dispose();
    const resource = fixture(), accepted = resource.owner.begin(resource.request())!; resource.owner.markDispatched(accepted); resource.owner.receive(accepted, capture());
    resource.sdkOnly({ userId: "u", sessionId: "A" }, true); expect(resource.owner.canPublish(accepted)).toBe(false); resource.restore(); expect(resource.owner.canPublish(accepted)).toBe(false); resource.owner.dispose();
  });
  it("an old same-frame received lease cannot publish/clear busy for a newer capture", () => {
    const h = fixture(), first = h.owner.begin(h.request())!; h.owner.markDispatched(first); h.owner.receive(first, capture());
    const second = h.owner.begin(h.request())!; expect(h.owner.canPublish(first)).toBe(false); expect(h.owner.ownsCurrentFrame(first)).toBe(false); expect(h.owner.currentStatus().busy).toBe(true);
    expect(h.owner.markDispatched(second)).toBe(true); expect(h.owner.receive(second, capture("s2"))).toBe(true); expect(h.owner.currentPublication(second)?.capture.screens).toHaveLength(2);
    expect(h.owner.retainedMetadata()?.completeRawResponses).toBe(2); h.owner.dispose();
  });
  it("same response device name never merges different exact selected serials/sessions, and legacy prior is never a baseline", () => {
    const legacy = capture("legacy").capture, h = fixture([legacy]), first = h.owner.begin(h.request())!;
    h.owner.markDispatched(first); h.owner.receive(first, capture("a")); expect(h.owner.currentPublication(first)?.capture.screens).toHaveLength(1);
    h.move({ selection: { mode: "android", serial: "DEVICE-B" } }); const second = h.owner.begin(h.request())!; h.owner.markDispatched(second); h.owner.receive(second, capture("b"));
    expect(h.owner.currentPublication(second)?.capture.screens.map(screen => screen.id)).toEqual(["b"]); expect(legacy.screens[0]?.id).toBe("legacy"); expect(h.owner.retainedMetadata()?.legacyUnattributedValues).toBe(1); h.owner.dispose();
  });
  it.each(["alias", "duplicate", "overflow", "providerError", "unknownField"])("complete unsupported %s body stays private, never clipped/replaced/retried", kind => {
    const h = fixture(), first = h.owner.begin(h.request())!; h.owner.markDispatched(first); h.owner.receive(first, capture("original"));
    const second = h.owner.begin(h.request())!; h.owner.markDispatched(second);
    let raw: unknown = capture("second");
    if (kind === "alias") raw = capture("second", { deviceName: "changed model" });
    if (kind === "duplicate") raw = capture("original");
    if (kind === "overflow") raw = capture("second", { screens: Array.from({ length: 25 }, (_, n) => ({ id: `extra-${n}`, label: "raw", elements: [] })) });
    if (kind === "providerError") raw = { error: "SYNTHETIC private provider endpoint/session/cause" };
    if (kind === "unknownField") raw = { ...capture("second"), private: "sensitive raw message" };
    expect(h.owner.receive(second, raw)).toBe(false); expect(h.owner.currentPublication(second)).toBeNull(); expect(h.owner.currentStatus().unsupported).toBe(true);
    expect(h.owner.begin(h.request())).toBeNull(); expect(h.owner.retainedMetadata()?.completeRawResponses).toBe(2); expect(JSON.stringify(h.owner.currentStatus())).not.toMatch(/SYNTHETIC|sensitive/); h.owner.dispose();
  });
  it("oversize/getter responses retain prior values and UNKNOWN intent without claiming full unsupported-body retention", () => {
    const h = fixture(), lease = h.owner.begin(h.request())!; h.owner.markDispatched(lease);
    expect(h.owner.receive(lease, { private: "x".repeat(8388609) })).toBe(false); expect(h.owner.retainedMetadata()?.completeRawResponses).toBe(0);
    expect(h.owner.retainedMetadata()?.legacyUnattributedValues).toBe(1); expect(h.owner.currentStatus().uncertain).toBe(true); expect(h.owner.begin(h.request())).toBeNull(); h.owner.dispose();
    const getter = fixture(), intent = getter.owner.begin(getter.request())!; getter.owner.markDispatched(intent); let calls = 0;
    expect(getter.owner.receive(intent, { get capture() { calls++; return capture().capture; } })).toBe(false); expect(calls).toBe(0); expect(getter.owner.retainedMetadata()?.completeRawResponses).toBe(0); getter.owner.dispose();
  });
  it("complete literal NULL is retained unsupported data, not a missing response default", () => {
    const h = fixture(), lease = h.owner.begin(h.request())!; h.owner.markDispatched(lease); expect(h.owner.receive(lease, null)).toBe(false);
    expect(h.owner.retainedMetadata()?.completeRawResponses).toBe(1); expect(h.owner.currentStatus().unsupported).toBe(true); expect(h.owner.currentStatus().uncertain).toBe(false); h.owner.dispose();
  });
  it("aggregate reserve refuses BEFORE caller dispatch while privately preserving all original values", () => {
    const prior = Array.from({ length: 3 }, () => "x".repeat(7500000)), h = fixture(prior), lease = h.owner.begin(h.request())!;
    expect(h.owner.markDispatched(lease)).toBe(false); expect(h.owner.retainedMetadata()?.legacyUnattributedValues).toBe(3); expect(h.owner.retainedMetadata()?.completeRawResponses).toBe(0);
    expect(h.owner.currentStatus().unsupported).toBe(true); expect(prior.every(value => value.length === 7500000)).toBe(true); expect(h.owner.begin(h.request())).toBeNull(); h.owner.dispose();
  });
  it("revocation precedes abort listeners/cleanup reentrancy; no stale callback can begin/publish/clear input", () => {
    const h = fixture(), lease = h.owner.begin(h.request())!; h.owner.markDispatched(lease); let aborted = 0;
    lease.signal.addEventListener("abort", () => { aborted++; expect(h.owner.ownsCurrentFrame(lease)).toBe(false); expect(h.owner.begin(h.request())).toBeNull(); });
    h.move({ active: false }); expect(aborted).toBe(1); expect(h.listenerCount()).toBe(1); h.owner.dispose(); expect(h.cleanup).toHaveBeenCalledOnce(); expect(h.listenerCount()).toBe(0);
    expect(h.owner.receive(lease, capture())).toBe(false); expect(h.owner.currentPublication(lease)).toBeNull();
  });
  it("UNKNOWN has no retry/replacement/recovery fabrication and still retains an admitted eventual response privately after dispose", () => {
    const h = fixture(), lease = h.owner.begin(h.request())!; h.owner.markDispatched(lease); h.owner.markUnknown(lease);
    expect(h.owner.currentStatus().uncertain).toBe(true); expect(h.owner.begin(h.request())).toBeNull(); expect(h.owner.markDispatched(lease)).toBe(false);
    h.owner.dispose(); expect(h.owner.receive(lease, capture())).toBe(false); expect(h.owner.canPublish(lease)).toBe(false); expect(h.owner.retainedMetadata()).toBeNull();
  });
  it("frame getters/unknown fields and unsupported listener cleanup do not grant a publication lease", () => {
    const h = fixture(); let getters = 0; const frame = Object.defineProperty({ ...h.frame }, "screenLabel", { enumerable: true, get() { getters++; return "raw"; } });
    h.replace(frame); expect(h.owner.begin({ source: "android", label: "raw", serial: "DEVICE-A" })).toBeNull(); expect(getters).toBe(0); h.owner.dispose();
    const missing = fixture(); missing.owner.dispose(); Object.assign(missing.sdk, { subscribe: () => undefined });
    const owner = new DeviceCapturePublicationOwner(missing.frame.origin, missing.sdk, () => missing.frame); owner.update(missing.frame);
    expect(owner.begin(missing.request())).toBeNull(); owner.dispose();
    const extra = fixture(); extra.replace(Object.assign({ ...extra.frame }, { private: "unexpected field" }));
    expect(extra.owner.begin(extra.request())).toBeNull(); extra.owner.dispose();
  });
});
