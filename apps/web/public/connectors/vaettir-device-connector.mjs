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
    }).trim();
  } catch (error) {
    const detail = error?.stderr?.toString().trim() || error.message;
    throw new Error(`${command} failed: ${detail}`, { cause: error });
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

function decodeXml(value) {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function attributesOf(tag) {
  const attributes = {};
  for (const match of tag.matchAll(/([\w:-]+)="([^"]*)"/g)) {
    attributes[match[1]] = decodeXml(match[2]).trim();
  }
  return attributes;
}

function extractElements(xml, maximum = 150) {
  const elements = [];
  const seen = new Set();
  const tags = xml.match(/<(?:node|XCUIElementType[\w]+)\b[^>]*>/g) ?? [];
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
    ].find((value) => value && value !== "true" && value !== "false");
    if (!name) continue;
    const type = [attributes.class, attributes.type, tag]
      .filter(Boolean)
      .join(" ");
    const role =
      ROLE_BY_NATIVE_TYPE.find(([pattern]) => pattern.test(type))?.[1] ??
      (attributes.clickable === "true" ? "button" : "element");
    const normalizedName = name.slice(0, 200);
    const androidId = attributes["resource-id"];
    const iosId = tag.startsWith("<XCUIElementType")
      ? attributes.name
      : undefined;
    const stableId = (androidId || iosId || "").slice(0, 200) || undefined;
    const selector = androidId
      ? `resource-id=${androidId}`
      : iosId
        ? `accessibility-id=${iosId}`
        : undefined;
    const event =
      role === "textbox"
        ? "fill"
        : ["checkbox", "radio", "switch"].includes(role)
          ? "check"
          : role === "combobox"
            ? "select"
            : role === "link"
              ? "navigate"
              : "click";
    const key = `${role}\u0000${normalizedName}\u0000${stableId ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    elements.push({
      role,
      name: normalizedName,
      ...(stableId ? { stableId } : {}),
      ...(selector ? { selector } : {}),
      event,
    });
    if (elements.length >= maximum) break;
  }
  return elements;
}

function manifest({ source, deviceName, appName, label, hierarchy }) {
  const elements = extractElements(hierarchy);
  if (elements.length === 0) {
    throw new Error(
      "The current screen has no named accessibility elements to capture.",
    );
  }
  const capturedAt = new Date().toISOString();
  return {
    version: 1,
    source,
    deviceName: String(deviceName || "Unknown device").slice(0, 200),
    ...(appName ? { appName: String(appName).slice(0, 200) } : {}),
    capturedAt,
    screens: [
      {
        id: `screen-${capturedAt.replace(/[^0-9]/g, "")}`,
        label: String(label || "Current screen").slice(0, 200),
        elements,
      },
    ],
  };
}

function captureAndroid(options) {
  const devices = listAndroidDevices()
    .filter((device) => device.ready)
    .map((device) => device.id);
  const serial =
    options.serial || (devices.length === 1 ? devices[0] : undefined);
  if (!serial) {
    throw new Error(
      devices.length === 0
        ? "No authorized Android device was found. Connect one and enable USB debugging."
        : "Multiple Android devices are connected. Enter the device serial shown by adb devices.",
    );
  }
  const adb = (...args) => run("adb", ["-s", serial, ...args]);
  adb("shell", "uiautomator", "dump", "/sdcard/vaettir-window.xml");
  const hierarchy = adb("exec-out", "cat", "/sdcard/vaettir-window.xml");
  adb("shell", "rm", "/sdcard/vaettir-window.xml");
  const model = adb("shell", "getprop", "ro.product.model") || serial;
  const focusedWindow = adb("shell", "dumpsys", "window", "windows");
  const packageName = focusedWindow.match(/mCurrentFocus=.*?\s([\w.]+)\//)?.[1];
  return manifest({
    source: "ANDROID_ADB",
    deviceName: model,
    appName: options.appName || packageName,
    label: options.label || "Current Android screen",
    hierarchy,
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
  return manifest({
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
