import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { admitAndroidWindowCaptureRequest, admitAndroidWindowCaptureResponse, admitAndroidWindowCaptureBody,
  ANDROID_WINDOW_CAPTURE_URL, ANDROID_WINDOW_RESPONSE_MAX_BYTES, androidWindowCaptureRefusal,
  type AndroidWindowCaptureRequest, type AndroidWindowCaptureResponse, type AndroidWindowResponseMetadata } from "./android-window-capture-protocol";

const intent = (patch: Partial<AndroidWindowCaptureRequest> = {}): AndroidWindowCaptureRequest => ({ protocolVersion: 1, requestNonce: "00000000-0000-4000-8000-000000000001", serial: "DEVICE-A", expectedPackage: "com.synthetic.app", label: " Exact\nraw label ", ...patch });
const response = (): AndroidWindowCaptureResponse => ({ ...intent(), observation: { kind: "BEFORE_AFTER_WINDOW_OBSERVATIONS_NOT_ATOMIC", beforePackage: intent().expectedPackage, afterPackage: intent().expectedPackage, appExclusive: false },
  capture: { version: 1, source: "ANDROID_ADB", deviceName: " Raw model ", appName: intent().expectedPackage, capturedAt: "2026-10-06T00:00:00.000Z", screens: [{ id: "screen-20261006000000000", label: intent().label, elements: [{ role: "button", name: " Exact\nraw control ", stableId: "raw-id", event: "click" }] }] },
  processingPermissionGranted: false, spendingPermissionGranted: false, operationReceiptAvailable: false });
const metadata = (patch: Partial<AndroidWindowResponseMetadata> = {}): AndroidWindowResponseMetadata => ({ url: ANDROID_WINDOW_CAPTURE_URL, status: 200, redirected: false, contentType: "application/json", contentLength: null, ...patch });
const encode = (value: unknown) => new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value));

