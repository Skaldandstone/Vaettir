#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { join } from "node:path";

const ROLE_BY_NATIVE_TYPE = [
  [/button|imagebutton/i, "button"],
  [/textfield|edittext|searchfield|securetextfield/i, "textbox"],
  [/switch|toggle/i, "switch"],
  [/checkbox/i, "checkbox"],
  [/radio/i, "radio"],
  [/link/i, "link"],
  [/picker|spinner|combobox/i, "combobox"],
  [/tab/i, "tab"],
  [/cell/i, "cell"],
  [/statictext|textview/i, "text"],
];

const allowedOrigins = new Set([
  "https://vaettir.skaldandstone.com",
  "http://localhost:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3001",
]);

function validatedConnectorOrigin(origin) {
  try {
    const url = new URL(origin);
    const customer = url.protocol === "https:" && !url.port &&
      /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.vaettir\.app$/.test(url.hostname);
    if (typeof origin !== "string" || url.origin !== origin ||
      (!allowedOrigins.has(origin) && !customer)) throw Error();
    return origin;
  } catch {
    throw new Error("--origin must be an exact supported Vaettir or development origin.");
  }
}

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) continue;
    values[argument.slice(2)] = argv[index + 1];
    index += 1;
  }
  return values;
}

function resolveAdb() {
  // Android Studio's standard SDK installation is not necessarily on PATH.
  // Use an existing installation only; never install tools or change PATH.
  const roots = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT];
  if (process.platform === "win32" && process.env.LOCALAPPDATA)
    roots.push(join(process.env.LOCALAPPDATA, "Android", "Sdk"));
  for (const root of roots) {
    if (!root) continue;
    const candidate = join(root, "platform-tools", process.platform === "win32" ? "adb.exe" : "adb");
    if (existsSync(candidate)) return candidate;
  }
  return "adb";
}

function run(command, args) {
  try {
    return execFileSync(command === "adb" ? resolveAdb() : command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 1024 * 1024, timeout: 10000, windowsHide: true,
    });
  } catch (error) {
    throw new Error("A local device command did not return a complete supported result.", { cause: error });
  }
}

function listAndroidDevices() {
  let output;
  try {
    output = run("adb", ["devices", "-l"]);
  } catch (error) {
    if (error?.cause?.code === "ENOENT") {
      throw new Error(
        "ADB is not installed or is not on PATH. Install Android Platform Tools, then restart the helper.",
        { cause: error },
      );
    }
    throw error;
  }
  return output
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [serial, state, ...details] = line.split(/\s+/);
      const model = details
        .find((detail) => detail.startsWith("model:"))
        ?.slice("model:".length)
        .replaceAll("_", " ");
      return {
        id: serial,
        name: model || serial,
        status: state,
        ready: state === "device",
      };
    });
}

const captureRefusal = () => new Error("The complete selected capture is unsupported or outside its explicit observed target. No value was clipped or substituted.");
const MAX_HIERARCHY_BYTES = 1024 * 1024;

function exactText(value, max, min = 1) {
  if (typeof value !== "string" || value.length < min || value.length > max || Array.from(value).some(c => {
    const n = c.codePointAt(0); return n === 0 || n >= 0xd800 && n <= 0xdfff;
  })) throw captureRefusal();
  return value;
}

