import { pairedHelperLiveness, type PairedHelperLiveness } from "./device-helper-protocol";

export const DEVICE_HELPER_HEALTH_URL = "http://127.0.0.1:4774/health";
export const DEVICE_HELPER_HEALTH_MAX_BYTES = 512;
export const DEVICE_HELPER_HEALTH_MAX_READS = 1024;
export const deviceHelperHealthResponseRefusal = "No supported current paired helper response was admitted. Launch, device access, foreground targeting and processing permission remain unverified.";

/** A caller-created primitive facade, not a Response/header object whose
 * getters might run during admission. No pairing/source/device data belongs
 * here. The caller must request the exact endpoint with redirect:'error'. */
export type DeviceHelperHealthResponseMetadata = Readonly<{
  url: string; status: number; redirected: boolean;
  contentType: string | null; contentLength: string | null;
}>;
/** Explicit injection only; the caller owns fetch, timeout and reader lock.
 * Adapt a native reader with own functions. No transport is created here. */
export type DeviceHelperHealthByteReader = Readonly<{
  read(): Promise<unknown>; cancel(): Promise<void> | void;
}>;

const refusal = () => Error(deviceHelperHealthResponseRefusal);
function descriptors(raw: unknown, keys: readonly string[]) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.getPrototypeOf(raw) !== Object.prototype) throw refusal();
  const own = Reflect.ownKeys(raw), data = Object.getOwnPropertyDescriptors(raw);
  if (own.length !== keys.length || own.some(key => typeof key !== "string" || !keys.includes(key))) throw refusal();
  for (const item of Object.values(data)) if (!item.enumerable || !Object.hasOwn(item, "value")) throw refusal();
  return data;
}
function metadata(raw: unknown): DeviceHelperHealthResponseMetadata {
  const data = descriptors(raw, ["url", "status", "redirected", "contentType", "contentLength"]);
  if (data.url?.value !== DEVICE_HELPER_HEALTH_URL || data.status?.value !== 200 || data.redirected?.value !== false) throw refusal();
  const contentType: unknown = data.contentType?.value, contentLength: unknown = data.contentLength?.value;
  if (typeof contentType !== "string" || contentType.length > 120 || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType) ||
    contentLength !== null && (typeof contentLength !== "string" || !/^[0-9]{1,9}$/.test(contentLength) || Number(contentLength) > DEVICE_HELPER_HEALTH_MAX_BYTES)) throw refusal();
  return { url: DEVICE_HELPER_HEALTH_URL, status: 200, redirected: false, contentType, contentLength };
}
function byteLength(raw: unknown): number {
  if (!raw || typeof raw !== "object" || Object.getPrototypeOf(raw) !== Uint8Array.prototype) throw refusal();
  // Native brand getter avoids an own byteLength getter or a Proxy fallback.
  const getter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), "byteLength")?.get;
  if (!getter) throw refusal();
  const length: unknown = getter.call(raw);
  if (typeof length !== "number" || length > DEVICE_HELPER_HEALTH_MAX_BYTES) throw refusal();
  const keys = Reflect.ownKeys(raw), data = Object.getOwnPropertyDescriptors(raw);
  if (keys.length !== length || keys.some(key => typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= length)) throw refusal();
  for (const item of Object.values(data)) if (!item.enumerable || !Object.hasOwn(item, "value")) throw refusal();
  return length;
}
function admittedBody(info: DeviceHelperHealthResponseMetadata, bytes: Uint8Array): PairedHelperLiveness {
  const length = byteLength(bytes);
  if (length === 0 || info.contentLength !== null && Number(info.contentLength) !== length) throw refusal();
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  // Admit the same two primitive fields as the existing decoder, including
  // valid escaped keys/numeric spellings. Reject duplicate decoded names
  // BEFORE JSON.parse could discard or overwrite them. No nested body is
  // admitted and no unsupported field is silently stripped.
  const whitespace = "[ \\t\\r\\n]*";
  const string = '"(?:[^"\\\\\\u0000-\\u001f]|\\\\(?:["\\\\/bfnrt]|u[0-9a-fA-F]{4}))*"';
  const number = "-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?";
  const primitive = "(?:true|false|null|" + number + "|" + string + ")";
  const exact = new RegExp("^" + whitespace + "\\{" + whitespace + "(" + string + ")" + whitespace + ":" + whitespace + primitive + whitespace + "," + whitespace + "(" + string + ")" + whitespace + ":" + whitespace + primitive + whitespace + "\\}" + whitespace + "$");
  const match = exact.exec(text);
  if (!match || !match[1] || !match[2] || JSON.parse(match[1]) === JSON.parse(match[2])) throw refusal();
  return pairedHelperLiveness(JSON.parse(text));
}

