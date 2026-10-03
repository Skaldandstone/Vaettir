import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import http from "node:http";
import {
  checkWebStartup,
  readPublicWebPage,
  verifyPublicWebPage,
  webStartupEnvironment,
  assertOfflineImageRuntime,
  assertReadOnlyBuildSource,
  PUBLIC_WEB_URL,
  SYNTHETIC_CLERK_SETTING,
} from "./check-web-startup.mjs";

const mountRecord =
  "42 35 0:64 / /run/vaettir-image-build ro,relatime - overlay overlay rw\n";
const buildProof = {
  cwd: "/app",
  read: (path) =>
    path === "/proc/self/mountinfo"
      ? mountRecord
      : Buffer.from("synthetic helper bytes"),
};

test("offline startup accepts only a real read-only exact-source context mount, never a marker or forged directory", () => {
  assertReadOnlyBuildSource(buildProof.read);
  for (const inventory of [
    "",
    mountRecord.replace("ro,", "rw,"),
    mountRecord + mountRecord,
    mountRecord.replace("ro,", "ro,rw,"),
    "x".repeat(1024 * 1024 + 1),
    mountRecord.replace(
      "/run/vaettir-image-build",
      "/run/vaettir-image-build\\040forged",
    ),
    mountRecord.replace(
      "/run/vaettir-image-build",
      "/run/vaettir-image-build\\777",
    ),
    mountRecord.replace(" - overlay overlay rw", " - overlay"),
    mountRecord.replace("42 35 0:64", "forged forged not-a-device"),
    mountRecord.replace(
      "/run/vaettir-image-build",
      "/run/not-the-build-context",
    ),
  ])
    assert.throws(() =>
      assertReadOnlyBuildSource((path) =>
        path === "/proc/self/mountinfo"
          ? inventory
          : Buffer.from("synthetic helper bytes"),
      ),
    );
  assert.throws(() =>
    assertReadOnlyBuildSource((path) =>
      path === "/proc/self/mountinfo"
        ? mountRecord
        : Buffer.from(
            path.startsWith("/run/") ? "altered source" : "actual source",
          ),
    ),
  );
  assert.throws(() =>
    assertOfflineImageRuntime({
      ...buildProof,
      cwd: "/",
      platform: "linux",
      uid: 1001,
      exists: () => true,
    }),
  );
  assert.throws(() =>
    assertOfflineImageRuntime({
      ...buildProof,
      read: (path) =>
        path === "/proc/self/mountinfo"
          ? ""
          : Buffer.from("synthetic helper bytes"),
      platform: "linux",
      uid: 1001,
      exists: () => true,
    }),
  );
});

test("HTTP request stays loopback-only with no authorization, bounded cancellation and body size", async () => {
  const originalGet = http.get;
  const keepAlive = setTimeout(() => {}, 500);
  try {
    http.get = (url, options) => {
      assert.equal(url, "http://127.0.0.1:3000/");
      assert.deepEqual(options.headers, { Accept: "text/html" });
      assert.equal(options.agent, false);
      const request = new EventEmitter();
      options.signal.addEventListener(
        "abort",
        () =>
          request.emit(
            "error",
            Object.assign(new Error("synthetic timeout"), {
              code: "ABORT_ERR",
            }),
          ),
        { once: true },
      );
      return request;
    };
    await assert.rejects(readPublicWebPage({ timeoutMs: 5 }), {
      code: "ABORT_ERR",
    });
    http.get = (_url, _options, callback) => {
      const request = new EventEmitter();
      request.destroy = (error) => request.emit("error", error);
      queueMicrotask(() => {
        const response = new EventEmitter();
        response.headers = { "content-type": "text/html" };
        callback(response);
        response.emit("data", Buffer.alloc(2 * 1024 * 1024 + 1));
      });
      return request;
    };
    await assert.rejects(
      readPublicWebPage({ timeoutMs: 5 }),
      /exceeds packaging probe bound/,
    );
  } finally {
    http.get = originalGet;
    clearTimeout(keepAlive);
  }
});

function fixture({ request, spawnError = false, ignoresTerm = false } = {}) {
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.signals = [];
  child.kill = (signal) => {
    child.signals.push(signal);
    if (signal === "SIGTERM" && ignoresTerm) return true;
    child.signalCode = signal;
    child.emit("exit", null, signal);
    child.emit("close", null, signal);
    return true;
  };
  return {
    child,
    options: {
      startupTimeoutMs: 25,
      requestTimeoutMs: 5,
      retryDelayMs: 1,
      shutdownTimeoutMs: 5,
      portCheck: async () => {},
      spawnImpl(executable, args, options) {
        assert.equal(executable, process.execPath);
        assert.deepEqual(args, ["apps/web/server.js"]);
        assert.deepEqual(options.env, webStartupEnvironment());
        assert.equal(options.stdio, "ignore");
        assert.equal(options.shell, false);
        if (spawnError)
          queueMicrotask(() =>
            child.emit("error", new Error("synthetic startup failure")),
          );
        return child;
      },
      requestImpl:
        request ??
        (async () => ({
          status: 200,
          contentType: "text/html; charset=utf-8",
          html: "<!doctype html><html><body>Vaettir public fixture</body></html>",
        })),
    },
  };
}