function decodeXml(value) {
  if (value.includes("<") || Array.from(value).some(c => { const n = c.codePointAt(0); return n < 32 && ![9, 10, 13].includes(n) || n === 0xfffe || n === 0xffff; }) || /&(?!quot;|apos;|lt;|gt;|amp;|#\d+;|#x[0-9a-fA-F]+;)/.test(value)) throw captureRefusal();
  return value.replace(/&(quot|apos|lt|gt|amp|#\d+|#x[0-9a-fA-F]+);/g, (_, entity) => {
    const named = { quot: '"', apos: "'", lt: "<", gt: ">", amp: "&" };
    if (Object.hasOwn(named, entity)) return named[entity];
    const n = entity.startsWith("#x") ? Number.parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    if (!Number.isSafeInteger(n) || n < 0 || n > 0x10ffff || n >= 0xd800 && n <= 0xdfff || n === 0xfffe || n === 0xffff || n < 32 && ![9, 10, 13].includes(n)) throw captureRefusal();
    return String.fromCodePoint(n);
  });
}

function attributesOf(tag) {
  const attributes = {};
  for (const match of tag.matchAll(/([A-Za-z_][A-Za-z0-9_.:-]*)\s*=\s*"([^"]*)"/g)) {
    if (Object.hasOwn(attributes, match[1])) throw captureRefusal();
    Object.defineProperty(attributes, match[1], { value: decodeXml(match[2]), enumerable: true });
  }
  return attributes;
}

function hierarchyTags(xml) {
  exactText(xml, MAX_HIERARCHY_BYTES);
  if (Buffer.byteLength(xml, "utf8") > MAX_HIERARCHY_BYTES) throw captureRefusal();
  const tokens = /<\?xml[^?]*\?>|<\/?[A-Za-z_][A-Za-z0-9_.:-]*(?:\s+[A-Za-z_][A-Za-z0-9_.:-]*\s*=\s*"[^"]*")*\s*\/?>/g;
  const stack = [], tags = []; let end = 0, roots = 0, count = 0, declaration = false;
  for (const match of xml.matchAll(tokens)) {
    if (!/^\s*$/.test(xml.slice(end, match.index)) || ++count > 5000) throw captureRefusal();
    end = match.index + match[0].length;
    const token = match[0];
    if (token.startsWith("<?")) {
      if (declaration || roots || stack.length) throw captureRefusal();
      declaration = true; continue;
    }
    const name = token.match(/^<\/?([A-Za-z_][A-Za-z0-9_.:-]*)/)[1];
    if (!["hierarchy", "node"].includes(name) && !name.startsWith("XCUIElementType")) throw captureRefusal();
    if (token.startsWith("</")) {
      if (!/^<\/[A-Za-z_][A-Za-z0-9_.:-]*\s*>$/.test(token) || stack.pop() !== name) throw captureRefusal();
    } else {
      if (!stack.length && ++roots > 1) throw captureRefusal();
      attributesOf(token); // Refuse duplicate/unsupported entities even in unnamed nodes.
      if (name === "node" || name.startsWith("XCUIElementType")) tags.push(token);
      if (!token.endsWith("/>")) { stack.push(name); if (stack.length > 64) throw captureRefusal(); }
    }
  }
  if (stack.length || roots !== 1 || !/^\s*$/.test(xml.slice(end))) throw captureRefusal();
  return tags;
}

function admitAndroidCaptureOptions(options, packageKey = "expectedPackage") {
  if (!["expectedPackage", "expected-package"].includes(packageKey)) throw captureRefusal();
  if (!options || typeof options !== "object" || Array.isArray(options) || Object.getPrototypeOf(options) !== Object.prototype) throw captureRefusal();
  const allowed = packageKey === "expectedPackage" ? ["source", "serial", packageKey, "label"] : ["source", "serial", packageKey, "label", "output", "append"];
  const descriptors = Object.getOwnPropertyDescriptors(options), keys = Reflect.ownKeys(descriptors);
  if (keys.length > allowed.length || keys.some(key => typeof key !== "string" || !allowed.includes(key) || !descriptors[key].enumerable || !Object.hasOwn(descriptors[key], "value"))) throw captureRefusal();
  for (const key of keys) if (key === "append" ? typeof descriptors[key].value !== "boolean" : typeof descriptors[key].value !== "string") throw captureRefusal();
  if (descriptors.source?.value !== (packageKey === "expectedPackage" ? "android" : "adb")) throw captureRefusal();
  const serial = exactText(descriptors.serial?.value, 200), expectedPackage = exactText(descriptors[packageKey]?.value, 200);
  if (!/^[A-Za-z0-9._:-]+$/.test(serial) || !/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+$/.test(expectedPackage)) throw captureRefusal();
  if (descriptors.label) exactText(descriptors.label.value, 200);
  if (descriptors.output) exactText(descriptors.output.value, 4096);
  return Object.freeze({ serial, expectedPackage, label: descriptors.label?.value ?? "Current Android screen" });
}

function requireAndroidForeground(output, expectedPackage) {
  exactText(output, MAX_HIERARCHY_BYTES);
  const focus = Array.from(output.matchAll(/\bmCurrentFocus=([^\r\n]*)/g));
  if (focus.length !== 1) throw captureRefusal();
  const observed = focus[0][1].match(/^\s*Window\{[a-fA-F0-9]+\s+u\d+\s+([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+)\/[A-Za-z0-9_.$]+\}\s*$/)?.[1];
  if (observed !== expectedPackage) throw captureRefusal();
  return observed;
}

function requireAndroidHierarchy(hierarchy, expectedPackage) {
  const tags = hierarchyTags(hierarchy);
  if (!tags.length) throw captureRefusal();
  for (const tag of tags) {
    if (!tag.startsWith("<node")) throw captureRefusal();
    const attributes = attributesOf(tag);
    if (attributes.visible !== "false" && attributes.displayed !== "false" && attributes.package !== expectedPackage) throw captureRefusal();
  }
}

// Only this in-memory collector binds an observed device/package to its exact
// result. A stored v1 file or caller-supplied labels cannot recreate the binding.
const androidCaptureOrigins = new WeakMap();

function completeCaptureJsonBytes(value) {
  let nodes = 0, bytes = 0; const seen = new Set();
  const add = text => { bytes += Buffer.byteLength(text, "utf8"); if (bytes > 2 * 1024 * 1024) throw captureRefusal(); };
  function visit(item, depth) {
    if (++nodes > 100000 || depth > 64) throw captureRefusal();
    if (item === null || typeof item === "boolean" || typeof item === "number" && Number.isFinite(item)) { add(JSON.stringify(item)); return; }
    if (typeof item === "string") { exactText(item, 2 * 1024 * 1024, 0); add(JSON.stringify(item)); return; }
    if (!item || typeof item !== "object" || seen.has(item)) throw captureRefusal();
    const array = Array.isArray(item), descriptors = Object.getOwnPropertyDescriptors(item), keys = Reflect.ownKeys(descriptors);
    if (Object.getPrototypeOf(item) !== (array ? Array.prototype : Object.prototype) || keys.some(key => typeof key !== "string") || keys.length > 10000) throw captureRefusal();
    seen.add(item); add(array ? "[" : "{");
    const names = array ? keys.filter(key => key !== "length") : keys;
    if (array && (item.length > 1000 || names.length !== item.length || names.some(key => !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= item.length))) throw captureRefusal();
    for (let index = 0; index < names.length; index++) {
      const key = array ? String(index) : names[index], d = descriptors[key];
      if (!d?.enumerable || !Object.hasOwn(d, "value")) throw captureRefusal();
      if (index) add(","); if (!array) add(JSON.stringify(key) + ":"); visit(d.value, depth + 1);
    }
    add(array ? "]" : "}"); seen.delete(item);
  }
  visit(value, 0); return bytes;
}
function captureAndroidWindow(options, native, packageKey = "expectedPackage") {
  const target = admitAndroidCaptureOptions(options, packageKey);
  const adb = (...args) => native.adb(target.serial, args);
  let attempted = false, failed = false, captured, dumpPath;
  try {
    const devices = native.listDevices();
    if (!Array.isArray(devices) || devices.length > 100 || devices.filter(device => device.id === target.serial && device.ready === true && device.status === "device").length !== 1) throw captureRefusal();
    requireAndroidForeground(adb("shell", "dumpsys", "window", "windows"), target.expectedPackage);
    dumpPath = native.dumpPath();
    if (typeof dumpPath !== "string" || !/^\/sdcard\/vaettir-window-[a-f0-9]{32}\.xml$/.test(dumpPath)) throw captureRefusal();
    attempted = true;
    adb("shell", "uiautomator", "dump", dumpPath);
    const hierarchy = adb("exec-out", "cat", dumpPath);
    requireAndroidForeground(adb("shell", "dumpsys", "window", "windows"), target.expectedPackage);
    requireAndroidHierarchy(hierarchy, target.expectedPackage);
    const rawModel = adb("shell", "getprop", "ro.product.model");
    const model = typeof rawModel === "string" ? rawModel.replace(/\r?\n$/, "") : rawModel;
    captured = buildCaptureManifest({ source: "ANDROID_ADB", deviceName: model === "" ? target.serial : model,
      appName: target.expectedPackage, label: target.label, hierarchy });
  } catch { failed = true; }
  finally { if (attempted) { try { adb("shell", "rm", "-f", dumpPath); } catch { failed = true; } } }
  if (failed || !captured) throw captureRefusal();
  androidCaptureOrigins.set(captured, Object.freeze({ source: "ANDROID_ADB", serial: target.serial,
    expectedPackage: target.expectedPackage, signature: JSON.stringify(captured) }));
  // Before/after focus and hierarchy package observations are NOT atomic
  // app-exclusive collection, source-processing consent or an operation receipt.
  return captured;
}

function nativeRole(attributes, tag) {
  const type = [attributes.class, attributes.type, tag]
    .filter(Boolean)
    .join(" ");
  return (
    ROLE_BY_NATIVE_TYPE.find(([pattern]) => pattern.test(type))?.[1] ??
    (attributes.clickable === "true" ? "button" : "element")
  );
}

function eventForRole(role) {
  if (role === "textbox") return "fill";
  if (["checkbox", "radio", "switch"].includes(role)) return "check";
  if (role === "combobox") return "select";
  if (role === "link") return "navigate";
  return "click";
}

function extractElementsFromHierarchy(xml, maximum = 150) {
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 150) throw captureRefusal();
  const elements = [];
  const tags = hierarchyTags(xml);
  for (const tag of tags) {
    const attributes = attributesOf(tag);
    if (attributes.visible === "false" || attributes.displayed === "false")
      continue;
    const name = [
      attributes.text,
      attributes["content-desc"],
      attributes.label,
      attributes.name,
      attributes.value,
      attributes["resource-id"],
    ].find((value) => typeof value === "string" && value.length > 0);
    if (!name) continue;
    const role = nativeRole(attributes, tag);
    const normalizedName = exactText(name, 200);
    const androidId = attributes["resource-id"];
    const iosId = tag.startsWith("<XCUIElementType")
      ? attributes.name
      : undefined;
    const stableId = androidId || iosId || undefined;
    if (stableId !== undefined) exactText(stableId, 200);
    const selector = androidId
      ? `resource-id=${androidId}`
      : iosId
        ? `accessibility-id=${iosId}`
        : undefined;
    if (selector !== undefined) exactText(selector, 500);
    elements.push({
      role,
      name: normalizedName,
      ...(stableId ? { stableId } : {}),
      ...(selector ? { selector } : {}),
      event: eventForRole(role),
    });
    if (elements.length > maximum) throw captureRefusal();
  }
  return elements;
}

function buildCaptureManifest({
  source,
  deviceName,
  appName,
  label,
  hierarchy,
}) {
  if (!["ANDROID_ADB", "IOS_CONNECTED", "IOS_REMOTE"].includes(source)) {
    throw captureRefusal();
  }
  const elements = extractElementsFromHierarchy(hierarchy);
  if (elements.length === 0) {
    throw captureRefusal();
  }
  const capturedAt = new Date().toISOString();
  const captured = {
    version: 1,
    source,
    deviceName: exactText(deviceName, 200),
    ...(appName !== undefined ? { appName: exactText(appName, 200) } : {}),
    capturedAt,
    screens: [
      {
        id: `screen-${capturedAt.replace(/[^0-9]/g, "")}`,
        label: exactText(label === undefined ? "Current screen" : label, 200),
        elements,
      },
    ],
  };
  completeCaptureJsonBytes(captured);
  return captured;
}

function captureAndroid(options) {
  return captureAndroidWindow(options, {
    listDevices: listAndroidDevices,
    adb: (serial, args) => run("adb", ["-s", serial, ...args]),
    dumpPath: () => `/sdcard/vaettir-window-${randomBytes(16).toString("hex")}.xml`,
  });
}

function appiumOptions(url) {
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Appium URL must use http or https.");
  }
  const username =
    process.env.APPIUM_USERNAME || decodeURIComponent(parsed.username);
  const accessKey =
    process.env.APPIUM_ACCESS_KEY || decodeURIComponent(parsed.password);
  parsed.username = "";
  parsed.password = "";
  const headers = { "content-type": "application/json" };
  if (username && accessKey) {
    headers.authorization = `Basic ${Buffer.from(`${username}:${accessKey}`).toString("base64")}`;
  }
  return { baseUrl: parsed.toString().replace(/\/$/, ""), headers };
}

