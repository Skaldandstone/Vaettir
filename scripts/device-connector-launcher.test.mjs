import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildDeviceConnectorLauncher,
  detectDeviceConnectorPlatform,
} from "../apps/web/lib/deviceConnectorLauncher.ts";

test("detects the desktop launcher platform without treating Android as Linux", () => {
  assert.equal(detectDeviceConnectorPlatform("Windows NT 10.0"), "windows");
  assert.equal(
    detectDeviceConnectorPlatform("Macintosh; Intel Mac OS X"),
    "macos",
  );
  assert.equal(detectDeviceConnectorPlatform("X11; Linux x86_64"), "linux");
  assert.equal(detectDeviceConnectorPlatform("Linux; Android 15"), "windows");
});

test("builds a one-click Windows launcher with an embedded pairing code", () => {
  const launcher = buildDeviceConnectorLauncher({
    platform: "windows",
    origin: "https://vaettir.skaldandstone.com",
    pairingCode: "ABCDEF123456",
  });

  assert.equal(launcher.filename, "Start Vaettir Device Capture.cmd");
  assert.match(
    launcher.content,
    /https:\/\/vaettir\.skaldandstone\.com\/connectors\/vaettir-device-connector\.mjs/,
  );
  assert.match(launcher.content, /--pairing-code ABCDEF123456/);
  assert.match(launcher.content, /where node\.exe/);
});

test("rejects unsafe launcher inputs", () => {
  assert.throws(
    () =>
      buildDeviceConnectorLauncher({
        platform: "windows",
        origin: "file:///tmp/vaettir",
        pairingCode: "ABCDEF123456",
      }),
    /origin is not valid/,
  );
  assert.throws(
    () =>
      buildDeviceConnectorLauncher({
        platform: "windows",
        origin: "https://vaettir.skaldandstone.com",
        pairingCode: "ABC & calc.exe",
      }),
    /pairing code is invalid/,
  );
});
