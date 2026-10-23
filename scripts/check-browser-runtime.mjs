import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const FIXTURE =
  '<!doctype html><html><head><title>Vaettir runtime fixture</title></head><body><main><h1>Browser runtime</h1><label>Fixture name<input value="synthetic"></label><button>Review fixture</button></main></body></html>';
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function browserChildEnvironment(env = process.env) {
  return Object.fromEntries(
    ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "TZ"]
      .filter((key) => typeof env[key] === "string")
      .map((key) => [key, env[key]]),
  );
}

export async function bounded(
  action,
  { signal, timeout = 10_000, onLateResolve },
) {
  if (signal?.aborted) throw new Error("Browser runtime check cancelled");
  let timer;
  let cancel;
  const failure = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("Browser runtime check timed out")),
      timeout,
    );
    cancel = () => reject(new Error("Browser runtime check cancelled"));
    signal?.addEventListener("abort", cancel, { once: true });
  });
  const operation = Promise.resolve().then(action);
  try {
    return await Promise.race([operation, failure]);
  } catch (error) {
    // A driver can finish acquisition after cancellation. Close that late
    // resource too; do not wait unboundedly for an acquisition that may hang.
    if (onLateResolve) operation.then(onLateResolve).catch(() => {});
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
}

export async function checkBrowserRuntime({
  chromium,
  env = process.env,
  signal,
  timeout = 10_000,
} = {}) {
  if (!chromium) {
    const require = createRequire(
      new URL("../apps/api/package.json", import.meta.url),
    );
    chromium = require("playwright").chromium;
  }
  const options = { signal, timeout };
  let browser;
  let context;
  let operationError;
  let cleanupError;
  try {
    browser = await bounded(
      () =>
        chromium.launch({
          headless: true,
          timeout,
          env: browserChildEnvironment(env),
        }),
      {
        ...options,
        onLateResolve: (late) =>
          bounded(() => late.close(), { timeout: 5_000 }),
      },
    );
    context = await bounded(
      () =>
        browser.newContext({
          offline: true,
          serviceWorkers: "block",
          javaScriptEnabled: false,
          viewport: { width: 640, height: 360 },
        }),
      {
        ...options,
        onLateResolve: (late) =>
          bounded(() => late.close(), { timeout: 5_000 }),
      },
    );
    await bounded(
      () => context.route("**/*", (route) => route.abort("blockedbyclient")),
      options,
    );
    const page = await bounded(() => context.newPage(), options);
    page.setDefaultTimeout(timeout);
    await bounded(
      () =>
        page.setContent(FIXTURE, { waitUntil: "domcontentloaded", timeout }),
      options,
    );
    if (
      (await bounded(() => page.title(), options)) !== "Vaettir runtime fixture"
    )
      throw new Error("Browser fixture title mismatch");
    if (
      (await bounded(
        () =>
          page
            .getByRole("button", { name: "Review fixture", exact: true })
            .count(),
        options,
      )) !== 1
    )
      throw new Error("Browser fixture DOM mismatch");
    const image = await bounded(
      () => page.screenshot({ type: "png", timeout }),
      options,
    );
    if (
      !Buffer.isBuffer(image) ||
      image.length < 8 ||
      image.length > 2 * 1024 * 1024 ||
      !image.subarray(0, 8).equals(PNG_SIGNATURE)
    )
      throw new Error("Browser fixture screenshot invalid");
  } catch (error) {
    operationError = error;
  } finally {
    // Closing the browser invalidates its contexts. Await context cleanup
    // first, but still close the browser if context cleanup rejects or hangs.
    const cleanup = [];
    for (const resource of [context, browser]) {
      if (!resource) continue;
      cleanup.push(
        ...(await Promise.allSettled([
          bounded(() => resource.close(), { timeout: 5_000 }),
        ])),
      );
    }
    const failed = cleanup.find((result) => result.status === "rejected");
    if (failed) cleanupError = failed.reason;
  }
  if (operationError) throw operationError;
  if (cleanupError) throw cleanupError;
  return "network-free Chromium DOM/screenshot";
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  // The host container runner also has a deadline. This final guard terminates
  // an unresponsive browser/driver rather than leaving a build hanging.
  const deadline = setTimeout(() => process.exit(1), 30_000);
  try {
    const proof = await checkBrowserRuntime({ signal: controller.signal });
    console.log(`Browser runtime verified: ${proof}`);
  } catch {
    console.error(
      "Browser runtime verification failed; no customer URLs or credentials were used.",
    );
    process.exitCode = 1;
  } finally {
    clearTimeout(deadline);
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
  }
  if (process.exitCode) process.exit(process.exitCode);
}