async function appiumJson(baseUrl, path, headers) {
  const response = await fetch(`${baseUrl}${path}`, { headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.value?.error) {
    throw new Error(
      payload.value?.message || `Appium returned HTTP ${response.status}`,
    );
  }
  return payload;
}

async function captureIos(options) {
  if (!options.appiumUrl || !options.sessionId) {
    throw new Error("Enter the Appium URL and active session ID.");
  }
  const { baseUrl, headers } = appiumOptions(options.appiumUrl);
  const sessionId = encodeURIComponent(options.sessionId);
  const source = await appiumJson(
    baseUrl,
    `/session/${sessionId}/source`,
    headers,
  );
  const details = await appiumJson(
    baseUrl,
    `/session/${sessionId}`,
    headers,
  ).catch(() => ({}));
  const capabilities = details.value?.capabilities || details.value || {};
  return buildCaptureManifest({
    source: options.source === "ios-remote" ? "IOS_REMOTE" : "IOS_CONNECTED",
    deviceName:
      options.deviceName ||
      capabilities.deviceName ||
      capabilities["appium:deviceName"] ||
      "iOS device",
    appName:
      options.appName ||
      capabilities.bundleId ||
      capabilities["appium:bundleId"],
    label: options.label || "Current iOS screen",
    hierarchy: source.value,
  });
}

function safeEqual(left, right) {
  const leftBytes = Buffer.from(String(left || ""));
  const rightBytes = Buffer.from(String(right || ""));
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

function corsHeaders(origin, request) {
  if (!origin || !allowedOrigins.has(origin)) return null;
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, x-vaettir-pairing-code",
    "access-control-allow-private-network":
      request.headers["access-control-request-private-network"] === "true"
        ? "true"
        : "false",
    vary: "Origin, Access-Control-Request-Private-Network",
  };
}

function send(response, status, body, headers = {}) {
  response.writeHead(status, {
    "content-type": "application/json",
    ...headers,
  });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 32_768) throw new Error("Request is too large.");
  }
  return JSON.parse(raw || "{}");
}

const ANDROID_WINDOW_PATH = "/capture/android-window-v1";
const ANDROID_WINDOW_REQUEST_BYTES = 4096;
const ANDROID_WINDOW_RESPONSE_BYTES = 2 * 1024 * 1024;
const ANDROID_WINDOW_OBSERVATION = "BEFORE_AFTER_WINDOW_OBSERVATIONS_NOT_ATOMIC";