describe("strict versioned Android window protocol, pure synthetic admission only", () => {
  it("keeps raw labels/newlines/duplicates and manifest v1 without defaults or permission/receipt claims", () => {
    const raw = response(); raw.capture.screens[0]!.elements.push({ ...raw.capture.screens[0]!.elements[0]! });
    const admitted = admitAndroidWindowCaptureResponse(raw, intent());
    expect(admitted.capture).toBe(raw.capture); expect(admitted.capture.screens[0]!.elements).toHaveLength(2);
    expect(admitted.label).toBe(" Exact\nraw label "); expect(admitted.capture.screens[0]!.elements[0]!.name).toBe(" Exact\nraw control ");
    expect(admitted).toMatchObject({ processingPermissionGranted: false, spendingPermissionGranted: false, operationReceiptAvailable: false, observation: { appExclusive: false } });
  });
  it.each([{ requestNonce: "different" }, { serial: "OTHER" }, { expectedPackage: "com.other.app" }, { label: "trimmed" }, { protocolVersion: 2 }, { source: "android" }, { label: null }])("refuses wrong/extra exact response echoes %j", patch => {
    expect(() => admitAndroidWindowCaptureResponse({ ...response(), ...patch }, intent())).toThrow(androidWindowCaptureRefusal);
  });
  it("refuses every old v2/unversioned/404/redirect/iOS form; no network or fallback exists", () => {
    for (const raw of [{ capture: response().capture }, { connected: true, version: 2 }, { ...response(), processingPermissionGranted: true }, { ...response(), operationReceiptAvailable: true }, { ...response(), observation: { ...response().observation, appExclusive: true } }]) expect(() => admitAndroidWindowCaptureResponse(raw, intent())).toThrow(androidWindowCaptureRefusal);
    const ios = response(); ios.capture.source = "IOS_CONNECTED"; expect(() => admitAndroidWindowCaptureResponse(ios, intent())).toThrow(androidWindowCaptureRefusal);
    for (const patch of [{ status: 404 }, { redirected: true }, { url: "http://127.0.0.1:4774/capture" }, { url: "http://localhost:4774/capture/android-window-v1" }, { contentType: "text/plain" }, { contentLength: "1" }]) expect(() => admitAndroidWindowCaptureBody(metadata(patch), encode(response()), intent())).toThrow(androidWindowCaptureRefusal);
  });
  it("descriptor/unknown/getter/symbol/hidden/cyclic whole-body refusal precedes schema value access", () => {
    let read = 0;
    const getter = Object.defineProperty(response(), "capture", { enumerable: true, get() { read++; return response().capture; } });
    const nested = response(); Object.defineProperty(nested.capture.screens[0]!, "label", { enumerable: true, get() { read++; return "PRIVATE"; } });
    const hidden = Object.defineProperty(response(), "private", { value: "PRIVATE" });
    const cyclic: Record<string, unknown> = { ...response() }; cyclic.loop = cyclic;
    for (const raw of [getter, nested, hidden, cyclic, { ...response(), [Symbol("private")]: "PRIVATE" }, { ...response(), private: "PRIVATE" }]) expect(() => admitAndroidWindowCaptureResponse(raw, intent())).toThrow(androidWindowCaptureRefusal);
    const byteGetter = encode(response()); Object.defineProperty(byteGetter, "private", { get() { read++; return "PRIVATE"; } });
    expect(() => admitAndroidWindowCaptureBody(metadata(), byteGetter, intent())).toThrow(androidWindowCaptureRefusal); expect(read).toBe(0);
  });
  it("duplicates including escaped nested names, malformed/full grammar/depth/UTF8/BOM refuse before information is overwritten", () => {
    const text = JSON.stringify(response());
    for (const raw of [text.replace('"protocolVersion":1', '"protocolVersion":2,"protocolVersion":1'), text.replace('"name":', '"\\u006eame":"PRIVATE","name":'), text + "{}", text.slice(0, -1), "\ufeff" + text,
      "[".repeat(65) + "0" + "]".repeat(65), '{"a":1,"\\u0061":2}', text.replace('" Raw model "', '"\\ud800"')]) expect(() => admitAndroidWindowCaptureBody(metadata(), encode(raw), intent())).toThrow(androidWindowCaptureRefusal);
    expect(() => admitAndroidWindowCaptureBody(metadata(), new Uint8Array([0xff]), intent())).toThrow(androidWindowCaptureRefusal);
  });
  it("admits exact complete delivered2MiB with padding;2MiB+1 whole refusal and semantic overbounds never clip", () => {
    const text = JSON.stringify(response()), raw = encode(text + " ".repeat(ANDROID_WINDOW_RESPONSE_MAX_BYTES - encode(text).length));
    expect(raw.byteLength).toBe(ANDROID_WINDOW_RESPONSE_MAX_BYTES);
    expect(admitAndroidWindowCaptureBody(metadata({ contentLength: String(raw.byteLength) }), raw, intent()).capture.screens[0]!.label).toBe(intent().label);
    expect(() => admitAndroidWindowCaptureBody(metadata(), encode(text + " ".repeat(ANDROID_WINDOW_RESPONSE_MAX_BYTES + 1 - encode(text).length)), intent())).toThrow(androidWindowCaptureRefusal);
    const original = response(); original.capture.screens[0]!.elements = Array.from({ length: 151 }, () => ({ role: "button", name: "raw" }));
    expect(() => admitAndroidWindowCaptureResponse(original, intent())).toThrow(androidWindowCaptureRefusal); expect(original.capture.screens[0]!.elements).toHaveLength(151);
    const long = response(); long.capture.screens[0]!.elements[0]!.name = "🙂".repeat(101); expect(() => admitAndroidWindowCaptureResponse(long, intent())).toThrow(androidWindowCaptureRefusal); expect(long.capture.screens[0]!.elements[0]!.name).toHaveLength(202);
    const extra = response(); Object.assign(extra.capture.screens[0]!.elements[0]!, { unknown: null }); expect(() => admitAndroidWindowCaptureResponse(extra, intent())).toThrow(androidWindowCaptureRefusal);
  });
  it("strict caller request identity is exact, required and never regenerated/trimmed", () => {
    expect(admitAndroidWindowCaptureRequest(intent())).toEqual(intent());
    for (const raw of [{ ...intent(), label: undefined }, { ...intent(), serial: " DEVICE-A " }, { ...intent(), expectedPackage: "unknown" }, { ...intent(), source: "android" }, { ...intent(), requestNonce: "00000000-0000-4000-8000-00000000000A" }]) expect(() => admitAndroidWindowCaptureRequest(raw)).toThrow(androidWindowCaptureRefusal);
  });
  it("decodes the actual checked-in collector/response builder with fake native reads, not a hand-labelled target DTO", () => {
    const source = readFileSync(new URL("../public/connectors/vaettir-device-connector.mjs", import.meta.url), "utf8");
    const names = ["ROLE_BY_NATIVE_TYPE", "captureRefusal", "MAX_HIERARCHY_BYTES", "exactText", "decodeXml", "attributesOf", "hierarchyTags", "admitAndroidCaptureOptions", "requireAndroidForeground", "requireAndroidHierarchy", "androidCaptureOrigins", "completeCaptureJsonBytes", "captureAndroidWindow", "nativeRole", "eventForRole", "extractElementsFromHierarchy", "buildCaptureManifest", "ANDROID_WINDOW_REQUEST_BYTES", "ANDROID_WINDOW_RESPONSE_BYTES", "ANDROID_WINDOW_OBSERVATION", "admitAndroidWindowRequest", "buildAndroidWindowResponse"];
    const tree = ts.createSourceFile("trusted.mjs", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS), printer = ts.createPrinter();
    const selected = tree.statements.filter(node => ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text) || ts.isVariableStatement(node) && node.declarationList.declarations.some(d => ts.isIdentifier(d.name) && names.includes(d.name.text)));
    expect(selected).toHaveLength(names.length);
    const code = selected.map(node => printer.printNode(ts.EmitHint.Unspecified, node, tree)).join("\n");
    const api: { captureAndroidWindow(options: unknown, native: unknown): unknown; buildAndroidWindowResponse(request: unknown, capture: unknown): unknown } = new Function(`${code}\nreturn {captureAndroidWindow,buildAndroidWindowResponse};`)();
    const calls: string[][] = [], hierarchy = '<hierarchy><node package="com.synthetic.app" class="android.widget.Button" text=" Exact&#10;raw control " /></hierarchy>';
    const capture = api.captureAndroidWindow({ source: "android", serial: intent().serial, expectedPackage: intent().expectedPackage, label: intent().label }, {
      listDevices: () => [{ id: "DEVICE-A", status: "device", ready: true }], dumpPath: () => "/sdcard/vaettir-window-00000000000000000000000000000001.xml",
      adb: (_serial: string, args: string[]) => { calls.push(args); if (args.includes("dumpsys")) return "mCurrentFocus=Window{123abc u0 com.synthetic.app/.MainActivity}"; if (args.includes("cat")) return hierarchy; if (args.includes("getprop")) return " Raw model \n"; return ""; },
    });
    const wire = api.buildAndroidWindowResponse(intent(), capture), admitted = admitAndroidWindowCaptureBody(metadata(), encode(wire), intent());
    expect(admitted.capture).toEqual(capture); expect(admitted.capture.screens[0]!.elements[0]!.name).toBe(" Exact\nraw control ");
    expect(calls.filter(args => args.includes("dumpsys"))).toHaveLength(2); expect(calls.at(-1)).toEqual(["shell", "rm", "-f", "/sdcard/vaettir-window-00000000000000000000000000000001.xml"]);
  });
});
