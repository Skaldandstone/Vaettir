import { ownedDeviceSemanticCapture, type OwnedDeviceSemanticCapture } from "../../api/src/services/deviceCaptureAccessSchema";

export const ANDROID_WINDOW_CAPTURE_PATH = "/capture/android-window-v1";
export const ANDROID_WINDOW_CAPTURE_URL = "http://127.0.0.1:4774" + ANDROID_WINDOW_CAPTURE_PATH;
export const ANDROID_WINDOW_REQUEST_MAX_BYTES = 4096;
export const ANDROID_WINDOW_RESPONSE_MAX_BYTES = 2 * 1024 * 1024;
export const ANDROID_WINDOW_OBSERVATION_KIND = "BEFORE_AFTER_WINDOW_OBSERVATIONS_NOT_ATOMIC";
export const androidWindowCaptureRefusal = "No complete supported response for this exact Android window intent was admitted. No fallback, retry or permission was granted.";
export type AndroidWindowCaptureRequest = Readonly<{ protocolVersion: 1; requestNonce: string; serial: string; expectedPackage: string; label: string }>;
export type AndroidWindowCaptureResponse = AndroidWindowCaptureRequest & Readonly<{
  observation: Readonly<{ kind: typeof ANDROID_WINDOW_OBSERVATION_KIND; beforePackage: string; afterPackage: string; appExclusive: false }>;
  capture: OwnedDeviceSemanticCapture;
  processingPermissionGranted: false; spendingPermissionGranted: false; operationReceiptAvailable: false;
}>;
const refuse = () => Error(androidWindowCaptureRefusal);
const encoded = (text: string) => new TextEncoder().encode(text).byteLength;
function exactText(raw: unknown, maximum: number, minimum = 1): string {
  if (typeof raw !== "string" || raw.length < minimum || raw.length > maximum || Array.from(raw).some(c => { const n = c.codePointAt(0)!; return n === 0 || n >= 0xd800 && n <= 0xdfff; })) throw refuse();
  return raw;
}
/** Whole descriptor admission BEFORE schema parsing. No getter/toJSON hooks,
 * symbol/hidden fields, exotic prototypes, sparse arrays or partial copying. */
function jsonBytes(raw: unknown, maximum: number): number {
  let nodes = 0, bytes = 0; const seen = new Set<object>();
  const add = (text: string) => { bytes += encoded(text); if (bytes > maximum) throw refuse(); };
  const visit = (value: unknown, depth: number): void => {
    if (++nodes > 100000 || depth > 64) throw refuse();
    if (value === null || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) { add(JSON.stringify(value)); return; }
    if (typeof value === "string") { add(JSON.stringify(exactText(value, maximum, 0))); return; }
    if (!value || typeof value !== "object" || seen.has(value)) throw refuse();
    const array = Array.isArray(value), descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
    if (Object.getPrototypeOf(value) !== (array ? Array.prototype : Object.prototype) || keys.some(key => typeof key !== "string") || keys.length > 10000) throw refuse();
    const names = array ? keys.filter(key => key !== "length") : keys;
    const length: unknown = descriptors.length?.value;
    if (array && (typeof length !== "number" || length > 1000 || names.length !== length || names.some(key => typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= length))) throw refuse();
    seen.add(value); add(array ? "[" : "{");
    for (let index = 0; index < names.length; index++) {
      const key = array ? String(index) : names[index]; if (typeof key !== "string") throw refuse();
      const descriptor = descriptors[key]; if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) throw refuse();
      if (index) add(","); if (!array) add(JSON.stringify(key) + ":"); visit(descriptor.value, depth + 1);
    }
    add(array ? "]" : "}"); seen.delete(value);
  };
  visit(raw, 0); return bytes;
}
function record(raw: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.getPrototypeOf(raw) !== Object.prototype) throw refuse();
  const keys = Reflect.ownKeys(raw), data = Object.getOwnPropertyDescriptors(raw);
  if (keys.length !== fields.length || keys.some(key => typeof key !== "string" || !fields.includes(key)) || Object.values(data).some(d => !d.enumerable || !Object.hasOwn(d, "value"))) throw refuse();
  return Object.fromEntries(fields.map(key => [key, data[key]?.value]));
}
function request(raw: unknown): AndroidWindowCaptureRequest {
  jsonBytes(raw, ANDROID_WINDOW_REQUEST_MAX_BYTES);
  const value = record(raw, ["protocolVersion", "requestNonce", "serial", "expectedPackage", "label"]);
  const requestNonce = exactText(value.requestNonce, 36), serial = exactText(value.serial, 200), expectedPackage = exactText(value.expectedPackage, 200), label = exactText(value.label, 200);
  if (value.protocolVersion !== 1 || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(requestNonce) || !/^[A-Za-z0-9._:-]+$/.test(serial) || !/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+$/.test(expectedPackage)) throw refuse();
  return Object.freeze({ protocolVersion: 1, requestNonce, serial, expectedPackage, label });
}
export function admitAndroidWindowCaptureRequest(raw: unknown): AndroidWindowCaptureRequest {
  try { return request(raw); } catch { throw refuse(); }
}
/** Pure response admission; the supplied intent must be the caller's privately
 * retained original intent, not an origin established from response echoes.
 * This grants no current actor, capture/processing consent or receipt recovery. */