// Reject duplicate decoded property names BEFORE JSON.parse can overwrite
// them. Whole JSON grammar, depth and node admission precede private values.
function parseAndroidWindowJson(text, maximumBytes) {
  if (typeof text !== "string" || text.length > maximumBytes || Buffer.byteLength(text, "utf8") > maximumBytes) throw captureRefusal();
  let offset = 0, nodes = 0;
  const whitespace = () => { while (/[ \t\r\n]/.test(text[offset] ?? "!") && offset < text.length) offset++; };
  const string = () => {
    const start = offset;
    if (text[offset++] !== '"') throw captureRefusal();
    while (offset < text.length) {
      const character = text[offset++];
      if (character === '"') { const value = JSON.parse(text.slice(start, offset)); exactText(value, maximumBytes, 0); return value; }
      if (character.charCodeAt(0) < 32) throw captureRefusal();
      if (character === "\\") {
        const escaped = text[offset++];
        if (escaped === "u") { if (!/^[0-9a-fA-F]{4}$/.test(text.slice(offset, offset + 4))) throw captureRefusal(); offset += 4; }
        else if (!escaped || !'"\\/bfnrt'.includes(escaped)) throw captureRefusal();
      }
    }
    throw captureRefusal();
  };
  const value = depth => {
    if (++nodes > 100000 || depth > 64) throw captureRefusal();
    whitespace(); const character = text[offset];
    if (character === '"') { string(); return; }
    if (character === "{" || character === "[") {
      const object = character === "{", close = object ? "}" : "]", names = new Set(); let count = 0;
      offset++; whitespace(); if (text[offset] === close) { offset++; return; }
      while (offset < text.length) {
        if (++count > (object ? 10000 : 1000)) throw captureRefusal();
        if (object) { whitespace(); const name = string(); if (names.has(name)) throw captureRefusal(); names.add(name); whitespace(); if (text[offset++] !== ":") throw captureRefusal(); }
        value(depth + 1); whitespace(); if (text[offset] === close) { offset++; return; }
        if (text[offset++] !== ",") throw captureRefusal();
      }
      throw captureRefusal();
    }
    const match = /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(text.slice(offset));
    if (!match) throw captureRefusal(); offset += match[0].length;
  };
  value(0); whitespace(); if (offset !== text.length) throw captureRefusal();
  return JSON.parse(text);
}

function admitAndroidWindowRequest(raw) {
  completeCaptureJsonBytes(raw);
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.getPrototypeOf(raw) !== Object.prototype) throw captureRefusal();
  const fields = ["protocolVersion", "requestNonce", "serial", "expectedPackage", "label"], descriptors = Object.getOwnPropertyDescriptors(raw), keys = Reflect.ownKeys(descriptors);
  if (keys.length !== fields.length || keys.some(key => typeof key !== "string" || !fields.includes(key))) throw captureRefusal();
  if (descriptors.protocolVersion?.value !== 1 || typeof descriptors.requestNonce?.value !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(descriptors.requestNonce.value)) throw captureRefusal();
  const target = admitAndroidCaptureOptions({ source: "android", serial: descriptors.serial?.value, expectedPackage: descriptors.expectedPackage?.value, label: descriptors.label?.value });
  const request = Object.freeze({ protocolVersion: 1, requestNonce: descriptors.requestNonce.value, serial: target.serial, expectedPackage: target.expectedPackage, label: target.label });
  if (completeCaptureJsonBytes(request) > ANDROID_WINDOW_REQUEST_BYTES) throw captureRefusal();
  return request;
}

async function readAndroidWindowRequest(request) {
  const iterator = request[Symbol.asyncIterator]();
  let timer, failed = true;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(captureRefusal()), 10000); });
  void timeout.catch(() => undefined);
  try {
    const buffer = Buffer.alloc(ANDROID_WINDOW_REQUEST_BYTES); let size = 0;
    for (let reads = 0; reads < 8192; reads++) {
      const part = await Promise.race([iterator.next(), timeout]);
      if (part.done) {
        const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer.subarray(0, size));
        const output = admitAndroidWindowRequest(parseAndroidWindowJson(text, ANDROID_WINDOW_REQUEST_BYTES)); failed = false; return output;
      }
      if (!(part.value instanceof Uint8Array) || part.value.byteLength + size > ANDROID_WINDOW_REQUEST_BYTES) throw captureRefusal();
      buffer.set(part.value, size); size += part.value.byteLength;
    }
    throw captureRefusal();
  } finally {
    clearTimeout(timer);
    if (failed && typeof iterator.return === "function") { try { void Promise.resolve(iterator.return()).catch(() => undefined); } catch { /* No private error publication. */ } }
  }
}

function buildAndroidWindowResponse(request, capture) {
  const intent = admitAndroidWindowRequest(request);
  completeCaptureJsonBytes(capture);
  const origin = androidCaptureOrigins.get(capture);
  if (!origin || origin.serial !== intent.serial || origin.expectedPackage !== intent.expectedPackage || origin.signature !== JSON.stringify(capture) || capture.source !== "ANDROID_ADB" || capture.appName !== intent.expectedPackage || capture.screens.length !== 1 || capture.screens[0].label !== intent.label) throw captureRefusal();
  // These fields describe the collector's supported before/after observations,
  // never an atomic app-exclusive read, permission or recoverable receipt.
  const output = { ...intent, observation: { kind: ANDROID_WINDOW_OBSERVATION,
    beforePackage: origin.expectedPackage, afterPackage: origin.expectedPackage, appExclusive: false },
    capture, processingPermissionGranted: false, spendingPermissionGranted: false, operationReceiptAvailable: false };
  if (completeCaptureJsonBytes(output) > ANDROID_WINDOW_RESPONSE_BYTES) throw captureRefusal();
  return output;
}

async function handleAndroidWindowCapture(request, response, cors) {
  try {
    const intent = await readAndroidWindowRequest(request);
    const capture = captureAndroid({ source: "android", serial: intent.serial, expectedPackage: intent.expectedPackage, label: intent.label });
    return send(response, 200, buildAndroidWindowResponse(intent, capture), cors);
  } catch {
    return send(response, 400, { error: "No complete supported Android window response was admitted. No fallback or automatic retry was performed." }, cors);
  }
}

