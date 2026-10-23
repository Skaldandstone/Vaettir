import { describe, expect, it, vi } from "vitest";
import { admitAndroidWindowCaptureRequest, ANDROID_WINDOW_CAPTURE_URL, ANDROID_WINDOW_RESPONSE_MAX_BYTES,
  androidWindowCaptureRefusal, type AndroidWindowResponseMetadata } from "./android-window-capture-protocol";
import { readAndroidWindowCaptureResponse, ANDROID_WINDOW_CAPTURE_DEADLINE_MS, ANDROID_WINDOW_CAPTURE_MAX_READS,
  type AndroidWindowCaptureClock } from "./android-window-capture-response";

const intent = () => admitAndroidWindowCaptureRequest({ protocolVersion: 1, requestNonce: "00000000-0000-4000-8000-000000000001", serial: "DEVICE-A", expectedPackage: "com.synthetic.app", label: " Exact\nlabel " });
const body = () => ({ ...intent(), observation: { kind: "BEFORE_AFTER_WINDOW_OBSERVATIONS_NOT_ATOMIC", beforePackage: "com.synthetic.app", afterPackage: "com.synthetic.app", appExclusive: false }, capture: { version: 1, source: "ANDROID_ADB", deviceName: " Raw model ", appName: "com.synthetic.app", capturedAt: "2026-10-06T00:00:00.000Z", screens: [{ id: "screen-1", label: intent().label, elements: [{ role: "button", name: " Exact\nraw control " }] }] }, processingPermissionGranted: false, spendingPermissionGranted: false, operationReceiptAvailable: false });
const metadata = (patch: Partial<AndroidWindowResponseMetadata> = {}): AndroidWindowResponseMetadata => ({ url: ANDROID_WINDOW_CAPTURE_URL, status: 200, redirected: false, contentType: "application/json", contentLength: null, ...patch });
const encode = (raw: unknown) => new TextEncoder().encode(typeof raw === "string" ? raw : JSON.stringify(raw));
function clock() {
  let callback: (() => void) | null = null;
  const current: AndroidWindowCaptureClock = { setTimeout: vi.fn((fire, delay) => { expect(delay).toBe(30000); callback = fire; return 7; }), clearTimeout: vi.fn(handle => { expect(handle).toBe(7); }) };
  return { current, expire: () => callback!() };
}
function reader(chunks = [encode(body())]) {
  let index = 0;
  return { read: vi.fn(async () => index < chunks.length ? { done: false, value: chunks[index++] } : { done: true, value: undefined }), cancel: vi.fn(() => undefined) };
}
function deferred<T>() { let resolve!: (raw: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

describe("one injected Android response, bounded fake streams/clocks only", () => {
  it("preserves exact supported multi-chunk response/native labels and false claims, clears timer without canceling success", async () => {
    const bytes = encode(body()), stream = reader([bytes.slice(0, 17), bytes.slice(17)]), time = clock();
    const output = await readAndroidWindowCaptureResponse(metadata({ contentLength: String(bytes.length), contentType: "application/json; charset=utf-8" }), stream, intent(), new AbortController().signal, () => true, time.current);
    expect(output.capture).toEqual(body().capture); expect(output.label).toBe(" Exact\nlabel ");
    expect(output).toMatchObject({ operationReceiptAvailable: false, processingPermissionGranted: false, spendingPermissionGranted: false, observation: { appExclusive: false } });
    expect(stream.read).toHaveBeenCalledTimes(3); expect(stream.cancel).not.toHaveBeenCalled(); expect(time.current.clearTimeout).toHaveBeenCalledOnce();
    expect(ANDROID_WINDOW_CAPTURE_DEADLINE_MS).toBe(30000);
  });
  it.each([{ status: 404 }, { status: 400 }, { redirected: true }, { url: "http://127.0.0.1:4774/capture" }, { url: "http://localhost:4774/capture/android-window-v1" }, { url: ANDROID_WINDOW_CAPTURE_URL + "?x=1" }, { contentType: null }, { contentType: "text/plain" }, { contentLength: "2097153" }, { contentLength: " 2 " }])("refuses exact metadata before ANY read, with no fallback %j", async patch => {
    const stream = reader(), time = clock();
    await expect(readAndroidWindowCaptureResponse(metadata(patch), stream, intent(), new AbortController().signal, () => true, time.current)).rejects.toThrow(androidWindowCaptureRefusal);
    expect(stream.read).not.toHaveBeenCalled(); expect(stream.cancel).toHaveBeenCalledOnce(); expect(time.current.setTimeout).not.toHaveBeenCalled();
  });
  it("requires original frozen strict request before reading and refuses actorless/extra/getter metadata rather than inspecting it", async () => {
    let getters = 0;
    const metaGetter = Object.defineProperty(metadata(), "status", { enumerable: true, get() { getters++; return 200; } });
    const intentGetter = Object.freeze(Object.defineProperty({ ...intent() }, "serial", { enumerable: true, get() { getters++; return "DEVICE-A"; } }));
    for (const [info, original] of [[metaGetter, intent()], [{ ...metadata(), private: "PRIVATE" }, intent()], [metadata(), { ...intent() }], [metadata(), intentGetter], [metadata(), Object.freeze({ ...intent(), private: "PRIVATE" })]] as const) {
      const stream = reader(); await expect(readAndroidWindowCaptureResponse(info, stream, original, new AbortController().signal, () => true, clock().current)).rejects.toThrow(androidWindowCaptureRefusal); expect(stream.read).not.toHaveBeenCalled();
    }
    expect(getters).toBe(0);
  });
  it("refuses getter/hidden/symbol/exotic reader or clock facades without invoking their private getters", async () => {
    let getters = 0;
    const getter = Object.defineProperty({ cancel() {} }, "read", { enumerable: true, get() { getters++; return vi.fn(); } });
    for (const raw of [getter, Object.defineProperty(reader(), "private", { value: "PRIVATE" }), { ...reader(), [Symbol("private")]: "PRIVATE" }, Object.assign(Object.create(null), reader())]) await expect(readAndroidWindowCaptureResponse(metadata(), raw, intent(), new AbortController().signal, () => true, clock().current)).rejects.toThrow(androidWindowCaptureRefusal);
    const rawClock = Object.defineProperty(clock().current, "setTimeout", { enumerable: true, get() { getters++; return vi.fn(); } });
    const stream = reader(); await expect(readAndroidWindowCaptureResponse(metadata(), stream, intent(), new AbortController().signal, () => true, rawClock)).rejects.toThrow(androidWindowCaptureRefusal);
    expect(stream.read).not.toHaveBeenCalled(); expect(getters).toBe(0);
  });
  it("whole2MiB EOF accepts; overflow or false Content-Length refuses and does not clip", async () => {
    const text = JSON.stringify(body()), bytes = encode(text + " ".repeat(ANDROID_WINDOW_RESPONSE_MAX_BYTES - encode(text).length));
    const accepted = reader([bytes.slice(0, 65536), bytes.slice(65536)]);
    expect((await readAndroidWindowCaptureResponse(metadata({ contentLength: String(bytes.length) }), accepted, intent(), new AbortController().signal, () => true, clock().current)).capture).toEqual(body().capture);
    for (const stream of [reader([bytes, encode(" ")]), reader()]) {
      await expect(readAndroidWindowCaptureResponse(metadata({ contentLength: "1" }), stream, intent(), new AbortController().signal, () => true, clock().current)).rejects.toThrow(androidWindowCaptureRefusal);
      expect(stream.cancel).toHaveBeenCalledOnce();
    }
  });
  it.each(["", '{"capture":{}}', '{"protocolVersion":1,"protocolVersion":1}', "\ufeff" + JSON.stringify(body()), JSON.stringify(body()).slice(0, -1), JSON.stringify({ ...body(), requestNonce: "00000000-0000-4000-8000-000000000002" })])("whole malformed/old/duplicate/nonce body refuses generically %s", async text => {
    const stream = reader([encode(text)]); await expect(readAndroidWindowCaptureResponse(metadata(), stream, intent(), new AbortController().signal, () => true, clock().current)).rejects.toThrow(androidWindowCaptureRefusal); expect(stream.cancel).toHaveBeenCalledOnce();
  });
  it("refuses invalid UTF8/getter decorated bytes and malformed chunks without getter effects", async () => {
    let getters = 0; const decorated = encode(body()); Object.defineProperty(decorated, "private", { get() { getters++; return "PRIVATE"; } });
    const resultGetter = Object.defineProperty({ done: false }, "value", { enumerable: true, get() { getters++; return encode(body()); } });
    for (const result of [{ done: false, value: new Uint8Array([0xff]) }, { done: false, value: decorated }, resultGetter, { done: "true", value: encode(body()) }, { done: true, value: encode(body()) }, { done: false, value: encode(body()), private: "PRIVATE" }]) {
      let read = 0; const stream = { read: vi.fn(async () => ++read === 1 ? result : { done: true }), cancel: vi.fn() };
      await expect(readAndroidWindowCaptureResponse(metadata(), stream, intent(), new AbortController().signal, () => true, clock().current)).rejects.toThrow(androidWindowCaptureRefusal); expect(stream.cancel).toHaveBeenCalledOnce();
    }
    expect(getters).toBe(0);
  });
  it("real byte tag/count rejects attached-width spoofing, detached/shared evenzero and every extra ownproperty without getter effects", async () => {
    let getters = 0; const bytes = encode(body()), detached = encode(body()); structuredClone(detached.buffer, { transfer: [detached.buffer] });
    const shared = new Uint8Array(new SharedArrayBuffer(bytes.length)); shared.set(bytes);
    const hostile = [detached, shared, new Uint8Array(new SharedArrayBuffer(0)), Object.setPrototypeOf(new Uint8ClampedArray(bytes), Uint8Array.prototype),
      Object.setPrototypeOf(new Uint8ClampedArray(0), Uint8Array.prototype), Object.setPrototypeOf(new Uint16Array(0), Uint8Array.prototype), Object.setPrototypeOf(new Uint16Array(1), Uint8Array.prototype),
      Object.setPrototypeOf(new DataView(new ArrayBuffer(1)), Uint8Array.prototype), Object.create(Uint8Array.prototype), new Proxy(bytes, {}),
      Object.defineProperty(encode(body()), "hidden", { value: 1 }), Object.assign(encode(body()), { extra: 1 }), Object.assign(encode(body()), { [Symbol("hidden")]: 1 }),
      Object.defineProperty(encode(body()), "hidden", { get() { getters++; return 1; } })];
    for (const raw of hostile) {
      const stream = reader([raw]); await expect(readAndroidWindowCaptureResponse(metadata(), stream, intent(), new AbortController().signal, () => true, clock().current)).rejects.toThrow(androidWindowCaptureRefusal);
      expect(stream.read).toHaveBeenCalledOnce(); expect(stream.cancel).toHaveBeenCalledOnce();
    }
    const accepted = reader([new Uint8Array(0), bytes]);
    expect((await readAndroidWindowCaptureResponse(metadata(), accepted, intent(), new AbortController().signal, () => true, clock().current)).capture).toEqual(body().capture);
    expect(getters).toBe(0);
  });
  it("8192 empty/incomplete reads refuse whole without hanging, fallback or interpreting partial JSON", async () => {
    for (const initial of [new Uint8Array(), encode('{"protocolVersion":1')]) {
      let reads = 0; const stream = { read: vi.fn(async () => ({ done: false, value: ++reads === 1 ? initial : new Uint8Array() })), cancel: vi.fn() }, time = clock();
      await expect(readAndroidWindowCaptureResponse(metadata(), stream, intent(), new AbortController().signal, () => true, time.current)).rejects.toThrow(androidWindowCaptureRefusal);
      expect(stream.read).toHaveBeenCalledTimes(ANDROID_WINDOW_CAPTURE_MAX_READS); expect(stream.cancel).toHaveBeenCalledOnce(); expect(time.current.clearTimeout).toHaveBeenCalledOnce();
    }
  });
  it("stalled read deadline cancels once without waiting on stuck cleanup; late result cannot become success", async () => {
    const delayed = deferred<unknown>(), stream = { read: vi.fn(() => delayed.promise), cancel: vi.fn(() => new Promise<void>(() => undefined)) }, time = clock();
    const pending = readAndroidWindowCaptureResponse(metadata(), stream, intent(), new AbortController().signal, () => true, time.current);
    const refused = expect(pending).rejects.toThrow(androidWindowCaptureRefusal); time.expire(); await refused;
    delayed.resolve({ done: false, value: encode(body()) }); await Promise.resolve();
    expect(stream.read).toHaveBeenCalledOnce(); expect(stream.cancel).toHaveBeenCalledOnce(); expect(time.current.clearTimeout).toHaveBeenCalledOnce();
  });
  it("abort before read and during await refuses; throwing/rejected cancel/clock cleanup never expose private errors", async () => {
    const already = new AbortController(); already.abort(); const unstarted = reader();
    await expect(readAndroidWindowCaptureResponse(metadata(), unstarted, intent(), already.signal, () => true, clock().current)).rejects.toThrow(androidWindowCaptureRefusal); expect(unstarted.read).not.toHaveBeenCalled();
    for (const cancel of [() => { throw Error("PRIVATE cleanup"); }, () => Promise.reject(Error("PRIVATE cleanup"))]) {
      const controller = new AbortController(), stream = { read: vi.fn(() => new Promise(() => undefined)), cancel: vi.fn(cancel) }, time = clock();
      const throwingCleanup: AndroidWindowCaptureClock = { ...time.current, clearTimeout: vi.fn(() => { throw Error("PRIVATE timer cleanup"); }) };
      const pending = readAndroidWindowCaptureResponse(metadata(), stream, intent(), controller.signal, () => true, throwingCleanup), refused = expect(pending).rejects.toThrow(androidWindowCaptureRefusal);
      controller.abort(); await refused; expect(stream.cancel).toHaveBeenCalledOnce(); expect(stream.read).toHaveBeenCalledOnce();
    }
  });
  it("local attempt loss after await or reentrant timer expiration revokes BEFORE callbacks; no further read/publication", async () => {
    let current = true; const stream = { read: vi.fn(async () => { current = false; return { done: false, value: encode(body()) }; }), cancel: vi.fn() };
    await expect(readAndroidWindowCaptureResponse(metadata(), stream, intent(), new AbortController().signal, () => current, clock().current)).rejects.toThrow(androidWindowCaptureRefusal); expect(stream.read).toHaveBeenCalledOnce(); expect(stream.cancel).toHaveBeenCalledOnce();
    const before = reader(), time: AndroidWindowCaptureClock = { setTimeout(callback) { callback(); return 1; }, clearTimeout() {} };
    await expect(readAndroidWindowCaptureResponse(metadata(), before, intent(), new AbortController().signal, () => true, time)).rejects.toThrow(androidWindowCaptureRefusal); expect(before.read).not.toHaveBeenCalled(); expect(before.cancel).toHaveBeenCalledOnce();
    const fail = reader(), throwing: AndroidWindowCaptureClock = { setTimeout() { throw Error("PRIVATE timer"); }, clearTimeout() {} };
    await expect(readAndroidWindowCaptureResponse(metadata(), fail, intent(), new AbortController().signal, () => true, throwing)).rejects.toThrow(androidWindowCaptureRefusal); expect(fail.read).not.toHaveBeenCalled();
  });
});