/** Pure admission of already-bounded bytes; never fetches or signs anything. */
export function admitDeviceHelperHealthBody(rawMetadata: unknown, bytes: Uint8Array): PairedHelperLiveness {
  try { return admittedBody(metadata(rawMetadata), bytes); } catch { throw refusal(); }
}

/** Consume one caller-injected response, never retry or invoke a transport.
 * Body-byte ceiling applies to delivered bytes before UTF-8/JSON decoding,
 * not compressed wire bytes, transport buffering or total JavaScript heap.
 * Current-attempt/abort gates precede every read and follow every await. */
export async function readDeviceHelperHealthResponse(rawMetadata: unknown, rawReader: unknown,
  signal: AbortSignal, isCurrent: () => boolean): Promise<PairedHelperLiveness> {
  let reader: DeviceHelperHealthByteReader | null = null, canceled = false;
  const cancel = () => { if (reader && !canceled) { canceled = true; try { void Promise.resolve(reader.cancel()).catch(() => undefined); } catch { /* Generic refusal only. */ } } };
  let onAbort: (() => void) | null = null;
  try {
    const methods = descriptors(rawReader, ["read", "cancel"]);
    if (typeof methods.read?.value !== "function" || typeof methods.cancel?.value !== "function") throw refusal();
    reader = rawReader as DeviceHelperHealthByteReader;
    const info = metadata(rawMetadata);
    const guard = () => { if (signal.aborted || !isCurrent()) throw refusal(); };
    guard();
    const aborted = new Promise<never>((_resolve, reject) => { onAbort = () => { cancel(); reject(refusal()); }; signal.addEventListener("abort", onAbort, { once: true }); });
    void aborted.catch(() => undefined);
    // Recheck after installing cancellation; an already aborted signal cannot
    // silently leave a read waiting for an event that happened earlier.
    guard();
    const buffer = new Uint8Array(DEVICE_HELPER_HEALTH_MAX_BYTES); let size = 0;
    for (let reads = 0; reads < DEVICE_HELPER_HEALTH_MAX_READS; reads++) {
      guard(); const raw = await Promise.race([reader.read(), aborted]); guard();
      if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.getPrototypeOf(raw) !== Object.prototype) throw refusal();
      const keys = Reflect.ownKeys(raw), result = Object.getOwnPropertyDescriptors(raw);
      if (keys.length < 1 || keys.length > 2 || keys.some(key => key !== "done" && key !== "value") ||
        !result.done?.enumerable || !Object.hasOwn(result.done, "value") || typeof result.done.value !== "boolean" ||
        Object.values(result).some(item => !item.enumerable || !Object.hasOwn(item, "value"))) throw refusal();
      if (result.done.value) {
        if (result.value && result.value.value !== undefined) throw refusal();
        const output = admittedBody(info, buffer.slice(0, size)); guard(); return output;
      }
      const chunk: unknown = result.value?.value, length = byteLength(chunk);
      if (size + length > DEVICE_HELPER_HEALTH_MAX_BYTES) throw refusal();
      buffer.set(chunk as Uint8Array, size); size += length;
    }
    throw refusal();
  } catch { cancel(); throw refusal(); }
  finally { if (onAbort) signal.removeEventListener("abort", onAbort); }
}