// BEGIN EMBEDDED ANDROID EXPLORER
// Embedded verbatim in the single-file connector; no imports or process startup.
// One explicit HTTP step performs at most one native navigation action. There is
// no background device loop to survive a closed page or transport interruption.
function createAndroidExplorer(native, { hash, nonce, now }) {
  const tickets = new Map(),
    sessions = new Map();
  const deny = () => {
    throw Error(
      "Exploration request is unavailable or outside its original scope.",
    );
  };
  const plain = (value, keys) => {
    if (!value || Object.getPrototypeOf(value) !== Object.prototype) deny();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (
      Reflect.ownKeys(descriptors).length !== keys.length ||
      keys.some(
        (k) =>
          !descriptors[k]?.enumerable ||
          !Object.hasOwn(descriptors[k], "value"),
      )
    )
      deny();
  };
  const text = (value, max = 200) => {
    if (
      typeof value !== "string" ||
      !value.length ||
      value.length > max ||
      Array.from(value).some(
        (c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127,
      )
    )
      deny();
    return value;
  };
  const scopeKey = (value) => {
    plain(value, ["projectId", "organizationId", "actorId", "sessionId"]);
    return JSON.stringify([
      text(value.projectId),
      text(value.organizationId),
      text(value.actorId),
      text(value.sessionId),
    ]);
  };
  const unsafe =
    /\b(?:sign[ -]?in|log[ -]?in|sign[ -]?out|log[ -]?out|password|pay|buy|purchase|order|checkout|subscribe|delete|remove|erase|send|submit|save|confirm|accept|agree|install|uninstall|grant|allow|deny|enable|disable|reset|transfer|upload|download)\b/i;
  const checkOrigin = (origin) => text(origin, 512);
  const snapshot = (session) =>
    JSON.parse(
      JSON.stringify({
        version: 1,
        id: session.id,
        packageName: session.packageName,
        scope: session.scope,
        status: session.status,
        reason: session.reason,
        startedAt: session.startedAt,
        expiresAt: session.expiresAt,
        sequence: session.sequence,
        actionCount: session.actionCount,
        limits: session.limits,
        screens: session.screens,
        journeys: session.journeys,
        skippedControls: session.skippedControls,
        lastOperation: session.lastOperation,
        observation: "BEFORE_AFTER_NOT_ATOMIC",
        aiProcessingPerformed: false,
        backgroundNavigation: false,
      }),
    );
  const get = (input, origin, keys = []) => {
    plain(input, ["id", "scope", ...keys]);
    const session = sessions.get(text(input.id, 64));
    if (
      !session ||
      session.origin !== checkOrigin(origin) ||
      session.scopeKey !== scopeKey(input.scope)
    )
      deny();
    if (
      now() >= session.expiresAt &&
      !["STOPPED", "COMPLETED"].includes(session.status)
    ) {
      session.status = "STOPPED";
      session.reason = "TIME_LIMIT";
    }
    return session;
  };
  const remember = (session, observed) => {
    // Native adapter validates the complete hierarchy, current package, bounds
    // and count before returning. Never clip controls or silently sanitize text.
    if (observed.blocked) {
      session.status = "STOPPED";
      session.reason = "FORM_AUTH_OR_EMBEDDED_CONTENT";
      return false;
    }
    const existing = session.screens.find((s) => s.id === observed.id);
    if (!existing && session.screens.length >= session.limits.screens) {
      session.status = "COMPLETED";
      session.reason = "SCREEN_LIMIT";
      return false;
    }
    if (!existing)
      session.screens.push({
        id: observed.id,
        label: observed.label,
        controls: observed.controls.map((c) => ({
          id: c.id,
          name: c.name,
          role: c.role,
          navigable: c.navigable,
        })),
      });
    session.current = observed;
    return true;
  };
  return {
    handle(command, input, origin) {
      checkOrigin(origin);
      if (command === "inspect") {
        plain(input, ["serial", "scope"]);
        const scope = scopeKey(input.scope);
        const serial = text(input.serial);
        if (!/^[A-Za-z0-9._:-]+$/.test(serial) || tickets.size >= 20) deny();
        const packageName = native.inspect(serial); // package identity only, no hierarchy
        const ticket = nonce();
        tickets.set(ticket, {
          serial,
          packageName,
          scope,
          origin,
          expiresAt: now() + 120000,
        });
        return { version: 1, ticket, packageName, expiresAt: now() + 120000 };
      }
      if (command === "start") {
        plain(input, [
          "ticket",
          "scope",
          "consent",
          "navigationNames",
          "limits",
        ]);
        plain(input.consent, ["localObservation", "navigation", "testAccount"]);
        plain(input.limits, ["actions", "screens", "seconds"]);
        if (Object.values(input.consent).some((v) => v !== true)) deny();
        const ticket = tickets.get(text(input.ticket, 64)),
          scope = scopeKey(input.scope);
        if (
          !ticket ||
          ticket.origin !== origin ||
          ticket.scope !== scope ||
          ticket.expiresAt <= now() ||
          sessions.size >= 5
        )
          deny();
        if (
          [...sessions.values()].some(
            (s) =>
              s.serial === ticket.serial &&
              !["STOPPED", "COMPLETED"].includes(s.status) &&
              s.expiresAt > now(),
          )
        )
          deny();
        if (
          !Array.isArray(input.navigationNames) ||
          input.navigationNames.length < 1 ||
          input.navigationNames.length > 25
        )
          deny();
        const names = input.navigationNames.map((n) => text(n, 80));
        if (
          new Set(names).size !== names.length ||
          names.some((n) => unsafe.test(n))
        )
          deny();
        for (const [key, max] of [
          ["actions", 24],
          ["screens", 12],
          ["seconds", 300],
        ])
          if (
            !Number.isSafeInteger(input.limits[key]) ||
            input.limits[key] < 1 ||
            input.limits[key] > max
          )
            deny();
        // Single-use admission consumed before native observation, including failure.
        tickets.delete(input.ticket);
        if (native.inspect(ticket.serial) !== ticket.packageName) deny();
        const session = {
          id: input.ticket,
          serial: ticket.serial,
          packageName: ticket.packageName,
          scope: input.scope,
          scopeKey: scope,
          origin,
          status: "ACTIVE",
          reason: null,
          startedAt: new Date(now()).toISOString(),
          expiresAt: now() + input.limits.seconds * 1000,
          sequence: 0,
          actionCount: 0,
          limits: input.limits,
          names: new Set(names),
          screens: [],
          journeys: [],
          skippedControls: 0,
          visited: new Set(),
          scrolled: new Set(),
          path: [],
          stack: [],
          current: null,
          lastOperation: null,
        };
        sessions.set(session.id, session);
        try {
          remember(
            session,
            native.observe(session.serial, session.packageName),
          );
        } catch {
          session.status = "STOPPED";
          session.reason = "TARGET_OR_OBSERVATION_UNAVAILABLE";
        }
        return snapshot(session);
      }
      const session = get(
        input,
        origin,
        command === "next" ? ["sequence", "requestId"] : [],
      );
      if (command === "read") return snapshot(session);
      if (command === "stop") {
        session.status = "STOPPED";
        session.reason = "STOPPED_BY_USER";
        return snapshot(session);
      }
      if (command === "pause") {
        if (session.status === "ACTIVE") {
          session.status = "PAUSED";
          session.reason = "PAUSED_BY_USER";
        }
        return snapshot(session);
      }
      if (command === "resume") {
        if (session.status !== "PAUSED") deny();
        session.status = "ACTIVE";
        session.reason = null;
        return snapshot(session);
      }
      if (
        command !== "next" ||
        session.status !== "ACTIVE" ||
        input.sequence !== session.sequence ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
          text(input.requestId, 36),
        )
      )
        deny();
      if (session.sequence >= session.limits.actions) {
        session.status = "COMPLETED";
        session.reason = "ACTION_LIMIT";
        return snapshot(session);
      }
      // Consume sequence BEFORE observing/acting. A lost reply cannot repeat it.
      session.sequence++;
      session.lastOperation = {
        requestId: input.requestId,
        sequence: session.sequence,
        actionAttempted: false,
        outcome: "UNVERIFIED",
      };
      try {
        const before = native.observe(session.serial, session.packageName);
        if (before.blocked || before.id !== session.current?.id) {
          session.status = "STOPPED";
          session.reason = "SCREEN_CHANGED_REVIEW_REQUIRED";
          return snapshot(session);
        }
        const candidates = before.controls.filter(
          (c) =>
            c.navigable &&
            session.names.has(c.name) &&
            !unsafe.test(c.name) &&
            before.controls.filter(
              (other) => other.name === c.name && other.navigable,
            ).length === 1,
        );
        session.skippedControls = before.controls.filter(
          (c) => c.navigable && !candidates.includes(c),
        ).length;
        const target = candidates.find(
          (c) => !session.visited.has(before.id + ":" + c.id),
        );
        let action;
        if (target) {
          session.visited.add(before.id + ":" + target.id);
          action = { kind: "TAP", label: target.name, targetId: target.id };
        } else if (before.scroll && !session.scrolled.has(before.id)) {
          session.scrolled.add(before.id);
          action = {
            kind: "SCROLL",
            label: "Scroll down",
            targetId: before.scroll.id,
          };
        } else if (session.stack.length)
          action = { kind: "BACK", label: "Back", targetId: "android-back" };
        else {
          session.status = "COMPLETED";
          session.reason = "APPROVED_NAVIGATION_EXHAUSTED";
          session.lastOperation.outcome = "NO_ACTION";
          return snapshot(session);
        }
        if (
          now() >= session.expiresAt ||
          native.inspect(session.serial) !== session.packageName
        )
          throw Error();
        const observedTarget =
          action.kind === "TAP"
            ? target.target
            : action.kind === "SCROLL"
              ? before.scroll.target
              : null;
        if (
          action.kind !== "BACK" &&
          (!observedTarget ||
            observedTarget.packageName !== session.packageName)
        )
          throw Error();
        const b =
          action.kind === "TAP"
            ? target.bounds
            : action.kind === "SCROLL"
              ? before.scroll.bounds
              : null;
        if (
          b &&
          (JSON.stringify(observedTarget.bounds) !== JSON.stringify(b) ||
            b.length !== 4 ||
            b.some((v) => !Number.isInteger(v) || v < 0 || v > 20000) ||
            b[2] <= b[0] ||
            b[3] <= b[1])
        )
          throw Error();
        const x = b ? String(Math.floor((b[0] + b[2]) / 2)) : null;
        const expectedArgs =
          action.kind === "TAP"
            ? [
                "shell",
                "input",
                "tap",
                x,
                String(Math.floor((b[1] + b[3]) / 2)),
              ]
            : action.kind === "SCROLL"
              ? [
                  "shell",
                  "input",
                  "swipe",
                  x,
                  String(Math.floor(b[1] + (b[3] - b[1]) * 0.8)),
                  x,
                  String(Math.floor(b[1] + (b[3] - b[1]) * 0.3)),
                  "300",
                ]
              : ["shell", "input", "keyevent", "4"];
        session.lastOperation.actionAttempted = true;
        session.actionCount++;
        let commandArgs;
        if (action.kind === "TAP")
          commandArgs = native.tap(session.serial, target.bounds);
        else if (action.kind === "SCROLL")
          commandArgs = native.scroll(session.serial, before.scroll.bounds);
        else commandArgs = native.back(session.serial);
        if (JSON.stringify(commandArgs) !== JSON.stringify(expectedArgs))
          throw Error();
        const after = native.observe(session.serial, session.packageName);
        session.lastOperation.outcome = "OBSERVED";
        if (!remember(session, after) || after.blocked)
          return snapshot(session);
        const step = {
          sequence: session.sequence,
          action,
          from: { id: before.id, label: before.label },
          to: { id: after.id, label: after.label },
          observedAt: new Date(now()).toISOString(),
          execution: {
            transport: "ADB",
            connector: {
              method: "POST",
              path: "/exploration/v1/next",
              requestId: input.requestId,
            },
            commandArgs,
            target: observedTarget,
            appNetwork: {
              status: "NOT_CAPTURED",
              reason: "APP_NETWORK_INSPECTION_NOT_CONNECTED",
            },
          },
        };
        if (action.kind === "BACK") {
          const prior = session.stack.pop();
          session.path = prior.path;
          if (after.id !== prior.screenId) {
            session.status = "STOPPED";
            session.reason = "UNEXPECTED_BACK_DESTINATION";
          }
        } else if (after.id !== before.id) {
          if (session.path.some((p) => p.from.id === after.id)) {
            session.status = "STOPPED";
            session.reason = "NAVIGATION_CYCLE";
          } else {
            if (action.kind === "TAP")
              session.stack.push({
                screenId: before.id,
                path: [...session.path],
              });
            session.path.push(step);
            if (action.kind === "TAP")
              session.journeys.push({
                id: hash(JSON.stringify(session.path)),
                sessionId: session.id,
                packageName: session.packageName,
                startedAt: session.startedAt,
                steps: [...session.path],
              });
          }
        }
      } catch {
        session.status = "STOPPED";
        session.reason = session.lastOperation.actionAttempted
          ? "ACTION_OUTCOME_UNCERTAIN_NO_RETRY"
          : "TARGET_OR_OBSERVATION_UNAVAILABLE";
      }
      return snapshot(session);
    },
  };
}

