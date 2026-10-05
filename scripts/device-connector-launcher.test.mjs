import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

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
  assert.match(launcher.content, /'--pairing-code','ABCDEF123456'/);
  assert.match(launcher.content, /where node\.exe/);
  assert.doesNotMatch(
    launcher.content,
    /curl|%TEMP%|ExecutionPolicy|Unblock-File|RunAs/i,
  );
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

test("accepts loopback development but refuses remote HTTP and shell metacharacters", () => {
  for (const origin of ["http://localhost:3000", "http://127.0.0.1:3001"]) {
    assert.doesNotThrow(() =>
      buildDeviceConnectorLauncher({
        platform: "windows",
        origin,
        pairingCode: "ABCDEF123456",
      }),
    );
  }
  for (const origin of [
    "http://[::1]:3000",
    "http://vaettir.skaldandstone.com",
    "https://evil'host.test",
    "https://evil&host.test",
    "https://evil%host.test",
    "https://vaettir.skaldandstone.com/path",
  ]) {
    assert.throws(() =>
      buildDeviceConnectorLauncher({
        platform: "windows",
        origin,
        pairingCode: "ABCDEF123456",
      }),
    );
  }
});

// Execute only the generated bootstrap in an isolated, fully synthetic runtime.
// No network, disk writes, downloaded connector or device capture is performed.
async function syntheticBootstrap({
  platform = "windows",
  version = "24.0.0",
  status = 200,
  contentType = "text/javascript",
  contentLength = null,
  chunks = [Buffer.from("// synthetic")],
  fetchError = false,
  childStatus = 0,
  childSignal = null,
  writeError = false,
  openError = false,
} = {}) {
  const launcher = buildDeviceConnectorLauncher({
    platform,
    origin: "https://vaettir.skaldandstone.com",
    pairingCode: "ABCDEF123456",
  });
  const command = launcher.content
    .split(/\r?\n/)
    .find((line) => /^node(?:\.exe)? -e /.test(line));
  const program = command.match(
    /^node(?:\.exe)? -e "(.*)"(?: \|\| exit_code=\$\?)?$/,
  )[1];
  // Neither shell is asked to interpret this test; reject command interpolation.
  assert.doesNotMatch(program, /["`%]|\$(?:[a-zA-Z_({])/);
  const events = [];
  const state = {
    versions: { node: version },
    execPath: "synthetic-node",
    exitCode: undefined,
  };
  const modules = {
    "node:fs": {
      mkdtempSync(prefix) {
        events.push(["temp", prefix]);
        return "/owned/vaettir-device-unique";
      },
      openSync(file, flags, mode) {
        events.push(["open", file, flags, mode]);
        if (openError) throw Error("synthetic exclusive open refusal");
        return 42;
      },
      writeFileSync(descriptor, bytes) {
        events.push(["write", descriptor, bytes]);
        if (writeError) throw Error("synthetic write error");
      },
      closeSync(descriptor) {
        events.push(["close", descriptor]);
      },
      unlinkSync(file) {
        events.push(["unlink", file]);
      },
      rmdirSync(directory) {
        events.push(["rmdir", directory]);
      },
    },
    "node:path": { join: (...values) => values.join("/") },
    "node:os": { tmpdir: () => "/owned" },
    "node:child_process": {
      spawnSync(command, args, options) {
        events.push(["spawn", command, args, options]);
        return { status: childStatus, signal: childSignal };
      },
    },
  };
  await runInNewContext(program, {
    require: (name) => {
      assert.ok(modules[name]);
      return modules[name];
    },
    process: state,
    Buffer,
    console: { error: (message) => events.push(["error", message]) },
    AbortSignal: {
      timeout: (milliseconds) => {
        events.push(["timeout", milliseconds]);
        return "synthetic-signal";
      },
    },
    fetch: async (url, options) => {
      events.push(["fetch", url, options]);
      if (fetchError) throw Error("synthetic redirect or TLS failure");
      return {
        status,
        headers: {
          get: (key) => (key === "content-type" ? contentType : contentLength),
        },
        body: (async function* () {
          yield* chunks;
        })(),
      };
    },
  });
  return { events, state };
}

test("all platform bootstraps use bounded no-redirect downloads and unique exclusive files", async () => {
  for (const platform of ["windows", "macos", "linux"]) {
    const { events, state } = await syntheticBootstrap({ platform });
    assert.equal(state.exitCode, 0);
    const fetch = events.find(([event]) => event === "fetch");
    assert.equal(fetch[2].redirect, "error");
    assert.equal(fetch[2].signal, "synthetic-signal");
    assert.deepEqual(
      events.find(([event]) => event === "timeout"),
      ["timeout", 30000],
    );
    const open = events.find(([event]) => event === "open");
    assert.equal(open[2], "wx");
    assert.equal(open[3], 0o600);
    const spawn = events.find(([event]) => event === "spawn");
    assert.equal(spawn[1], "synthetic-node");
    assert.equal(
      spawn[2].join("|"),
      "/owned/vaettir-device-unique/vaettir-device-connector.mjs|--pairing-code|ABCDEF123456",
    );
    assert.equal(spawn[3].shell, false);
    assert.equal(spawn[3].stdio, "inherit");
    assert.equal(events.at(-2)[0], "unlink");
    assert.deepEqual(events.at(-1), ["rmdir", "/owned/vaettir-device-unique"]);
  }
});

test("exclusive file admission refusal never removes a file it did not create", async () => {
  const { events, state } = await syntheticBootstrap({ openError: true });
  assert.equal(state.exitCode, 1);
  assert.equal(
    events.some(([event]) => ["unlink", "write", "spawn"].includes(event)),
    false,
  );
  assert.deepEqual(events.at(-1), ["rmdir", "/owned/vaettir-device-unique"]);
});

test("old Node refuses before fetching; unsafe response variants never create or start a connector", async () => {
  for (const options of [
    { version: "20.0.0" },
    { status: 302 },
    { status: 206 },
    { fetchError: true },
    { contentType: "text/html" },
    { contentLength: "2097153" },
    { contentLength: "not-a-length" },
    { chunks: [] },
    { chunks: [Buffer.alloc(1024 * 1024), Buffer.alloc(1024 * 1024 + 1)] },
  ]) {
    const { events, state } = await syntheticBootstrap(options);
    assert.equal(state.exitCode, 1);
    assert.equal(
      events.some(([event]) => ["write", "temp", "spawn"].includes(event)),
      false,
    );
    if (options.version)
      assert.equal(
        events.some(([event]) => event === "fetch"),
        false,
      );
    assert.doesNotMatch(
      events.find(([event]) => event === "error")[1],
      /ABCDEF123456|synthetic redirect/,
    );
  }
});

test("child failures preserve nonzero exit and clean only the bootstrap-owned file/directory", async () => {
  for (const options of [
    { childStatus: 7 },
    { childStatus: null, childSignal: "SIGTERM" },
    { writeError: true },
  ]) {
    const { events, state } = await syntheticBootstrap(options);
    assert.equal(state.exitCode, options.childStatus === 7 ? 7 : 1);
    assert.deepEqual(events.at(-2), [
      "unlink",
      "/owned/vaettir-device-unique/vaettir-device-connector.mjs",
    ]);
    assert.deepEqual(events.at(-1), ["rmdir", "/owned/vaettir-device-unique"]);
  }
});
