#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { buildCaptureManifest, captureAndroidWindow } from "./device-capture-lib.mjs";

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") continue;
    if (!argument.startsWith("--")) continue;
    const name = argument.slice(2);
    if (name === "append") values.append = true;
    else values[name] = argv[++index];
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

function captureAndroid(options) {
  return captureAndroidWindow(options, {
    listDevices: () => run("adb", ["devices"]).split(/\r?\n/).slice(1).map(line => line.trim()).filter(Boolean).map(line => {
      const [id, status] = line.split(/\s+/); return { id, status, ready: status === "device" };
    }),
    adb: (serial, args) => run("adb", ["-s", serial, ...args]),
    dumpPath: () => `/sdcard/vaettir-window-${randomBytes(16).toString("hex")}.xml`,
  }, "expected-package");
}

function appiumRequestOptions(url) {
  const parsed = new URL(url);
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

async function appiumJson(baseUrl, path, headers, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { ...headers, ...init.headers },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.value?.error) {
    throw new Error(
      payload.value?.message || `Appium returned HTTP ${response.status}`,
    );
  }
  return payload;
}

async function captureIos(options) {
  if (!options["appium-url"])
    throw new Error("iOS capture requires --appium-url.");
  const { baseUrl, headers } = appiumRequestOptions(options["appium-url"]);
  let sessionId = options["session-id"];
  let createdSession = false;
  if (!sessionId) {
    if (!options.capabilities) {
      throw new Error(
        "Pass --session-id for an existing session or --capabilities <json-file> to create one.",
      );
    }
    const capabilities = JSON.parse(
      readFileSync(resolve(options.capabilities), "utf8"),
    );
    const created = await appiumJson(baseUrl, "/session", headers, {
      method: "POST",
      body: JSON.stringify({
        capabilities: { alwaysMatch: capabilities, firstMatch: [{}] },
      }),
    });
    sessionId = created.sessionId || created.value?.sessionId;
    if (!sessionId) throw new Error("Appium did not return a session id.");
    createdSession = true;
  }

  try {
    const source = await appiumJson(
      baseUrl,
      `/session/${encodeURIComponent(sessionId)}/source`,
      headers,
    );
    const details = await appiumJson(
      baseUrl,
      `/session/${encodeURIComponent(sessionId)}`,
      headers,
    ).catch(() => ({}));
    const capabilities = details.value?.capabilities || details.value || {};
    return buildCaptureManifest({
      source: options.source === "ios-remote" ? "IOS_REMOTE" : "IOS_CONNECTED",
      deviceName:
        options["device-name"] ||
        capabilities.deviceName ||
        capabilities["appium:deviceName"] ||
        "iOS device",
      appName:
        options["app-name"] ||
        capabilities.bundleId ||
        capabilities["appium:bundleId"],
      label: options.label || "Current iOS screen",
      hierarchy: source.value,
    });
  } finally {
    if (createdSession) {
      await fetch(`${baseUrl}/session/${encodeURIComponent(sessionId)}`, {
        method: "DELETE",
        headers,
      }).catch(() => undefined);
    }
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (
    !options.source ||
    !["adb", "ios-connected", "ios-remote"].includes(options.source)
  ) {
    throw new Error(
      "Pass --source adb, --source ios-connected, or --source ios-remote.",
    );
  }
  const outputPath = resolve(options.output || "vaettir-device-capture.json");
  // A persisted v1 file has no trusted original device/package binding. Refuse
  // before native collection or any file write; never infer identity from names.
  if (existsSync(outputPath)) throw new Error("The output already exists and has no trusted in-memory capture binding. Nothing was overwritten. Choose a new output filename.");
  const captured =
    options.source === "adb"
      ? captureAndroid(options)
      : await captureIos(options);
  writeFileSync(outputPath, `${JSON.stringify(captured, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  process.stdout.write(
    `Captured ${captured.screens[0].elements.length} named elements to ${outputPath}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
