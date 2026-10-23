import { describe, expect, it, vi } from "vitest";
import { pairedHelperLiveness } from "./device-helper-protocol";
import { admitDeviceHelperHealthBody, readDeviceHelperHealthResponse, DEVICE_HELPER_HEALTH_URL,
  DEVICE_HELPER_HEALTH_MAX_BYTES, DEVICE_HELPER_HEALTH_MAX_READS, deviceHelperHealthResponseRefusal,
  type DeviceHelperHealthResponseMetadata } from "./device-helper-health-response";

const encode = (text: string) => new TextEncoder().encode(text);
const body = '{"connected":true,"version":2}';
const info = (patch: Partial<DeviceHelperHealthResponseMetadata> = {}): DeviceHelperHealthResponseMetadata => ({
  url: DEVICE_HELPER_HEALTH_URL, status: 200, redirected: false, contentType: "application/json", contentLength: null, ...patch,
});
function stream(chunks: Uint8Array[] = [encode(body)]) {
  let next = 0;
  return { read: vi.fn(async () => next < chunks.length ? { done: false, value: chunks[next++] } : { done: true, value: undefined }), cancel: vi.fn(() => undefined) };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

describe("bounded existing v2 response admission; injected synthetic streams only", () => {
  it.each([body, ' { "version" : 2.0, "connected" : true }\n', '{"\\u0063onnected":true,"version":2e0}'])("preserves exact decoder semantics for supported JSON %s", text => {
    const admitted = admitDeviceHelperHealthBody(info(), encode(text));
    expect(admitted).toEqual(pairedHelperLiveness({ connected: true, version: 2 })); expect(Object.isFrozen(admitted)).toBe(true);
    expect(admitted).toMatchObject({ nativeTargetProofAvailable: false, operationReceiptAvailable: false, processingPermissionGranted: false, semanticRedactionGuaranteed: false, windowsLaunchAcceptanceVerified: false });
  });
  it("accepts exactly 512 delivered bytes without trimming and refuses 513 whole", () => {
    const exact = encode(body + " ".repeat(DEVICE_HELPER_HEALTH_MAX_BYTES - encode(body).length));
    expect(exact.byteLength).toBe(512); expect(admitDeviceHelperHealthBody(info({ contentLength: "512" }), exact).protocolVersion).toBe(2);
    expect(() => admitDeviceHelperHealthBody(info(), encode(body + " ".repeat(513 - encode(body).length)))).toThrow(deviceHelperHealthResponseRefusal);
  });
  it.each(['', '{"connected":true}', '{"connected":true,"version":3}', '{"connected":false,"version":2}',
    '{"connected":true,"version":"2"}', '{"connected":true,"version":2,"error":"private source"}',
    '{"connected":true,"connected":false,"version":2}', '{"connected":false,"connected":true,"version":2}',
    '{"connected":true,"\\u0063onnected":true}', '{"connected":true,"version":{"private":"body"}}',
    '[true,2]', '{"__proto__":true,"version":2}', '{"connected":true,"version":2} {"private":"body"}'])("refuses the entire unsupported/duplicate body generically: %s", text => {
      expect(() => admitDeviceHelperHealthBody(info(), encode(text))).toThrow(deviceHelperHealthResponseRefusal);
    });
  it("invalid UTF-8/BOM and decorated byte arrays never become a decoded protocol or invoke getters", () => {
    let getters = 0; const decorated = encode(body);
    Object.defineProperty(decorated, "private", { get() { getters++; return "sensitive"; } });
    for (const bytes of [new Uint8Array([0xff]), encode("\ufeff" + body), decorated]) expect(() => admitDeviceHelperHealthBody(info(), bytes)).toThrow(deviceHelperHealthResponseRefusal);
    expect(getters).toBe(0);
  });
  it.each([{ url: "http://localhost:4774/health" }, { url: "http://127.0.0.1:4774/health?x=1" },
    { url: "https://private.example/health" }, { redirected: true }, { status: 302 }, { status: 403 },
    { contentType: null }, { contentType: "text/plain" }, { contentLength: "513" }, { contentLength: "-1" },
    { contentLength: " 30 " }, { contentLength: "1e2" }])("refuses endpoint/HTTP metadata before reading: %j", async patch => {
      const reader = stream(); await expect(readDeviceHelperHealthResponse(info(patch), reader, new AbortController().signal, () => true)).rejects.toThrow(deviceHelperHealthResponseRefusal);
      expect(reader.read).not.toHaveBeenCalled(); expect(reader.cancel).toHaveBeenCalledOnce();
    });
  it("metadata/reader getters, hidden/symbol/extra fields refuse without inspection or private error strings", async () => {
    let getters = 0; const getter = Object.defineProperty(info(), "contentType", { enumerable: true, get() { getters++; return "application/json"; } });
    for (const raw of [getter, { ...info(), private: "source" }, { ...info(), [Symbol("private")]: "source" }, Object.defineProperty(info(), "private", { value: "source" })]) {
      const reader = stream(); await expect(readDeviceHelperHealthResponse(raw, reader, new AbortController().signal, () => true)).rejects.toThrow(deviceHelperHealthResponseRefusal); expect(reader.read).not.toHaveBeenCalled();
    }
    const reader = Object.defineProperty({ cancel: vi.fn() }, "read", { enumerable: true, get() { getters++; return vi.fn(); } });
    await expect(readDeviceHelperHealthResponse(info(), reader, new AbortController().signal, () => true)).rejects.toThrow(deviceHelperHealthResponseRefusal); expect(getters).toBe(0);
  });
  it("reads one response without retry/transport, copies bounded chunks and verifies exact declared length", async () => {
    const bytes = encode(body), reader = stream([bytes.slice(0, 7), bytes.slice(7)]), controller = new AbortController();
    const result = await readDeviceHelperHealthResponse(info({ contentType: "application/json; charset=UTF-8", contentLength: String(bytes.length) }), reader, controller.signal, () => true);
    expect(result.protocolVersion).toBe(2); expect(reader.read).toHaveBeenCalledTimes(3); expect(reader.cancel).not.toHaveBeenCalled();
    const mismatch = stream(); await expect(readDeviceHelperHealthResponse(info({ contentLength: "1" }), mismatch, controller.signal, () => true)).rejects.toThrow(deviceHelperHealthResponseRefusal); expect(mismatch.cancel).toHaveBeenCalledOnce();
  });
  it("a one-byte chunk stream can admit the whole 512-byte response; 513-byte streaming body is never clipped", async () => {
    const bytes = encode(body + " ".repeat(512 - encode(body).length));
    const small = stream(Array.from(bytes, byte => new Uint8Array([byte])));
    expect((await readDeviceHelperHealthResponse(info(), small, new AbortController().signal, () => true)).protocolVersion).toBe(2); expect(small.read).toHaveBeenCalledTimes(513);
    const tooLarge = stream([bytes, new Uint8Array([32])]);
    await expect(readDeviceHelperHealthResponse(info(), tooLarge, new AbortController().signal, () => true)).rejects.toThrow(deviceHelperHealthResponseRefusal);
    expect(tooLarge.read).toHaveBeenCalledTimes(2); expect(tooLarge.cancel).toHaveBeenCalledOnce();
  });
  it("checks current attempt before dispatch, after awaits and immediately before returning admitted metadata", async () => {
    const refused = stream(); await expect(readDeviceHelperHealthResponse(info(), refused, new AbortController().signal, () => false)).rejects.toThrow(deviceHelperHealthResponseRefusal); expect(refused.read).not.toHaveBeenCalled();
    let current = true; const response = deferred<unknown>(), pendingReader = { read: vi.fn(() => response.promise), cancel: vi.fn() };
    const pending = readDeviceHelperHealthResponse(info(), pendingReader, new AbortController().signal, () => current); current = false;
    response.resolve({ done: false, value: encode(body) }); await expect(pending).rejects.toThrow(deviceHelperHealthResponseRefusal); expect(pendingReader.read).toHaveBeenCalledOnce(); expect(pendingReader.cancel).toHaveBeenCalledOnce();
    let checks = 0; const final = stream(); await expect(readDeviceHelperHealthResponse(info(), final, new AbortController().signal, () => ++checks < 7)).rejects.toThrow(deviceHelperHealthResponseRefusal); expect(final.cancel).toHaveBeenCalledOnce();
  });
  it("abort settles a hanging read privately, cancels once and does not retry or expose late sensitive exceptions", async () => {
    const late = deferred<unknown>(), reader = { read: vi.fn(() => late.promise), cancel: vi.fn(() => Promise.reject(Error("private cancel error"))) }, controller = new AbortController();
    const pending = readDeviceHelperHealthResponse(info(), reader, controller.signal, () => true); controller.abort();
    await expect(pending).rejects.toThrow(deviceHelperHealthResponseRefusal); late.resolve({ done: false, value: encode(body) });
    expect(reader.read).toHaveBeenCalledOnce(); expect(reader.cancel).toHaveBeenCalledOnce();
    const already = stream(); await expect(readDeviceHelperHealthResponse(info(), already, controller.signal, () => true)).rejects.toThrow(deviceHelperHealthResponseRefusal); expect(already.read).not.toHaveBeenCalled();
  });
  it("chunk getters/unknown fields and synthetic transport exceptions never leak or invoke getters", async () => {
    let getters = 0;
    const chunk = Object.defineProperty({ done: false }, "value", { enumerable: true, get() { getters++; return encode(body); } });
    for (const response of [chunk, { done: false, value: encode(body), private: "source" }, { done: true, value: encode(body) }]) {
      const reader = { read: vi.fn(async () => response), cancel: vi.fn() };
      await expect(readDeviceHelperHealthResponse(info(), reader, new AbortController().signal, () => true)).rejects.toThrow(deviceHelperHealthResponseRefusal); expect(reader.cancel).toHaveBeenCalledOnce();
    }
    const failure = { read: vi.fn(async () => { throw Error("private provider credential/source"); }), cancel: vi.fn() };
    await expect(readDeviceHelperHealthResponse(info(), failure, new AbortController().signal, () => true)).rejects.toThrow(deviceHelperHealthResponseRefusal); expect(getters).toBe(0);
  });
  it("bounds an endless empty-chunk stream before another read, without eviction or a made-up successful response", async () => {
    const reader = { read: vi.fn(async () => ({ done: false, value: new Uint8Array() })), cancel: vi.fn() };
    await expect(readDeviceHelperHealthResponse(info(), reader, new AbortController().signal, () => true)).rejects.toThrow(deviceHelperHealthResponseRefusal);
    expect(reader.read).toHaveBeenCalledTimes(DEVICE_HELPER_HEALTH_MAX_READS); expect(reader.cancel).toHaveBeenCalledOnce();
  });
});
