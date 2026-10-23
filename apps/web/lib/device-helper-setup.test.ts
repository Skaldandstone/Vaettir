import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { deviceCaptureAccessRequestText, type DeviceCaptureAccessInput } from "../../api/src/services/deviceCaptureAccessSchema";
import { captureAccessClientRequestKey, type CaptureSession } from "./device-capture-ownership";
import { DeviceHelperSetup, type DeviceHelperSetupFrame, type SetupBuffers } from "./device-helper-setup";

function deferred<T>() { let resolve!: (value: T) => void, reject!: (value: unknown) => void;
  const promise = new Promise<T>((r, j) => { resolve = r; reject = j; }); return { promise, resolve, reject }; }
function fixture(buffers: SetupBuffers = { note: " exact\nprivate prose ", empty: "", missing: null, enabled: false, count: 0 }) {
  const origin = { projectId: "p", organizationId: "o", nativeActorId: "n", clerkActorId: "c" };
  let session: CaptureSession | null = { userId: "c", sessionId: "A" };
  let frame: DeviceHelperSetupFrame | null = { origin, active: true, loaded: true, signedIn: true, hookSession: session,
    platform: "windows", mode: "android", pairingCode: "ABCDEF123456", connectionEpoch: 1 };
  const listeners = new Set<() => void>();
  const sdk = { current: () => session, subscribe(callback: () => void) { listeners.add(callback); return () => { listeners.delete(callback); }; } };
  const controller = new DeviceHelperSetup(origin, buffers, sdk, () => frame); controller.update(frame);
  const read = vi.fn(async (input: DeviceCaptureAccessInput) => ({ readRequestId: input.readRequestId,
    requestKey: await captureAccessClientRequestKey(input), scope: origin, role: "EDITOR", seatType: "FULL",
    authorization: "CURRENT_LOCKED_FULL_EDITOR_READ", processingPermissionGranted: false, foregroundTargetVerified: false, deviceOperationPerformed: false }));
  return { controller, origin, read, frame: () => frame,
    patch(patch: Partial<DeviceHelperSetupFrame>) { frame = { ...frame!, ...patch }; controller.update(frame); },
    rawFrame(value: DeviceHelperSetupFrame | null) { frame = value; },
    sdk(value: CaptureSession | null) { session = value; listeners.forEach(callback => callback()); } };
}