export function admitAndroidWindowCaptureResponse(raw: unknown, originalIntent: AndroidWindowCaptureRequest): AndroidWindowCaptureResponse {
  try {
    const intent = request(originalIntent); jsonBytes(raw, ANDROID_WINDOW_RESPONSE_MAX_BYTES);
    const data = record(raw, ["protocolVersion", "requestNonce", "serial", "expectedPackage", "label", "observation", "capture", "processingPermissionGranted", "spendingPermissionGranted", "operationReceiptAvailable"]);
    for (const key of ["protocolVersion", "requestNonce", "serial", "expectedPackage", "label"] as const) if (data[key] !== intent[key]) throw refuse();
    const observation = record(data.observation, ["kind", "beforePackage", "afterPackage", "appExclusive"]);
    if (observation.kind !== ANDROID_WINDOW_OBSERVATION_KIND || observation.beforePackage !== intent.expectedPackage || observation.afterPackage !== intent.expectedPackage || observation.appExclusive !== false || data.processingPermissionGranted !== false || data.spendingPermissionGranted !== false || data.operationReceiptAvailable !== false) throw refuse();
    const parsed = ownedDeviceSemanticCapture.safeParse(data.capture);
    if (!parsed.success || parsed.data.source !== "ANDROID_ADB" || parsed.data.appName !== intent.expectedPackage || parsed.data.screens.length !== 1 || parsed.data.screens[0]?.label !== intent.label || parsed.data.screens[0].elements.length === 0) throw refuse();
    // Schema parsing performs no normalization. Retain the exact admitted body
    // rather than substituting parsed/defaulted sibling fields or old v2 data.
    const capture = data.capture as OwnedDeviceSemanticCapture;
    return Object.freeze({ ...intent, observation: Object.freeze({ kind: ANDROID_WINDOW_OBSERVATION_KIND, beforePackage: intent.expectedPackage, afterPackage: intent.expectedPackage, appExclusive: false }), capture, processingPermissionGranted: false, spendingPermissionGranted: false, operationReceiptAvailable: false });
  } catch { throw refuse(); }
}