test("fresh minimal environment excludes all inherited real credentials, proxies and preloads", () => {
  const prior = process.env.CLERK_SECRET_KEY;
  process.env.CLERK_SECRET_KEY = "real-fixture-never-forward";
  try {
    const env = webStartupEnvironment();
    assert.deepEqual(
      Object.keys(env).sort(),
      [
        "NODE_ENV",
        "NEXT_TELEMETRY_DISABLED",
        "PORT",
        "HOSTNAME",
        "NODE_OPTIONS",
        "CLERK_SECRET_KEY",
      ].sort(),
    );
    assert.equal(env.CLERK_SECRET_KEY, SYNTHETIC_CLERK_SETTING);
    assert.equal(env.NODE_OPTIONS, "--dns-result-order=ipv4first");
    assert.equal(env.HOSTNAME, "0.0.0.0");
    assert.equal(env.PORT, "3000");
    assert.equal(env.SENTRY_DSN, undefined);
    assert.equal(env.AWS_ACCESS_KEY_ID, undefined);
    env.CLERK_SECRET_KEY = "changed";
    assert.equal(
      webStartupEnvironment().CLERK_SECRET_KEY,
      SYNTHETIC_CLERK_SETTING,
    );
  } finally {
    if (prior === undefined) delete process.env.CLERK_SECRET_KEY;
    else process.env.CLERK_SECRET_KEY = prior;
  }
});

test("public HTML requires 200, HTML content and Vaettir identity; redirects/error/generic pages fail", () => {
  const valid = {
    status: 200,
    contentType: "text/html",
    html: "<html><body>Vaettir</body></html>",
  };
  verifyPublicWebPage(valid);
  for (const page of [
    { ...valid, status: 302 },
    { ...valid, status: 500 },
    { ...valid, html: "<html>Another service</html>" },
    { ...valid, html: "Vaettir plain text" },
    { ...valid, contentType: "application/json" },
    { ...valid, html: "<html>Vaettir" + "x".repeat(2 * 1024 * 1024) },
  ])
    assert.throws(() => verifyPublicWebPage(page));
  assert.equal(PUBLIC_WEB_URL, "http://127.0.0.1:3000/");
});

test("successful probe cleans its server and never claims authenticated/provider acceptance", async () => {
  const { child, options } = fixture();
  const proof = await checkWebStartup(options);
  assert.equal(proof.publicStatus, 200);
  assert.equal(proof.authenticatedAcceptance, false);
  assert.equal(proof.providerAcceptance, false);
  assert.equal(proof.inheritedCredentials, false);
  assert.deepEqual(child.signals, ["SIGTERM"]);
});

test("startup failure and non-Vaettir page fail with owned child cleanup", async () => {
  for (const setup of [
    { spawnError: true },
    {
      request: async () => ({
        status: 200,
        contentType: "text/html",
        html: "<html>wrong page</html>",
      }),
    },
  ]) {
    const { child, options } = fixture(setup);
    await assert.rejects(checkWebStartup(options));
    assert.deepEqual(child.signals, ["SIGTERM"]);
  }
});

test("unavailable server exhausts startup deadline and bounded request attempts", async () => {
  let calls = 0;
  const { child, options } = fixture({
    request: async ({ timeoutMs }) => {
      calls++;
      assert.ok(timeoutMs > 0 && timeoutMs <= 5);
      throw Object.assign(new Error("synthetic refused"), {
        code: "ECONNREFUSED",
      });
    },
  });
  await assert.rejects(checkWebStartup(options), /bounded deadline/);
  assert.ok(calls > 0 && calls < 100);
  assert.deepEqual(child.signals, ["SIGTERM"]);
});

test("cleanup escalates only owned child when graceful termination is ignored", async () => {
  const { child, options } = fixture({ ignoresTerm: true });
  await checkWebStartup(options);
  assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]);
});

test("unresponsive cleanup fails closed and removes all owned child listeners", async () => {
  const { child, options } = fixture();
  child.kill = (signal) => {
    child.signals.push(signal);
    return true;
  };
  await assert.rejects(
    checkWebStartup(options),
    /did not stop within its bound/,
  );
  assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]);
  assert.equal(child.listenerCount("close"), 0);
  assert.equal(child.listenerCount("exit"), 0);
  assert.equal(child.listenerCount("error"), 0);
});

test("occupied port, cancellation and invalid bounds cannot leave a child running", async () => {
  const { child, options } = fixture();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    checkWebStartup({ ...options, signal: controller.signal }),
    /cancelled/,
  );
  assert.deepEqual(child.signals, ["SIGTERM"]);
  await assert.rejects(
    checkWebStartup({
      ...options,
      portCheck: async () => {
        throw Error("occupied");
      },
      spawnImpl: () => assert.fail("must not spawn"),
    }),
    /occupied/,
  );
  await assert.rejects(
    checkWebStartup({
      ...options,
      startupTimeoutMs: 60001,
      spawnImpl: () => assert.fail("must not spawn"),
    }),
  );
});

test("CLI guard refuses host/root runtime, and Docker gate stays offline after native gates", () => {
  for (const options of [
    { platform: "win32", uid: 1001, exists: () => true },
    { platform: "linux", uid: 0, exists: () => true },
    { platform: "linux", uid: 1001, exists: () => false },
  ])
    assert.throws(() =>
      assertOfflineImageRuntime({ ...buildProof, ...options }),
    );
  assertOfflineImageRuntime({
    ...buildProof,
    platform: "linux",
    uid: 1001,
    exists: () => true,
  });
  const source = readFileSync(
    new URL("../Dockerfile.web", import.meta.url),
    "utf8",
  );
  const check = source.indexOf(
    "RUN --network=none --mount=type=bind,source=scripts,target=/run/vaettir-image-build,readonly node scripts/check-web-startup.mjs --image-build",
  );
  for (const token of [
    "USER nextjs",
    "RUN --network=none node scripts/check-dash-runtime.mjs",
    "RUN --network=none node scripts/check-zlib-runtime.mjs",
    "RUN --network=none node scripts/check-image-runtime.mjs",
  ])
    assert.ok(check > source.indexOf(token) && source.indexOf(token) > 0);
  assert.match(source, /HEALTHCHECK --interval=30s --timeout=5s/);
});
