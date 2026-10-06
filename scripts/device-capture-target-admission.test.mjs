import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

// Trusted checked-in declarations only. No module startup, native command,
// helper/server/HTTP/provider, user source evaluation or actual file writes.
const publicSource = readFileSync(new URL("../apps/web/public/connectors/vaettir-device-connector.mjs", import.meta.url), "utf8");
const librarySource = readFileSync(new URL("./device-capture-lib.mjs", import.meta.url), "utf8");
const cliSource = readFileSync(new URL("./capture-mobile-app.mjs", import.meta.url), "utf8");
const printer = ts.createPrinter();
function declarations(source, names) {
  const tree = ts.createSourceFile("owned.mjs", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const selected = tree.statements.filter(node => ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text) ||
    ts.isVariableStatement(node) && node.declarationList.declarations.some(d => ts.isIdentifier(d.name) && names.includes(d.name.text)));
  for (const name of names) assert.ok(selected.some(node => ts.isFunctionDeclaration(node) ? node.name.text === name :
    node.declarationList.declarations.some(d => ts.isIdentifier(d.name) && d.name.text === name)), `Actual source declaration ${name} unavailable`);
  return selected.map(node => printer.printNode(ts.EmitHint.Unspecified, node, tree).replace(/^export\s+/, "")).join("\n");
}
const shared = ["ROLE_BY_NATIVE_TYPE", "captureRefusal", "MAX_HIERARCHY_BYTES", "exactText", "decodeXml", "attributesOf", "hierarchyTags",
  "admitAndroidCaptureOptions", "requireAndroidForeground", "requireAndroidHierarchy", "androidCaptureOrigins", "completeCaptureJsonBytes",
  "captureAndroidWindow", "nativeRole", "eventForRole", "extractElementsFromHierarchy", "buildCaptureManifest"];
const publicNames = [...shared, "listAndroidDevices", "captureAndroid"];
const libraryNames = [...shared, "appendCapture"];
const packageName = "com.synthetic.app";
const focused = (name = packageName) => `WINDOW MANAGER WINDOWS\n  mCurrentFocus=Window{123abc u0 ${name}/.MainActivity}\n`;
const xml = (count = 1, name = " Exact&#10;raw control ", pkg = packageName) => `<hierarchy>${Array.from({ length: count }, () =>
  `<node package="${pkg}" class="android.widget.Button" text="${name}" clickable="true" />`).join("")}</hierarchy>`;
function fixture(source = "public", changes = {}) {
  const calls = [], output = { devices: "List of devices attached\nDEVICE-A\tdevice model:Shared_Name\n", before: focused(), after: focused(), hierarchy: xml(), model: " Shared model \n", ...changes };
  let focusReads = 0, clock = 0, nonce = 0;
  const DateFixture = class extends Date { constructor(...args) { super(...(args.length ? args : [Date.UTC(2026, 9, 6) + clock++])); } };
  const native = {
    listDevices() { return output.devices.split(/\r?\n/).slice(1).map(line => line.trim()).filter(Boolean).map(line => {
      const [id, status] = line.split(/\s+/); return { id, status, ready: status === "device" };
    }); },
    adb(serial, args) { return run("adb", ["-s", serial, ...args]); },
    dumpPath() { return `/sdcard/vaettir-window-${String(++nonce).padStart(32, "0")}.xml`; },
  };
  function run(command, args) {
    calls.push({ command, args: [...args] });
    assert.equal(command, "adb");
    if (args[0] === "devices") return output.devices;
    assert.match(args[1], /^DEVICE-[AB]$/);
    if (args.includes("dumpsys")) return focusReads++ % 2 === 0 ? output.before : output.after;
    if (args.includes("cat")) return output.hierarchy;
    if (args.includes("getprop")) return output.model;
    if (args.includes("dump") || args.includes("rm")) return "";
    throw Error("Unsupported synthetic command");
  }
  const randomBytes = () => Buffer.from(String(++nonce).padStart(32, "0"), "hex");
  const names = source === "public" ? publicNames : libraryNames;
  const code = declarations(source === "public" ? publicSource : librarySource, names);
  const api = new Function("run", "randomBytes", "Date", `'use strict';\n${code}\nreturn {${names.join(",")}};`)(run, randomBytes, DateFixture);
  const capture = options => source === "public" ? api.captureAndroid(options) : api.captureAndroidWindow(options, native);
  return { api, calls, output, capture, native, freezeClock() { clock = -1; }, resetFocus() { focusReads = 0; } };
}
const options = extra => ({ source: "android", serial: "DEVICE-A", expectedPackage: packageName, label: " Exact\nlabel ", ...extra });
const commands = f => f.calls.map(c => c.args.join(" "));

