import { admitAndroidWindowCaptureBody, admitAndroidWindowCaptureRequest, ANDROID_WINDOW_CAPTURE_URL,
  ANDROID_WINDOW_RESPONSE_MAX_BYTES, androidWindowCaptureRefusal, type AndroidWindowCaptureRequest,
  type AndroidWindowCaptureResponse, type AndroidWindowResponseMetadata } from "./android-window-capture-protocol";

export const ANDROID_WINDOW_CAPTURE_MAX_READS = 8192;
export const ANDROID_WINDOW_CAPTURE_DEADLINE_MS = 30000;
export type AndroidWindowCaptureByteReader = Readonly<{ read(): Promise<unknown>; cancel(): Promise<void> | void }>;
export type AndroidWindowCaptureClock = Readonly<{
  setTimeout(callback: () => void, milliseconds: number): unknown;
  clearTimeout(timer: unknown): void;
}>;
const defaultClock: AndroidWindowCaptureClock = {
  setTimeout: (callback, milliseconds) => globalThis.setTimeout(callback, milliseconds),
  clearTimeout: timer => globalThis.clearTimeout(timer as ReturnType<typeof globalThis.setTimeout>),
};
const refusal = () => Error(androidWindowCaptureRefusal);

function ownData(raw: unknown, fields: readonly string[], optional: readonly string[] = []): PropertyDescriptorMap {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.getPrototypeOf(raw) !== Object.prototype) throw refusal();
  const keys = Reflect.ownKeys(raw), descriptors = Object.getOwnPropertyDescriptors(raw);
  if (keys.length < fields.length || keys.length > fields.length + optional.length || fields.some(field => !Object.hasOwn(descriptors, field)) ||
    keys.some(key => typeof key !== "string" || !fields.includes(key) && !optional.includes(key)) ||
    Object.values(descriptors).some(value => !value.enumerable || !Object.hasOwn(value, "value"))) throw refusal();
  return descriptors;
}
function metadata(raw: unknown): AndroidWindowResponseMetadata {
  const data = ownData(raw, ["url", "status", "redirected", "contentType", "contentLength"]);
  const contentType: unknown = data.contentType!.value, contentLength: unknown = data.contentLength!.value;
  if (data.url!.value !== ANDROID_WINDOW_CAPTURE_URL || data.status!.value !== 200 || data.redirected!.value !== false ||
    typeof contentType !== "string" || contentType.length > 120 || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType) ||
    contentLength !== null && (typeof contentLength !== "string" || !/^[0-9]{1,9}$/.test(contentLength) || Number(contentLength) > ANDROID_WINDOW_RESPONSE_MAX_BYTES)) throw refusal();
  return Object.freeze({ url: ANDROID_WINDOW_CAPTURE_URL, status: 200, redirected: false, contentType, contentLength });
}
function chunkLength(raw: unknown): number {
  if (!raw || typeof raw !== "object" || Object.getPrototypeOf(raw) !== Uint8Array.prototype) throw refusal();
  const getter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), "byteLength")?.get;
  const size: unknown = getter?.call(raw);
  if (typeof size !== "number" || size > ANDROID_WINDOW_RESPONSE_MAX_BYTES) throw refusal();
  // The native brand excludes Proxy facades. Its integer indices cannot be
  // accessor properties; reject all decorations without visiting any getter.
  const keys = Reflect.ownKeys(raw);
  if (keys.length !== size || keys.some(key => typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= size)) throw refusal();
  return size;
}

/** Consume ONE injected response for a privately retained frozen request.
 * Creates no transport, SDK, helper operation, fallback or retry. The local
 * callback is an attempt/cancellation gate, NOT native authority or consent.
 * Caller owns the native stream reader lock and any operation/UNKNOWN lease.
 * Delivered bytes are bounded before decoding, not transport/heap buffers.
 * Incomplete/unsupported failures do not prove no native operation happened,
 * and this function does not claim their complete bodies were retained. */