/** Whole grammar scan to refuse duplicate decoded keys before JSON.parse. */
function parseJson(text: string): unknown {
  if (text.length > ANDROID_WINDOW_RESPONSE_MAX_BYTES || encoded(text) > ANDROID_WINDOW_RESPONSE_MAX_BYTES) throw refuse();
  let offset = 0, nodes = 0;
  const whitespace = () => { while (/[ \t\r\n]/.test(text[offset] ?? "!") && offset < text.length) offset++; };
  const string = (): string => {
    const start = offset;
    if (text[offset++] !== '"') throw refuse();
    while (offset < text.length) {
      const character = text[offset++]!;
      if (character === '"') return exactText(JSON.parse(text.slice(start, offset)), ANDROID_WINDOW_RESPONSE_MAX_BYTES, 0);
      if (character.charCodeAt(0) < 32) throw refuse();
      if (character === "\\") {
        const escaped = text[offset++];
        if (escaped === "u") { if (!/^[0-9a-fA-F]{4}$/.test(text.slice(offset, offset + 4))) throw refuse(); offset += 4; }
        else if (!escaped || !'"\\/bfnrt'.includes(escaped)) throw refuse();
      }
    }
    throw refuse();
  };
  const value = (depth: number): void => {
    if (++nodes > 100000 || depth > 64) throw refuse();
    whitespace(); const character = text[offset];
    if (character === '"') { string(); return; }
    if (character === "{" || character === "[") {
      const object = character === "{", close = object ? "}" : "]", names = new Set<string>(); let count = 0;
      offset++; whitespace(); if (text[offset] === close) { offset++; return; }
      while (offset < text.length) {
        if (++count > (object ? 10000 : 1000)) throw refuse();
        if (object) { whitespace(); const name = string(); if (names.has(name)) throw refuse(); names.add(name); whitespace(); if (text[offset++] !== ":") throw refuse(); }
        value(depth + 1); whitespace(); if (text[offset] === close) { offset++; return; }
        if (text[offset++] !== ",") throw refuse();
      }
      throw refuse();
    }
    const match = /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(text.slice(offset));
    if (!match) throw refuse(); offset += match[0].length;
  };
  value(0); whitespace(); if (offset !== text.length) throw refuse(); return JSON.parse(text);
}
export type AndroidWindowResponseMetadata = Readonly<{ url: string; status: number; redirected: boolean; contentType: string | null; contentLength: string | null }>;
/** Admit already delivered complete bytes only. Caller owns one explicit
 * redirect-denied, timeout/bounded stream and original SDK/native/consent lease.
 * Old helpers'404s refuse BEFORE decoding; never retry/fallback/network here. */
export function admitAndroidWindowCaptureBody(rawMetadata: unknown, bytes: Uint8Array, originalIntent: AndroidWindowCaptureRequest): AndroidWindowCaptureResponse {
  try {
    const info = record(rawMetadata, ["url", "status", "redirected", "contentType", "contentLength"]);
    if (info.url !== ANDROID_WINDOW_CAPTURE_URL || info.status !== 200 || info.redirected !== false || typeof info.contentType !== "string" || info.contentType.length > 120 || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(info.contentType) || info.contentLength !== null && (typeof info.contentLength !== "string" || !/^[0-9]{1,9}$/.test(info.contentLength) || Number(info.contentLength) > ANDROID_WINDOW_RESPONSE_MAX_BYTES)) throw refuse();
    if (!bytes || Object.getPrototypeOf(bytes) !== Uint8Array.prototype) throw refuse();
    const getter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), "byteLength")?.get;
    const size: unknown = getter?.call(bytes);
    if (typeof size !== "number" || size === 0 || size > ANDROID_WINDOW_RESPONSE_MAX_BYTES || info.contentLength !== null && Number(info.contentLength) !== size) throw refuse();
    // A native branded Uint8Array's in-range integer properties cannot be
    // accessor descriptors. Refuse every decoration without materializing
    // millions of descriptor objects for a ceiling-sized delivered body.
    const keys = Reflect.ownKeys(bytes);
    if (keys.length !== size || keys.some(key => typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= size)) throw refuse();
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    return admitAndroidWindowCaptureResponse(parseJson(text), originalIntent);
  } catch { throw refuse(); }
}