test("public self-contained and pure-library shared admitted helpers are equivalent actual source", () => {
  assert.equal(declarations(publicSource, shared), declarations(librarySource, shared));
  assert.equal(publicSource.includes('from "./device-capture-lib'), false);
  assert.match(publicSource, /not atomic|NOT atomic/);
});
for (const source of ["public", "library"]) {
  test(`${source}: explicit serial/package/source admission occurs before any native read; labels cannot substitute identity`, () => {
    for (const bad of [{ serial: undefined }, { expectedPackage: undefined }, { serial: " DEVICE-A " }, { expectedPackage: "com.synthetic.app " },
      { expectedPackage: "unknown" }, { appName: packageName }, { deviceName: "Shared model" }, { source: "ios-connected" }, { label: "x".repeat(201) }]) {
      const f = fixture(source); assert.throws(() => f.capture(options(bad)), /complete selected capture/); assert.deepEqual(f.calls, []);
    }
    let getters = 0; const f = fixture(source), input = options();
    Object.defineProperty(input, "serial", { enumerable: true, get() { getters++; return "DEVICE-A"; } });
    assert.throws(() => f.capture(input)); assert.equal(getters, 0); assert.deepEqual(f.calls, []);
  });
  test(`${source}: wrong/offline/duplicated device and null/multiple/unparseable/wrong focus refuse before hierarchy`, () => {
    for (const devices of ["List of devices attached\nDEVICE-B\tdevice\n", "List of devices attached\nDEVICE-A\toffline\n",
      "List of devices attached\nDEVICE-A\tdevice\nDEVICE-A\tdevice\n"]) {
      const f = fixture(source, { devices }); assert.throws(() => f.capture(options())); assert.equal(commands(f).some(c => c.includes("dumpsys") || c.includes("dump ")), false);
    }
    for (const before of ["mCurrentFocus=null", focused() + focused(), "mCurrentFocus=unknown", focused("com.foreign.app")]) {
      const f = fixture(source, { before }); assert.throws(() => f.capture(options())); assert.equal(commands(f).some(c => c.includes("uiautomator") || c.includes("cat ") || c.includes("rm ")), false);
    }
  });
  test(`${source}: actual native order observes foreground before/after hierarchy; raw prose is preserved without app-name aliases`, () => {
    const f = fixture(source), result = f.capture(options()), cmds = commands(f);
    const sequence = cmds.filter(c => !c.startsWith("devices"));
    assert.match(sequence[0], /dumpsys window windows/); assert.match(sequence[1], /uiautomator dump/);
    assert.match(sequence[2], /exec-out cat/); assert.match(sequence[3], /dumpsys window windows/);
    assert.match(sequence[4], /getprop/); assert.match(sequence[5], /shell rm -f \/sdcard\/vaettir-window-[0-9a-f]{32}\.xml/);
    assert.equal(result.version, 1); assert.equal(result.appName, packageName); assert.equal(result.deviceName, " Shared model ");
    assert.equal(result.screens[0].label, " Exact\nlabel "); assert.equal(result.screens[0].elements[0].name, " Exact\nraw control ");
    assert.deepEqual(Object.keys(result), ["version", "source", "deviceName", "appName", "capturedAt", "screens"]);
  });
  test(`${source}: late foreground change or foreign/unavailable hierarchy yields no capture; cleanup addresses only its owned path`, () => {
    for (const changed of [{ after: focused("com.foreign.app") }, { hierarchy: xml(1, "SYNTHETIC PRIVATE", "com.foreign.app") },
      { hierarchy: '<hierarchy><node class="android.widget.Button" text="Missing package" /></hierarchy>' }, { hierarchy: xml().slice(0, -3) }]) {
      const f = fixture(source, changed);
      assert.throws(() => f.capture(options()), error => { assert.equal(error.message.includes("SYNTHETIC PRIVATE"), false); return true; });
      assert.equal(commands(f).some(c => c.includes("getprop")), false);
      assert.equal(f.calls.filter(c => c.args.includes("rm")).length, 1);
      assert.match(commands(f).at(-1), /shell rm -f \/sdcard\/vaettir-window-[0-9a-f]{32}\.xml$/);
    }
  });
  test(`${source}: 150 elements/200 UTF16 name accepted; every overbound and malformed complete hierarchy refused, never clipped/deduplicated`, () => {
    const f = fixture(source);
    assert.equal(f.api.extractElementsFromHierarchy(xml(150)).length, 150);
    assert.equal(f.api.extractElementsFromHierarchy(xml(2))[0].name, f.api.extractElementsFromHierarchy(xml(2))[1].name);
    assert.equal(f.api.extractElementsFromHierarchy(xml(1, "🙂".repeat(100)))[0].name.length, 200);
    for (const raw of [xml(151), xml(1, "x".repeat(201)), xml(1, "🙂".repeat(101)), xml(1, "&#0;"), xml(1, "&#xFFFF;"), xml(1, "\u0001"), xml(1, "&unknown;"), xml(1, "\ud800"),
      xml().replace('text="', 'text="other" text="'), xml() + "<node />", xml().slice(0, -1), " ".repeat(1048577),
      '<hierarchy><unsupported text="must not drop" /></hierarchy>',
      '<hierarchy><node text="First" /><node text="Second"></hierarchy>']) assert.throws(() => f.api.extractElementsFromHierarchy(raw));
    assert.equal(f.api.extractElementsFromHierarchy(xml(1, "a &amp; b &lt; c &gt; d &#x1F642;"))[0].name, "a & b < c > d 🙂");
    assert.equal(f.api.extractElementsFromHierarchy(xml(1, "false"))[0].name, "false");
    assert.throws(() => f.api.buildCaptureManifest({ source: "ANDROID_ADB", deviceName: false, label: "safe", hierarchy: xml() }));
    assert.throws(() => f.api.buildCaptureManifest({ source: "ANDROID_ADB", deviceName: "safe", label: "x".repeat(201), hierarchy: xml() }));
  });
}
test("append requires actual in-memory observed target bindings; stored/manual clones and caller labels cannot recreate provenance", () => {
  const f = fixture("library"), first = f.capture(options()), second = f.capture(options({ label: " second " }));
  const appended = f.api.appendCapture(first, second); assert.equal(appended.screens.length, 2); assert.equal(appended.screens[1].label, " second ");
  assert.throws(() => f.api.appendCapture(JSON.parse(JSON.stringify(first)), second));
  assert.throws(() => f.api.appendCapture({ ...first, serial: "DEVICE-A", expectedPackage: packageName }, second));
  const oldTitle = first.screens[0].label; first.screens[0].label = " Manual edit ";
  assert.throws(() => f.api.appendCapture(first, second)); assert.equal(first.screens[0].label, " Manual edit "); first.screens[0].label = oldTitle;
  let getter = 0; Object.defineProperty(first, "private", { enumerable: true, get() { getter++; return "must not read"; } });
  assert.throws(() => f.api.appendCapture(first, second)); assert.equal(getter, 0);
});
test("native serial/package, not display labels, determine supported in-memory append scope", () => {
  const f = fixture("library"), first = f.capture(options()); f.output.devices += "DEVICE-B\tdevice\n";
  assert.throws(() => f.api.appendCapture(first, f.capture(options({ serial: "DEVICE-B" }))));
  f.output.before = focused("com.synthetic.other"); f.output.after = f.output.before; f.output.hierarchy = xml(1, "other", "com.synthetic.other");
  assert.throws(() => f.api.appendCapture(first, f.capture(options({ expectedPackage: "com.synthetic.other" }))));
  f.output.before = focused(); f.output.after = focused(); f.output.hierarchy = xml(); f.output.model = " Different raw display label \n";
  assert.equal(f.api.appendCapture(first, f.capture(options())).screens.length, 2);
});
test("append admits exactly25 whole screens and refuses26 without mutating either original; duplicate native screen IDs refuse", () => {
  const f = fixture("library"); let prior = f.capture(options());
  for (let count = 2; count <= 25; count++) prior = f.api.appendCapture(prior, f.capture(options({ label: `raw-${count}` })));
  const incoming = f.capture(options()); assert.equal(prior.screens.length, 25); assert.throws(() => f.api.appendCapture(prior, incoming));
  assert.equal(prior.screens.length, 25); assert.equal(incoming.screens.length, 1);
  f.freezeClock(); const a = f.capture(options()); f.freezeClock(); const b = f.capture(options());
  assert.throws(() => f.api.appendCapture(a, b));
});
test("actual CLI Android wrapper uses explicit target and no shared temp path; persisted append refuses before device/file access", async () => {
  const f = fixture("library"), io = [];
  let exists = true;
  const code = declarations(cliSource, ["captureAndroid", "main"]);
  let selected = { source: "adb", serial: "DEVICE-A", "expected-package": packageName, label: " raw CLI label ", output: "synthetic.json", append: true };
  const api = new Function("run", "randomBytes", "captureAndroidWindow", "captureRefusal", "parseArguments", "process", "resolve", "existsSync", "readFileSync", "writeFileSync", "buildCaptureManifest", "appendCapture", "console", `${code}\nreturn {captureAndroid,main};`)(
    (command, args) => { io.push(["run", command, args]); return args[0] === "devices" ? f.output.devices : f.native.adb(args[1], args.slice(2)); },
    () => Buffer.alloc(16, 1), f.api.captureAndroidWindow, f.api.captureRefusal, () => selected, { argv: [], stdout: { write: text => io.push(["stdout", text]) } }, path => path,
    () => exists, () => { io.push(["read"]); throw Error("Must not read old file"); }, (...args) => { io.push(["write", ...args]); }, f.api.buildCaptureManifest, f.api.appendCapture, { log() {} });
  await assert.rejects(api.main(), /Nothing was overwritten/); assert.deepEqual(io, []); assert.deepEqual(f.calls, []);
  selected = { ...selected, append: false }; const captured = api.captureAndroid(selected);
  assert.equal(captured.appName, packageName); assert.equal(captured.screens[0].label, " raw CLI label ");
  assert.match(commands(f).find(c => c.includes("dump ")), /vaettir-window-01010101010101010101010101010101\.xml/);
  assert.throws(() => api.captureAndroid({ ...selected, "app-name": packageName }));
  exists = false; await api.main(); const write = io.find(entry => entry[0] === "write");
  assert.equal(write[1], "synthetic.json"); assert.equal(write[3].flag, "wx"); assert.equal(JSON.parse(write[2]).appName, packageName);
  assert.equal(io.some(entry => entry[0] === "read"), false);
  assert.throws(() => api.captureAndroid({ ...selected, output: "" })); assert.throws(() => api.captureAndroid({ ...selected, output: "x".repeat(4097) }));
});
test("actual command wrappers bound native output/time and expose no stderr; no existing iOS adapter is executed or declared foreground proof", () => {
  for (const source of [publicSource, cliSource]) {
    let config; const run = new Function("execFileSync", `${declarations(source, ["run"])}\nreturn run;`)((_command, _args, options) => { config = options; return " raw\n"; });
    assert.equal(run("synthetic", []), " raw\n"); assert.equal(config.maxBuffer, 1048576); assert.equal(config.timeout, 10000); assert.equal(config.windowsHide, true);
    const failed = new Function("execFileSync", `${declarations(source, ["run"])}\nreturn run;`)(() => { throw Object.assign(Error("SYNTHETIC PRIVATE"), { stderr: "SYNTHETIC PRIVATE" }); });
    assert.throws(() => failed("synthetic", []), error => !error.message.includes("PRIVATE"));
  }
  assert.match(publicSource, /\/session\/\$\{sessionId\}\/source/); // Historical unverified iOS path remains separate.
  assert.equal(publicSource.includes("activeAppInfo"), false); assert.equal(cliSource.includes("activeAppInfo"), false);
});
