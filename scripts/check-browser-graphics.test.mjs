import test from "node:test";
import assert from "node:assert/strict";
import {
  checkBrowserGraphics,
  syntheticGraphicsFixture,
  validateGraphicsResult,
} from "./check-browser-graphics.mjs";
const green = {
  canvasPixel: [17, 34, 51, 255],
  webglPixel: [0, 255, 0, 255],
  webglError: 0,
};
function fixture({
  evaluate = async () => green,
  launchDelay = false,
  routeAttempt = false,
  contextClose,
  newContext,
} = {}) {
  const calls = [];
  const page = {
    setDefaultTimeout: () => {},
    setContent: async (html) => calls.push(["html", html]),
    evaluate: async (code) => {
      assert.equal(code, syntheticGraphicsFixture);
      return evaluate();
    },
  };
  const context = {
    newPage: async () => page,
    route: async (pattern, handler) => {
      calls.push(["route", pattern, handler]);
      if (routeAttempt)
        await handler({
          abort: async (reason) => calls.push(["aborted-request", reason]),
        });
    },
    close: contextClose ?? (async () => calls.push(["close-context"])),
  };
  const browser = {
    newContext: async (options) => {
      calls.push(["context", options]);
      return newContext ? await newContext(context) : context;
    },
    close: async () => calls.push(["close-browser"]),
  };
  let resolve;
  const chromium = {
    launch: async (options) => {
      calls.push(["launch", options]);
      return launchDelay
        ? await new Promise((done) => {
            resolve = done;
          })
        : browser;
    },
  };
  return { chromium, calls, release: () => resolve(browser) };
}
test("authored graphics uses isolated JS with no network, credentials or renderer-disable flags", async () => {
  const { chromium, calls } = fixture();
  await checkBrowserGraphics({
    chromium,
    env: {
      PATH: "/usr/bin",
      DATABASE_URL: "secret",
      AWS_SECRET_ACCESS_KEY: "secret",
    },
  });
  assert.deepEqual(calls[0], [
    "launch",
    { headless: true, timeout: 10000, env: { PATH: "/usr/bin" } },
  ]);
  assert.deepEqual(calls[1], [
    "context",
    {
      offline: true,
      serviceWorkers: "block",
      javaScriptEnabled: true,
      viewport: { width: 64, height: 64 },
    },
  ]);
  assert.deepEqual(calls.slice(-2), [["close-context"], ["close-browser"]]);
  assert.doesNotMatch(
    syntheticGraphicsFixture.toString(),
    /https?:|fetch\(|eval\(|Function\(|location|XMLHttpRequest|import\(/,
  );
});

test("any attempted network is blocked and fails even if synthetic pixels passed", async () => {
  const current = fixture({ routeAttempt: true });
  await assert.rejects(
    checkBrowserGraphics({ chromium: current.chromium }),
    /attempted network/,
  );
  assert.ok(
    current.calls.some(
      ([name, reason]) =>
        name === "aborted-request" && reason === "blockedbyclient",
    ),
  );
  assert.deepEqual(current.calls.slice(-2), [
    ["close-context"],
    ["close-browser"],
  ]);
});

test("late context after cancellation receives cleanup even if that cleanup rejects", async () => {
  let release;
  let attemptedClose = false;
  const controller = new AbortController();
  const current = fixture({
    newContext: () =>
      new Promise((resolve) => {
        release = resolve;
        controller.abort();
      }),
    contextClose: async () => {
      attemptedClose = true;
      throw new Error("late context already invalidated");
    },
  });
  await assert.rejects(
    checkBrowserGraphics({
      chromium: current.chromium,
      signal: controller.signal,
    }),
    /cancelled/,
  );
  assert.deepEqual(current.calls.at(-1), ["close-browser"]);
  release({
    close: async () => {
      attemptedClose = true;
      throw new Error("late cleanup failed");
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(attemptedClose, true);
});

test("context cleanup rejection never prevents bounded browser cleanup", async () => {
  const current = fixture({
    contextClose: async () => {
      throw new Error("context cleanup failed");
    },
  });
  await assert.rejects(
    checkBrowserGraphics({ chromium: current.chromium }),
    /context cleanup failed/,
  );
  assert.deepEqual(current.calls.at(-1), ["close-browser"]);
});

test("primary graphics failure is preserved when ordered cleanup also fails", async () => {
  const primary = new Error("primary graphics failure");
  const current = fixture({
    evaluate: async () => {
      throw primary;
    },
    contextClose: async () => {
      throw new Error("secondary cleanup failure");
    },
  });
  await assert.rejects(
    checkBrowserGraphics({ chromium: current.chromium }),
    (error) => error === primary,
  );
  assert.deepEqual(current.calls.at(-1), ["close-browser"]);
});
test("both actual pixel outputs and shader error are mandatory, not context-presence only", () => {
  validateGraphicsResult(green);
  for (const bad of [
    null,
    { ...green, canvasPixel: [0, 0, 0, 0] },
    { ...green, webglPixel: [0, 0, 0, 255] },
    { ...green, webglError: 1280 },
  ])
    assert.throws(() => validateGraphicsResult(bad), /mismatch/);
});
test("graphics failure and timeout close resources in safe order", async () => {
  for (const evaluate of [
    async () => {
      throw new Error("WebGL unavailable");
    },
    async () => ({ ...green, webglError: 1 }),
    () => new Promise(() => {}),
  ]) {
    const { chromium, calls } = fixture({ evaluate });
    await assert.rejects(
      checkBrowserGraphics({ chromium, timeout: 10 }),
      /unavailable|mismatch|timed out/,
    );
    assert.deepEqual(calls.slice(-2), [["close-context"], ["close-browser"]]);
  }
});
test("late graphics launch timeout closes resources and pre-cancel never launches", async () => {
  const current = fixture({ launchDelay: true });
  await assert.rejects(
    checkBrowserGraphics({ chromium: current.chromium, timeout: 10 }),
    /timed out/,
  );
  current.release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(current.calls.at(-1), ["close-browser"]);
  const controller = new AbortController();
  controller.abort();
  const cancelled = fixture();
  await assert.rejects(
    checkBrowserGraphics({
      chromium: cancelled.chromium,
      signal: controller.signal,
    }),
    /cancelled/,
  );
  assert.deepEqual(cancelled.calls, []);
});