export async function readAndroidWindowCaptureResponse(rawMetadata: unknown, rawReader: unknown,
  originalFrozenIntent: AndroidWindowCaptureRequest, signal: AbortSignal,
  isOriginalAttemptCurrent: () => boolean, rawClock: AndroidWindowCaptureClock = defaultClock): Promise<AndroidWindowCaptureResponse> {
  let cancelReader: (() => unknown) | null = null, canceled = false, timer: unknown, timerInstalled = false;
  let clearTimer: ((timer: unknown) => void) | null = null, onAbort: (() => void) | null = null;
  const cancel = () => {
    if (!cancelReader || canceled) return;
    canceled = true;
    try { void Promise.resolve(cancelReader()).catch(() => undefined); } catch { /* Never expose cleanup details or wait on it. */ }
  };
  try {
    const readerMethods = ownData(rawReader, ["read", "cancel"]);
    if (typeof readerMethods.read!.value !== "function" || typeof readerMethods.cancel!.value !== "function") throw refusal();
    const read = (): Promise<unknown> => readerMethods.read!.value.call(rawReader);
    cancelReader = () => readerMethods.cancel!.value.call(rawReader);
    const info = metadata(rawMetadata);
    if (!Object.isFrozen(originalFrozenIntent)) throw refusal();
    const intent = admitAndroidWindowCaptureRequest(originalFrozenIntent);
    const clockMethods = ownData(rawClock, ["setTimeout", "clearTimeout"]);
    if (typeof clockMethods.setTimeout!.value !== "function" || typeof clockMethods.clearTimeout!.value !== "function" || typeof isOriginalAttemptCurrent !== "function") throw refusal();
    clearTimer = value => clockMethods.clearTimeout!.value.call(rawClock, value);
    let expired = false;
    const guard = () => { if (expired || signal.aborted || isOriginalAttemptCurrent() !== true) throw refusal(); };
    guard();
    let rejectDeadline!: (error: Error) => void;
    const deadline = new Promise<never>((_resolve, reject) => { rejectDeadline = reject; });
    void deadline.catch(() => undefined);
    timerInstalled = true;
    timer = clockMethods.setTimeout!.value.call(rawClock, () => { expired = true; cancel(); rejectDeadline(refusal()); }, ANDROID_WINDOW_CAPTURE_DEADLINE_MS);
    const aborted = new Promise<never>((_resolve, reject) => { onAbort = () => { cancel(); reject(refusal()); }; signal.addEventListener("abort", onAbort, { once: true }); });
    void aborted.catch(() => undefined);
    guard();
    const buffer = new Uint8Array(ANDROID_WINDOW_RESPONSE_MAX_BYTES); let size = 0;
    for (let reads = 0; reads < ANDROID_WINDOW_CAPTURE_MAX_READS; reads++) {
      guard(); const raw = await Promise.race([read(), deadline, aborted]); guard();
      const result = ownData(raw, ["done"], ["value"]);
      if (typeof result.done!.value !== "boolean") throw refusal();
      if (result.done!.value) {
        if (result.value && result.value.value !== undefined) throw refusal();
        const bytes = buffer.slice(0, size), output = admitAndroidWindowCaptureBody(info, bytes, intent);
        guard(); return output;
      }
      const chunk: unknown = result.value?.value, length = chunkLength(chunk);
      if (size + length > ANDROID_WINDOW_RESPONSE_MAX_BYTES) throw refusal();
      buffer.set(chunk as Uint8Array, size); size += length;
    }
    throw refusal();
  } catch { cancel(); throw refusal(); }
  finally {
    if (timerInstalled && clearTimer) { try { clearTimer(timer); } catch { /* Cleanup never overrides the generic response/refusal. */ } }
    if (onAbort) { try { signal.removeEventListener("abort", onAbort); } catch { /* No raw cleanup error. */ } }
  }
}