describe("unmounted helper setup: injected metadata reads only", () => {
  it("sends exact original pins/nonce only and retains flat raw buffers without semantic-redaction claims", async () => {
    const h = fixture(), request = h.controller.beginReview("CONNECT")!;
    expect(await h.controller.authorize(request, h.read)).toBe(true);
    expect(Object.keys(h.read.mock.calls[0]![0]).sort()).toEqual(["projectId", "originalOrganizationId", "expectedNativeActorId", "expectedClerkActorId", "readRequestId"].sort());
    expect(JSON.stringify(h.read.mock.calls)).not.toMatch(/ABCDEF|private prose|windows|android/);
    expect(await captureAccessClientRequestKey(request.accessInput)).toBe(createHash("sha256").update(deviceCaptureAccessRequestText(request.accessInput)).digest("hex"));
    const details = h.controller.view().details!;
    expect(details.buffers).toEqual({ note: " exact\nprivate prose ", empty: "", missing: null, enabled: false, count: 0 });
    expect(details).toMatchObject({ unsignedScriptOnly: true, requiresNodeMajor: 22, windowsPolicyVerified: false,
      processingPermissionGranted: false, semanticRedactionGuaranteed: false });
    expect(Object.isFrozen(details.buffers)).toBe(true);
  });
  it.each(["nonce", "key", "native", "org", "clerk", "role", "seat", "extra"])("refuses %s host reply mismatch with no setup publication", async kind => {
    const h = fixture(), request = h.controller.beginReview("CONNECT")!;
    const read = async (input: DeviceCaptureAccessInput) => {
      const good = await h.read(input);
      return { ...good, ...(kind === "nonce" ? { readRequestId: crypto.randomUUID() } : kind === "key" ? { requestKey: "f".repeat(64) }
        : kind === "native" ? { scope: { ...h.origin, nativeActorId: "other" } } : kind === "org" ? { scope: { ...h.origin, organizationId: "other" } }
        : kind === "clerk" ? { scope: { ...h.origin, clerkActorId: "other" } } : kind === "role" ? { role: "VIEWER" }
        : kind === "seat" ? { seatType: "READ_ONLY" } : { pairingCode: "private" }) };
    };
    expect(await h.controller.authorize(request, read)).toBe(false); expect(h.controller.view().details).toBeNull();
    const health = vi.fn(); expect(await h.controller.checkPairedLiveness(request, h.read, health)).toBe(false); expect(health).not.toHaveBeenCalled();
  });
  it("marks private busy before hashing and does not issue a duplicate read", async () => {
    const h = fixture(), request = h.controller.beginReview("CONNECT")!, entered = deferred<void>(), reply = deferred<unknown>();
    const pending = h.controller.authorize(request, async () => { entered.resolve(); return reply.promise; });
    expect(h.controller.beginReview("CONNECT")).toBeNull(); expect(await h.controller.authorize(request, h.read)).toBe(false);
    await entered.promise; expect(h.controller.view().details).toBeNull(); reply.resolve(await h.read(request.accessInput)); expect(await pending).toBe(true);
  });
  it("requires genuinely fresh native reads before and after the single exact health query", async () => {
    const h = fixture(), request = h.controller.beginReview("CONNECT")!; await h.controller.authorize(request, h.read);
    const order: string[] = [];
    const health = vi.fn(async (input, signal) => { order.push("health"); expect(input).toEqual({ method: "GET", path: "/health", pairingCode: "ABCDEF123456", attemptId: request.id }); expect(signal).toBeInstanceOf(AbortSignal); return { connected: true, version: 2 }; });
    expect(await h.controller.checkPairedLiveness(request, async input => { order.push("native"); return h.read(input); }, health)).toBe(true);
    expect(order).toEqual(["native", "health", "native"]); expect(health).toHaveBeenCalledTimes(1);
    expect(new Set(h.read.mock.calls.map(call => call[0].readRequestId)).size).toBe(3);
    expect(h.controller.view().liveness).toMatchObject({ kind: "PAIRED_LIVENESS_ONLY", nativeTargetProofAvailable: false, operationReceiptAvailable: false });
  });
  it.each(["before", "after"])("native authority refusal %s health cannot publish paired authority", async stage => {
    const h = fixture(), request = h.controller.beginReview("CONNECT")!; await h.controller.authorize(request, h.read); let count = 0;
    const health = vi.fn(async () => ({ connected: true, version: 2 }));
    const read = async (input: DeviceCaptureAccessInput) => { count++; if (count === (stage === "before" ? 1 : 2)) throw Error("private native failure"); return h.read(input); };
    expect(await h.controller.checkPairedLiveness(request, read, health)).toBe(false);
    expect(health).toHaveBeenCalledTimes(stage === "before" ? 0 : 1); expect(h.controller.view().liveness).toBeNull();
    expect(h.controller.view().details).toBeNull();
    expect(h.controller.view().description).not.toContain("private native");
  });
  it("unsupported v3/capabilities does not try another endpoint or infer target proof", async () => {
    const h = fixture(), request = h.controller.beginReview("CONNECT")!; await h.controller.authorize(request, h.read);
    const health = vi.fn(async () => ({ connected: true, version: 3, capabilities: ["foreground"] }));
    expect(await h.controller.checkPairedLiveness(request, h.read, health)).toBe(false);
    expect(health).toHaveBeenCalledTimes(1); expect(h.controller.view().status).toBe("UNSUPPORTED"); expect(h.controller.view().liveness).toBeNull();
  });
  it.each(["SDK", "connection", "mode", "pair", "collapse", "origin"])("%s revokes a pending health response and preserves original buffers privately", async kind => {
    const h = fixture(), request = h.controller.beginReview("CONNECT")!; await h.controller.authorize(request, h.read);
    const entered = deferred<void>(), reply = deferred<unknown>(); let signal: AbortSignal | undefined;
    const pending = h.controller.checkPairedLiveness(request, h.read, async (_input, current) => { signal = current; entered.resolve(); return reply.promise; }); await entered.promise;
    if (kind === "SDK") { h.sdk({ userId: "c", sessionId: "B" }); h.sdk({ userId: "c", sessionId: "A" }); }
    else h.patch(kind === "connection" ? { connectionEpoch: 2 } : kind === "mode" ? { mode: "ios-remote" } : kind === "pair" ? { pairingCode: "123456ABCDEF" }
      : kind === "collapse" ? { active: false } : { origin: { ...h.origin, organizationId: "foreign" } });
    expect(signal?.aborted).toBe(true); reply.resolve({ connected: true, version: 2 }); expect(await pending).toBe(false);
    expect(h.controller.view().details).toBeNull(); expect(h.controller.view().liveness).toBeNull();
    h.rawFrame({ ...h.frame()!, origin: h.origin, active: true, hookSession: { userId: "c", sessionId: "A" } }); h.controller.update(h.frame());
    const retry = h.controller.beginReview("RETRY_UNKNOWN")!; expect(retry.id).not.toBe(request.id);
    expect(await h.controller.authorize(retry, h.read)).toBe(true); expect(h.controller.view().details?.buffers.note).toBe(" exact\nprivate prose ");
  });
  it("same-tick frame/SDK movement refuses captured local-presentation callbacks without a hook commit", async () => {
    const h = fixture(), request = h.controller.beginReview("CONNECT")!; await h.controller.authorize(request, h.read);
    const details = h.controller.view().details!, show = vi.fn(); h.rawFrame({ ...h.frame()!, connectionEpoch: 9 });
    expect(h.controller.currentData(details, show)).toBe(false); expect(show).not.toHaveBeenCalled();
    h.controller.update(h.frame()); const next = h.controller.beginReview("CONNECT")!; await h.controller.authorize(next, h.read);
    const current = h.controller.view().details!; h.sdk({ userId: "c", sessionId: "B" }); h.sdk({ userId: "c", sessionId: "A" });
    expect(h.controller.currentData(current, show)).toBe(false); expect(h.controller.view().details).toBeNull();
  });
  it("reported block aborts late access and requires explicit policy-permitted manual reveal", async () => {
    const h = fixture(), request = h.controller.beginReview("CONNECT")!, entered = deferred<void>(), reply = deferred<unknown>(); let signal: AbortSignal | undefined;
    const pending = h.controller.authorize(request, async (_input, current) => { signal = current; entered.resolve(); return reply.promise; }); await entered.promise;
    h.controller.reportBlockedLaunch(); expect(signal?.aborted).toBe(true); reply.resolve(await h.read(request.accessInput)); expect(await pending).toBe(false);
    expect(h.controller.view().status).toBe("BLOCKED"); expect(h.controller.view().details).toBeNull();
    h.controller.update(h.frame()); expect(h.controller.beginReview("CONNECT")).toBeNull(); const manual = h.controller.beginReview("MANUAL_POLICY_REVIEW")!;
    await h.controller.authorize(manual, h.read); expect(h.controller.view().details).toBeNull();
    expect(h.controller.revealManualDetailsOnlyIfPolicyPermits(manual, false)).toBe(false);
    expect(h.controller.revealManualDetailsOnlyIfPolicyPermits(manual, true)).toBe(true);
    expect(h.controller.view().details?.windowsPolicyVerified).toBe(false); expect(h.controller.view().liveness).toBeNull();
    expect(h.controller.view().description).toContain("cause is unverified");
  });
  it("lost response retains UNKNOWN and requires an explicit fresh metadata attempt, not an automatic operation retry", async () => {
    const h = fixture(), request = h.controller.beginReview("CONNECT")!; await h.controller.authorize(request, h.read);
    const health = vi.fn(async () => { throw Error("private lost response"); });
    expect(await h.controller.checkPairedLiveness(request, h.read, health)).toBe(false);
    expect(h.controller.view().status).toBe("UNKNOWN"); expect(h.controller.beginReview("CONNECT")).toBeNull();
    expect(await h.controller.checkPairedLiveness(request, h.read, health)).toBe(false); expect(health).toHaveBeenCalledTimes(1);
    const retry = h.controller.beginReview("RETRY_UNKNOWN")!; expect(retry.id).not.toBe(request.id);
    expect(await h.controller.authorize(retry, h.read)).toBe(true); expect(h.controller.view().description).not.toContain("private lost");
  });
  it("refuses graphs, accessors, oversized metadata, unsupported precision and symbol fields before any transport", () => {
    let getters = 0;
    for (const buffers of [{ source: { screens: [] } }, { note: "x".repeat(65536) }, { count: Infinity }, { count: Number.MAX_SAFE_INTEGER + 1 },
      { [Symbol("private")]: "hidden" }, Object.defineProperty({}, "private", { value: "hidden" }),
      { get note() { getters++; return "private"; } }]) expect(() => fixture(buffers as SetupBuffers)).toThrow();
    expect(getters).toBe(0);
  });
  it("whole-refuses retained-metadata exhaustion without silently evicting original buffers", async () => {
    const h = fixture({ note: "x".repeat(60000), empty: "", missing: null }); let successful = 0;
    for (let index = 0; index < 64; index++) { const request = h.controller.beginReview("CONNECT"); if (!request) break;
      if (await h.controller.authorize(request, h.read)) { successful++; expect(h.controller.view().details?.buffers.note).toBe("x".repeat(60000)); } }
    expect(successful).toBeGreaterThan(0); expect(successful).toBeLessThan(64);
    expect(h.controller.view().details).toBeNull(); // complete refusal, not a clipped replacement
  });
  it("preflights space for both health and fresh native echo before dispatching health near the aggregate ceiling", async () => {
    let refusedBeforeTransport = false;
    // Native echo/key bookkeeping varies with generated UUIDs. Exercise a
    // bounded matrix around the retained-content boundary, not timing/heap.
    for (const size of [60000, 60500, 61000, 61500, 62000, 62500, 63000, 63500, 64000, 64500, 65000]) {
      const h = fixture({ note: "x".repeat(size) }), health = vi.fn(async () => ({ connected: true, version: 2 }));
      for (let index = 0; index < 64; index++) {
        const request = h.controller.beginReview("CONNECT"); if (!request || !await h.controller.authorize(request, h.read)) break;
        const calls = health.mock.calls.length;
        if (!await h.controller.checkPairedLiveness(request, h.read, health)) {
          expect(health).toHaveBeenCalledTimes(calls); expect(h.controller.view().status).toBe("REFUSED");
          expect(h.controller.view().details).toBeNull(); refusedBeforeTransport = true; break;
        }
      }
      h.controller.dispose(); if (refusedBeforeTransport) break;
    }
    expect(refusedBeforeTransport).toBe(true);
  });
  it("late native authorization after SDK A-B-A cannot reveal old buffers or revive its attempt", async () => {
    const h = fixture(), request = h.controller.beginReview("CONNECT")!, entered = deferred<void>(), response = deferred<unknown>();
    const pending = h.controller.authorize(request, async () => { entered.resolve(); return response.promise; }); await entered.promise;
    h.sdk({ userId: "c", sessionId: "B" }); h.sdk({ userId: "c", sessionId: "A" }); response.resolve(await h.read(request.accessInput));
    expect(await pending).toBe(false); expect(h.controller.view().details).toBeNull();
    h.controller.update(h.frame()); const fresh = h.controller.beginReview("CONNECT")!;
    expect(fresh.id).not.toBe(request.id); expect(await h.controller.authorize(fresh, h.read)).toBe(true);
  });
  it("a blocked launch report during health aborts without trusting its late paired response", async () => {
    const h = fixture(), request = h.controller.beginReview("CONNECT")!; await h.controller.authorize(request, h.read);
    const entered = deferred<void>(), response = deferred<unknown>(); let signal: AbortSignal | undefined;
    const pending = h.controller.checkPairedLiveness(request, h.read, async (_input, current) => { signal = current; entered.resolve(); return response.promise; }); await entered.promise;
    h.controller.reportBlockedLaunch(); expect(signal?.aborted).toBe(true); response.resolve({ connected: true, version: 2 });
    expect(await pending).toBe(false); expect(h.controller.view()).toMatchObject({ status: "BLOCKED", details: null, liveness: null });
    h.controller.update(h.frame()); const retry = h.controller.beginReview("RETRY_BLOCKED")!;
    expect(await h.controller.authorize(retry, h.read)).toBe(true); expect(h.controller.view().details?.buffers.note).toBe(" exact\nprivate prose ");
  });
  it("raw metadata exceeding the health ceiling is not falsely claimed retained or paired", async () => {
    const h = fixture(), request = h.controller.beginReview("CONNECT")!; await h.controller.authorize(request, h.read);
    expect(await h.controller.checkPairedLiveness(request, h.read, async () => ({ connected: true, version: 2, raw: "private".repeat(500) }))).toBe(false);
    expect(h.controller.view().liveness).toBeNull(); expect(h.controller.view().description).not.toContain("privateprivate");
  });
  it("dispose revokes all pending authority without claiming a process stopped", async () => {
    const h = fixture(), request = h.controller.beginReview("CONNECT")!; await h.controller.authorize(request, h.read);
    const details = h.controller.view().details!, show = vi.fn(); h.controller.dispose();
    expect(h.controller.currentData(details, show)).toBe(false); expect(h.controller.beginReview("CONNECT")).toBeNull(); expect(show).not.toHaveBeenCalled();
  });
});
