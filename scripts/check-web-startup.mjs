import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { fileURLToPath } from "node:url";

// This is intentionally NOT an authentication credential. The public route's
// SDK requires a syntactically present server setting even without a session.
export const SYNTHETIC_CLERK_SETTING =
  "sk_test_synthetic_offline_diagnostic_not_a_credential";
export const PUBLIC_WEB_URL = "http://127.0.0.1:3000/";

export function webStartupEnvironment() {
  // Never spread process.env: no real Clerk, Sentry, AWS, source or network
  // credentials, NODE_OPTIONS preload, proxy, cookie or debug settings cross.
  return {
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    PORT: "3000",
    HOSTNAME: "0.0.0.0",
    NODE_OPTIONS: "--dns-result-order=ipv4first",
    CLERK_SECRET_KEY: SYNTHETIC_CLERK_SETTING,
  };
}

export async function assertPublicPortFree() {
  // Refuse to accept another process's public page as this child's proof.
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", () =>
      reject(new Error("Public web probe port is already unavailable")),
    );
    probe.listen({ host: "127.0.0.1", port: 3000, exclusive: true }, () =>
      probe.close((error) => (error ? reject(error) : resolve())),
    );
  });
}

export function readPublicWebPage({ timeoutMs, signal }) {
  const boundedSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
    : AbortSignal.timeout(timeoutMs);
  return new Promise((resolve, reject) => {
    // No redirects, cookies, Authorization headers or remote hosts. This
    // request remains inside the isolated image-build network namespace.
    const request = http.get(
      PUBLIC_WEB_URL,
      {
        agent: false,
        headers: { Accept: "text/html" },
        signal: boundedSignal,
      },
      (response) => {
        let bytes = 0;
        const chunks = [];
        response.on("data", (chunk) => {
          bytes += chunk.length;
          if (bytes > 2 * 1024 * 1024) {
            request.destroy(
              new Error("Public HTML exceeds packaging probe bound"),
            );
            return;
          }
          chunks.push(chunk);
        });
        response.once("error", reject);
        response.once("end", () =>
          resolve({
            status: response.statusCode,
            contentType: response.headers["content-type"] ?? "",
            html: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    request.once("error", reject);
  });
}

export function verifyPublicWebPage(page) {
  assert.equal(
    page.status,
    200,
    "Public web packaging response must be HTTP 200",
  );
  assert.match(
    page.contentType,
    /^text\/html(?:;|$)/i,
    "Expected public HTML response",
  );
  assert.ok(
    typeof page.html === "string" &&
      Buffer.byteLength(page.html) <= 2 * 1024 * 1024,
  );
  assert.match(page.html, /<html(?:\s|>)/i, "Expected rendered HTML document");
  assert.match(page.html, /Vaettir/i, "Expected Vaettir public page identity");
}

async function stopOwnedChild(child, closed, shutdownTimeoutMs) {
  if (closed()) return;
  const waitForClose = async () => {
    if (closed()) return true;
    let timer;
    let listener;
    try {
      return await new Promise((resolve) => {
        listener = () => resolve(true);
        child.once("close", listener);
        timer = setTimeout(() => resolve(false), shutdownTimeoutMs);
      });
    } finally {
      clearTimeout(timer);
      child.removeListener("close", listener);
    }
  };
  child.kill("SIGTERM");
  if (await waitForClose()) return;
  child.kill("SIGKILL");
  assert.equal(
    await waitForClose(),
    true,
    "Owned packaging server did not stop within its bound",
  );
}

export async function checkWebStartup({
  spawnImpl = spawn,
  requestImpl = readPublicWebPage,
  portCheck = assertPublicPortFree,
  cwd = "/app",
  startupTimeoutMs = 30_000,
  requestTimeoutMs = 1_000,
  retryDelayMs = 250,
  shutdownTimeoutMs = 2_000,
  signal,
} = {}) {
  for (const [value, maximum] of [
    [startupTimeoutMs, 60_000],
    [requestTimeoutMs, 2_000],
    [retryDelayMs, 1_000],
    [shutdownTimeoutMs, 5_000],
  ])
    assert.ok(
      Number.isInteger(value) && value > 0 && value <= maximum,
      "Invalid packaging probe time bound",
    );
  await portCheck();
  const child = spawnImpl(process.execPath, ["apps/web/server.js"], {
    cwd,
    env: webStartupEnvironment(),
    stdio: "ignore",
    shell: false,
    windowsHide: true,
  });
  let closed = false;
  let failure = null;
  const onClose = () => {
    closed = true;
  };
  const onError = () => {
    failure = new Error("Packaged web server could not start");
  };
  const onExit = () => {
    failure = new Error("Packaged web server exited before public acceptance");
  };
  child.once("close", onClose);
  child.once("error", onError);
  child.once("exit", onExit);
  const deadline = Date.now() + startupTimeoutMs;
  try {
    while (Date.now() < deadline) {
      if (signal?.aborted)
        throw new Error("Public web packaging probe cancelled");
      if (
        failure ||
        closed ||
        child.exitCode !== null ||
        child.signalCode !== null
      )
        throw failure ?? new Error("Packaged web server is not running");
      let page;
      try {
        page = await requestImpl({
          timeoutMs: Math.max(
            1,
            Math.min(requestTimeoutMs, deadline - Date.now()),
          ),
          signal,
        });
      } catch (error) {
        if (signal?.aborted)
          throw new Error("Public web packaging probe cancelled", {
            cause: error,
          });
        if (!["ECONNREFUSED", "ECONNRESET", "ABORT_ERR"].includes(error?.code))
          throw error;
        await new Promise((resolve) =>
          setTimeout(
            resolve,
            Math.min(retryDelayMs, Math.max(1, deadline - Date.now())),
          ),
        );
        continue;
      }
      verifyPublicWebPage(page);
      if (
        failure ||
        closed ||
        child.exitCode !== null ||
        child.signalCode !== null
      )
        throw (
          failure ??
          new Error("Packaged web server exited during public acceptance")
        );
      return {
        publicStatus: 200,
        renderedVaettirHtml: true,
        syntheticSdkSetting: true,
        inheritedCredentials: false,
        authenticatedAcceptance: false,
        providerAcceptance: false,
      };
    }
    throw new Error("Public web startup exceeded its bounded deadline");
  } finally {
    try {
      await stopOwnedChild(child, () => closed, shutdownTimeoutMs);
    } finally {
      child.removeListener("close", onClose);
      child.removeListener("error", onError);
      child.removeListener("exit", onExit);
    }
  }
}

export function assertOfflineImageRuntime({
  platform = process.platform,
  uid = process.getuid?.(),
  exists = existsSync,
} = {}) {
  assert.equal(platform, "linux", "Run only inside the Linux web image build");
  assert.equal(uid, 1001, "Run as the existing nextjs runtime user");
  assert.ok(
    exists("/.dockerenv") && exists("/app/apps/web/server.js"),
    "Refuse public startup checks outside the packaged image",
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cancel = new AbortController();
  const onCancel = () => cancel.abort();
  process.once("SIGINT", onCancel);
  process.once("SIGTERM", onCancel);
  try {
    assert.deepEqual(process.argv.slice(2), ["--image-build"]);
    assertOfflineImageRuntime();
    console.log(
      "Offline web public cold-start packaging verified: " +
        JSON.stringify(await checkWebStartup({ signal: cancel.signal })),
    );
  } catch {
    console.error(
      "Offline web public cold-start packaging failed; no real credentials, customer data or server output logged.",
    );
    process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", onCancel);
    process.removeListener("SIGTERM", onCancel);
  }
}