// END EMBEDDED ANDROID EXPLORER

function inspectAndroidExplorerTarget(serial) {
  if (listAndroidDevices().filter(device => device.id === serial && device.ready).length !== 1) throw captureRefusal();
  const focus = run("adb", ["-s", serial, "shell", "dumpsys", "window", "displays"]);
  const matches = [...focus.matchAll(/\bmCurrentFocus=\s*Window\{[a-fA-F0-9]+\s+u\d+\s+([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+)\/[A-Za-z0-9_.$]+\}/g)];
  if (matches.length !== 1) throw captureRefusal();
  requireAndroidForeground(focus, matches[0][1]);
  return matches[0][1];
}
function androidExplorerBounds(value) {
  const match = /^\[(\d{1,5}),(\d{1,5})\]\[(\d{1,5}),(\d{1,5})\]$/.exec(value ?? "");
  if (!match) throw captureRefusal();
  const bounds = match.slice(1).map(Number);
  if (bounds.some(n => n > 20000) || bounds[2] <= bounds[0] || bounds[3] <= bounds[1]) throw captureRefusal();
  return bounds;
}
function androidExplorerVisibleNodes(hierarchy) {
  // Validate the entire document before pruning display-only input subtrees.
  // Never turn a partial parse or a hidden foreign package into admitted source.
  hierarchyTags(hierarchy);
  const tokens = /<\?xml[^?]*\?>|<\/?[A-Za-z_][A-Za-z0-9_.:-]*(?:\s+[A-Za-z_][A-Za-z0-9_.:-]*\s*=\s*"[^"]*")*\s*\/?>/g;
  const stack = [], result = [];
  for (const match of hierarchy.matchAll(tokens)) {
    const token = match[0];
    if (token.startsWith("<?")) continue;
    if (token.startsWith("</")) { stack.pop(); continue; }
    const a = attributesOf(token), parent = stack.at(-1);
    const hidden = !!parent?.hidden || a.visible === "false" || a.displayed === "false";
    const withinField = !!parent?.withinField;
    const isField = nativeRole(a,"node") === "textbox";
    if (!hidden && token.startsWith("<node")) result.push({a, withinField, isField});
    if (!token.endsWith("/>")) stack.push({hidden, withinField:withinField || isField});
  }
  return result;
}
function androidExplorerFieldBoundary(nodes) {
  const risk = /\b(?:password|passcode|otp|mfa|2fa|auth|authentication|username|email|verification|payment|checkout|billing|cvv|cvc|iban)\b|sign\s*in|log\s*in|one\s*time|card\s*number|credit\s*card/i;
  const authPaymentHeading = /^(?:sign[ -]?in|log[ -]?in|authentication|verify (?:your )?identity|enter (?:verification )?code|verify code|checkout|payment(?: details)?|billing details)$/i;
  const normalize = value => value.replace(/([a-z])([A-Z])/g,"$1 $2").replace(/[_:./-]+/g," ");
  const fields = [];
  for (const {a,withinField,isField} of nodes) {
    if (a.password === "true" || /WebView/.test(a.class ?? "")) return {blocked:true,fields:[]};
    // An ordinary query value is never evidence that a field is safe. Only
    // stable accessibility/identifier metadata may admit search/filter inputs.
    if (isField) {
      const metadata = normalize([a["content-desc"]??"",a.hint??"",a["resource-id"]?.split("/").at(-1)??"",a.class??""].join(" "));
      if (a.focused === "true" || risk.test(metadata) || !/\b(?:search|filter)\b/i.test(metadata)) return {blocked:true,fields:[]};
      fields.push(androidExplorerBounds(a.bounds));
    } else if (!withinField && a.clickable !== "true" && authPaymentHeading.test((a.text || a["content-desc"] || "").trim())) return {blocked:true,fields:[]};
  }
  return {blocked:false,fields};
}
function androidExplorerObjectTarget(a,bounds,nodes,packageName) {
  const objectId=a["resource-id"]?exactText(a["resource-id"],200):null;
  const className=a.class?exactText(a.class,200):null;
  const unique=(key,value)=>nodes.filter(node=>node.a[key]===value).length===1;
  let selector={kind:"BOUNDS_ONLY",value:null};
  if(objectId&&unique("resource-id",objectId))selector={kind:"RESOURCE_ID",value:objectId};
  else if(a["content-desc"]&&unique("content-desc",a["content-desc"]))selector={kind:"ACCESSIBILITY_ID",value:exactText(a["content-desc"],200)};
  else if(a.text&&className&&nodes.filter(node=>node.a.text===a.text&&node.a.class===className).length===1)selector={kind:"TEXT_CLASS",value:exactText(a.text,200)};
  return {packageName,objectId,className,selector,bounds};
}
function observeAndroidExplorerWindow(serial, expectedPackage) {
  let hierarchy;
  captureAndroidWindow({source:"android", serial, expectedPackage, label:"Exploration observation"}, {
    listDevices: listAndroidDevices,
    dumpPath: () => `/sdcard/vaettir-window-${randomBytes(16).toString("hex")}.xml`,
    // This adapter uses the display's mCurrentFocus field on current Android.
    // The collector still admits exactly one before/after observed package;
    // there is no fallback to labels, activities or an unverified hierarchy.
    adb: (device, args) => { const actual=args.join(" ")==="shell dumpsys window windows"?["shell","dumpsys","window","displays"]:args;const output = run("adb", ["-s", device, ...actual]); if (args[0] === "exec-out" && args[1] === "cat") hierarchy = output; return output; },
  });
  const hash = value => createHash("sha256").update(value).digest("hex");
  const nodes = androidExplorerVisibleNodes(hierarchy), boundary = androidExplorerFieldBoundary(nodes);
  // Detect a manual-interaction boundary before retaining any field values,
  // labels, native attributes or content-derived digests from that screen.
  if (boundary.blocked)
    return {id:hash("manual-interaction:"+expectedPackage), label:"Manual interaction required", controls:[], blocked:true, scroll:null};
  const controls = [], semantics = []; let label = expectedPackage, blocked = false, scroll = null;
  for (const {a,withinField,isField} of nodes) {
    // Omit input values, labels, attributes and descendants even from digests.
    // A constant geometry marker preserves the excluded field's position.
    if (isField) { semantics.push(["ordinary-search-filter-field",androidExplorerBounds(a.bounds)]); continue; }
    if (withinField) continue;
    const role = nativeRole(a, "node"), name = a.text || a["content-desc"] || a["resource-id"] || "";
    // A decorative animation can move or repaint without changing navigation.
    // Ignore only its geometry/paint bookkeeping, never its content or identity.
    // Keep every attribute on interactive (even disabled/unnamed) objects, and
    // keep ordinary-field geometry above. Moving targets/scroll areas still stop.
    const interactive = ["clickable", "long-clickable", "scrollable", "checkable", "focusable"].some(key => a[key] === "true");
    const attributes = Object.keys(a).sort().map(key=>[key,a[key]]);
    semantics.push(attributes.filter(([key]) => interactive || !["bounds", "index", "drawing-order"].includes(key)));
    if (a.scrollable === "true" && a.enabled !== "false" && !scroll) {
      const b=androidExplorerBounds(a.bounds),x=Math.floor((b[0]+b[2])/2),y1=Math.floor(b[1]+(b[3]-b[1])*0.3),y2=Math.floor(b[1]+(b[3]-b[1])*0.8);
      if (!boundary.fields.some(f=>x>=f[0]&&x<f[2]&&y2>=f[1]&&y1<f[3])) scroll = {id:hash(JSON.stringify(semantics.at(-1))),bounds:b,target:androidExplorerObjectTarget(a,b,nodes,expectedPackage)};
    }
    if (!name) continue;
    exactText(name, 200);
    if (label === expectedPackage && role === "text" && a.clickable !== "true") label = name;
    if (controls.length >= 150) throw captureRefusal();
    // Object evidence keeps the full observed attributes; two otherwise equal
    // passive objects at different positions must not collapse to one id.
    const id = hash(JSON.stringify(attributes));
    let navigable = a.enabled !== "false" && a.clickable === "true" && a.checkable !== "true" &&
      ["button", "text", "tab", "link"].includes(role) && !!(a.text || a["content-desc"]);
    const bounds = navigable || a.scrollable === "true" ? androidExplorerBounds(a.bounds) : null;
    if (navigable) { const x=Math.floor((bounds[0]+bounds[2])/2),y=Math.floor((bounds[1]+bounds[3])/2); if(boundary.fields.some(f=>x>=f[0]&&x<f[2]&&y>=f[1]&&y<f[3])) navigable=false; }
    controls.push({id, name, role, navigable, bounds,target:navigable?androidExplorerObjectTarget(a,bounds,nodes,expectedPackage):null});
  }
  if (!controls.length) throw captureRefusal();
  return {id:hash(JSON.stringify(semantics)), label, controls, blocked, scroll};
}
function performAndroidExplorerCommand(serial,args) { run("adb",["-s",serial,...args]); return args; }
const androidExplorer = createAndroidExplorer({
  inspect: inspectAndroidExplorerTarget,
  observe: observeAndroidExplorerWindow,
  tap: (serial, b) => performAndroidExplorerCommand(serial,["shell", "input", "tap", String(Math.floor((b[0]+b[2])/2)), String(Math.floor((b[1]+b[3])/2))]),
  back: serial => performAndroidExplorerCommand(serial,["shell", "input", "keyevent", "4"]),
  scroll: (serial, b) => { const x=String(Math.floor((b[0]+b[2])/2)), height=b[3]-b[1]; return performAndroidExplorerCommand(serial,["shell", "input", "swipe", x, String(Math.floor(b[1]+height*0.8)), x, String(Math.floor(b[1]+height*0.3)), "300"]); },
}, {hash: value => createHash("sha256").update(value).digest("hex"), nonce: () => randomBytes(24).toString("hex"), now: Date.now});
async function handleAndroidExploration(request, response, cors, origin, command) {
  let timer, iterator;
  try {
    const chunks = []; let size = 0, done = false;
    iterator = request[Symbol.asyncIterator]();
    const timeout = new Promise((_, reject) => {timer=setTimeout(()=>reject(captureRefusal()),10000);});
    void timeout.catch(()=>undefined);
    for(let reads=0;reads<8192;reads++) {
      const part=await Promise.race([iterator.next(),timeout]);
      if(part.done){done=true;break;}
      if(!(part.value instanceof Uint8Array))throw captureRefusal();
      size+=part.value.length;if(size>8192)throw captureRefusal();chunks.push(part.value);
    }
    if(!done)throw captureRefusal();
    const raw = new TextDecoder("utf-8", {fatal:true}).decode(Buffer.concat(chunks));
    return send(response, 200, androidExplorer.handle(command, parseAndroidWindowJson(raw, 8192), origin), {...cors,"cache-control":"no-store"});
  } catch { return send(response, 400, {error:"Exploration could not continue in its original scope. No automatic action retry was performed."}, {...cors,"cache-control":"no-store"}); }
  finally {clearTimeout(timer);if(iterator?.return){try{void Promise.resolve(iterator.return()).catch(()=>undefined);}catch{/* No private diagnostic body. */}}}
}

const args = parseArguments(process.argv.slice(2));
// A downloaded launcher binds this process to its one customer origin.
// Preserve legacy/manual development startup when no origin was supplied;
// never admit every tenant or reflect an arbitrary browser Origin header.
if (Object.hasOwn(args, "origin")) {
  const origin = validatedConnectorOrigin(args.origin);
  allowedOrigins.clear();
  allowedOrigins.add(origin);
}
const port = Number(args.port || 4774);
const pairingCode =
  args["pairing-code"] || randomBytes(4).toString("hex").toUpperCase();

if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error("--port must be between 1024 and 65535.");
}

