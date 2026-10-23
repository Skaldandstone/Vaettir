import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  browserChildEnvironment,
  checkBrowserRuntime,
} from "./check-browser-runtime.mjs";

function fixture(overrides = {}) {
  const calls = [];
  const page = {
    setDefaultTimeout: (ms) => calls.push(["timeout", ms]),
    setContent: async (html, options) => {
      calls.push(["content", html, options]);
    },
    title: async () => "Vaettir runtime fixture",
    getByRole: (role, options) => {
      calls.push(["role", role, options]);
      return { count: async () => 1 };
    },
    screenshot: async () => Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]),
    ...overrides.page,
  };
  const context = {
    route: async (pattern, handler) => {
      calls.push(["route", pattern]);
      await handler({ abort: async (reason) => calls.push(["abort", reason]) });
    },
    newPage: async () => page,
    close: async () => calls.push(["close-context"]),
    ...overrides.context,
  };
  const browser = {
    newContext: async (options) => {
      calls.push(["context", options]);
      return context;
    },
    close: async () => calls.push(["close-browser"]),
    ...overrides.browser,
  };
  const chromium = {
    launch: async (options) => {
      calls.push(["launch", options]);
      return browser;
    },
    ...overrides.chromium,
  };
  return { chromium, calls };
}

test("browser child environment excludes database, provider and AWS credentials", () => {
  assert.deepEqual(
    browserChildEnvironment({
      PATH: "/usr/bin",
      HOME: "/root",
      LANG: "C",
      DATABASE_URL: "secret",
      AWS_SECRET_ACCESS_KEY: "secret",
      GITLAB_TOKEN: "secret",
      API_KEY: "secret",
    }),
    { PATH: "/usr/bin", HOME: "/root", LANG: "C" },
  );
});

test("API image verifies its pinned browser with container networking disabled", () => {
  const source = readFileSync(
    new URL("../Dockerfile.api", import.meta.url),
    "utf8",
  );
  assert.match(source, /playwright install --only-shell chromium/);
  assert.doesNotMatch(source, /playwright install --with-deps/);
  assert.match(source, /libgbm1[^\n]+libnss3/);
  assert.match(source, /libfontconfig1[^\n]+fonts-noto-color-emoji/);
  assert.match(
    source,
    /^RUN --network=none node scripts\/check-browser-runtime\.mjs$/m,
  );
});

test("runtime smoke uses only static DOM, blocked networking and bounded in-memory screenshot", async () => {
  const { chromium, calls } = fixture();
  assert.equal(
    await checkBrowserRuntime({
      chromium,
      env: { PATH: "/usr/bin", DATABASE_URL: "secret" },
    }),
    "network-free Chromium DOM/screenshot",
  );
  assert.deepEqual(calls[0], [
    "launch",
    { headless: true, timeout: 10_000, env: { PATH: "/usr/bin" } },
  ]);
  assert.deepEqual(calls[1], [
    "context",
    {
      offline: true,
      serviceWorkers: "block",
      javaScriptEnabled: false,
      viewport: { width: 640, height: 360 },
    },
  ]);
  assert.ok(
    calls.some(
      ([name, reason]) => name === "abort" && reason === "blockedbyclient",
    ),
  );
  assert.doesNotMatch(
    calls.find(([name]) => name === "content")[1],
    /https?:|src=|href=|script/i,
  );
  assert.deepEqual(calls.slice(-2), [["close-context"], ["close-browser"]]);
});

test("fixture mismatch and screenshot failure close browser and context", async () => {
  for (const page of [
    { title: async () => "wrong" },
    { screenshot: async () => Buffer.from("not PNG") },
    {
      screenshot: async () => {
        throw new Error("render failure");
      },
    },
  ]) {
    const { chromium, calls } = fixture({ page });
    await assert.rejects(
      checkBrowserRuntime({ chromium }),
      /mismatch|invalid|render failure/,
    );
    assert.deepEqual(calls.slice(-2), [["close-context"], ["close-browser"]]);
  }
});

test("cancellation fails closed and closes acquired resources", async () => {
  const controller = new AbortController();
  const { chromium, calls } = fixture({
    page: { setContent: async () => controller.abort() },
  });
  await assert.rejects(
    checkBrowserRuntime({ chromium, signal: controller.signal }),
    /cancelled/,
  );
  assert.deepEqual(calls.slice(-2), [["close-context"], ["close-browser"]]);
  const before = fixture();
  await assert.rejects(
    checkBrowserRuntime({
      chromium: before.chromium,
      signal: controller.signal,
    }),
    /cancelled/,
  );
  assert.deepEqual(before.calls, []);
});

test("unresponsive rendering times out and closes acquired resources", async () => {
  const { chromium, calls } = fixture({
    page: { setContent: () => new Promise(() => {}) },
  });
  await assert.rejects(
    checkBrowserRuntime({ chromium, timeout: 10 }),
    /timed out/,
  );
  assert.deepEqual(calls.slice(-2), [["close-context"], ["close-browser"]]);
});

test("a context cleanup error does not prevent browser cleanup", async () => {
  const { chromium, calls } = fixture({
    context: {
      close: async () => {
        throw new Error("context cleanup failed");
      },
    },
  });
  await assert.rejects(
    checkBrowserRuntime({ chromium }),
    /context cleanup failed/,
  );
  assert.ok(calls.some(([name]) => name === "close-browser"));
});

test("primary DOM failure is preserved when ordered cleanup also fails", async () => {
  const primary = new Error("primary DOM failure");
  const { chromium, calls } = fixture({
    page: {
      setContent: async () => {
        throw primary;
      },
    },
    context: {
      close: async () => {
        throw new Error("secondary cleanup failure");
      },
    },
  });
  await assert.rejects(
    checkBrowserRuntime({ chromium }),
    (error) => error === primary,
  );
  assert.ok(calls.some(([name]) => name === "close-browser"));
});

test("browser cleanup waits for context cleanup instead of invalidating it", async () => {
  let browserClosed = false;
  let contextClosed = false;
  const { chromium } = fixture({
    context: {
      close: async () => {
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(browserClosed, false, "browser invalidated its context");
        contextClosed = true;
      },
    },
    browser: {
      close: async () => {
        assert.equal(contextClosed, true);
        browserClosed = true;
      },
    },
  });
  await checkBrowserRuntime({ chromium });
  assert.equal(browserClosed, true);
});

test("browser acquired after launch timeout receives bounded late cleanup", async () => {
  let release;
  let closed = false;
  const chromium = {
    launch: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  };
  await assert.rejects(
    checkBrowserRuntime({ chromium, timeout: 10 }),
    /timed out/,
  );
  release({
    close: async () => {
      closed = true;
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(closed, true);
});

test("context acquired after cancellation closes without leaking browser", async () => {
  const controller = new AbortController();
  let release;
  let contextClosed = false;
  let browserClosed = false;
  const chromium = {
    launch: async () => ({
      newContext: () =>
        new Promise((resolve) => {
          release = resolve;
          controller.abort();
        }),
      close: async () => {
        browserClosed = true;
      },
    }),
  };
  await assert.rejects(
    checkBrowserRuntime({ chromium, signal: controller.signal }),
    /cancelled/,
  );
  assert.equal(browserClosed, true);
  release({
    close: async () => {
      contextClosed = true;
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(contextClosed, true);
});
