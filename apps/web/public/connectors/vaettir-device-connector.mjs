#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

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

function run(command, args) {
  try {
    return execFileSync(command, args, {
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

const args = parseArguments(process.argv.slice(2));
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