const server = createServer(async (request, response) => {
  const origin = request.headers.origin;
  const cors = corsHeaders(origin, request);
  if (!cors) return send(response, 403, { error: "Origin is not allowed." });
  if (request.method === "OPTIONS") {
    response.writeHead(204, cors);
    return response.end();
  }
  if (!safeEqual(request.headers["x-vaettir-pairing-code"], pairingCode)) {
    return send(response, 401, { error: "Pairing code is incorrect." }, cors);
  }
  if (request.method === "GET" && request.url === "/health") {
    return send(response, 200, { connected: true, version: 2 }, cors);
  }
  if (request.method === "GET" && request.url === "/exploration/v1/capabilities") {
    return send(response, 200, {version:1, platform:"ANDROID", localNavigation:true, aiProcessing:false, maxActions:24, maxScreens:12, maxSeconds:300}, {...cors,"cache-control":"no-store"});
  }
  const explorationCommand = /^\/exploration\/v1\/(inspect|start|next|pause|resume|stop|read)$/.exec(request.url ?? "")?.[1];
  if (request.method === "POST" && explorationCommand) return handleAndroidExploration(request, response, cors, origin, explorationCommand);
  if (request.method === "GET" && request.url === "/devices?source=android") {
    try {
      return send(response, 200, { devices: listAndroidDevices() }, cors);
    } catch (error) {
      return send(
        response,
        400,
        {
          error:
            error instanceof Error
              ? error.message
              : "Android device discovery failed.",
        },
        cors,
      );
    }
  }
  if (request.method === "POST" && request.url === ANDROID_WINDOW_PATH) {
    return handleAndroidWindowCapture(request, response, cors);
  }
  if (request.method === "POST" && request.url === "/capture") {
    try {
      const options = await readJson(request);
      if (
        !["android", "ios-connected", "ios-remote"].includes(options.source)
      ) {
        throw new Error("Unsupported capture source.");
      }
      const capture =
        options.source === "android"
          ? captureAndroid(options)
          : await captureIos(options);
      return send(response, 200, { capture }, cors);
    } catch (error) {
      return send(
        response,
        400,
        { error: error instanceof Error ? error.message : "Capture failed." },
        cors,
      );
    }
  }
  return send(response, 404, { error: "Not found." }, cors);
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write("\nVaettir Device Connector\n");
  process.stdout.write(
    `Listening only on this computer: http://127.0.0.1:${port}\n`,
  );
  process.stdout.write(`Pairing code: ${pairingCode}\n\n`);
  process.stdout.write(
    "Keep this window open while capturing screens in Vaettir.\n",
  );
  process.stdout.write("Press Ctrl+C when you are finished.\n");
});
