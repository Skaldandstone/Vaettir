#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { appendCapture, buildCaptureManifest } from "./device-capture-lib.mjs";

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
    }).trim();
  } catch (error) {
    const detail = error?.stderr?.toString().trim() || error.message;
    throw new Error(`${command} failed: ${detail}`);
  }
}

function captureAndroid(options) {
  const devices = run("adb", ["devices"])
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter(([, state]) => state === "device")
    .map(([serial]) => serial);
  const serial =
    options.serial || (devices.length === 1 ? devices[0] : undefined);
  if (!serial) {
    throw new Error(
      devices.length === 0
        ? "No authorized ADB device is connected."
        : "Multiple ADB devices are connected; pass --serial <device>.",
    );
  }
  const adb = (...args) => run("adb", ["-s", serial, ...args]);
  adb("shell", "uiautomator", "dump", "/sdcard/vaettir-window.xml");
  const hierarchy = adb("exec-out", "cat", "/sdcard/vaettir-window.xml");
  adb("shell", "rm", "/sdcard/vaettir-window.xml");
  const model = adb("shell", "getprop", "ro.product.model") || serial;
  const focusedWindow = adb("shell", "dumpsys", "window", "windows");
  const packageName = focusedWindow.match(/mCurrentFocus=.*?\s([\w.]+)\//)?.[1];
  return buildCaptureManifest({
    source: "ANDROID_ADB",
    deviceName: model,
    appName: options["app-name"] || packageName,
    label: options.label || "Current Android screen",
    hierarchy,
  });
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
  const captured =
    options.source === "adb"
      ? captureAndroid(options)
      : await captureIos(options);
  const manifest =
    options.append && existsSync(outputPath)
      ? appendCapture(JSON.parse(readFileSync(outputPath, "utf8")), captured)
      : captured;
  writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
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
