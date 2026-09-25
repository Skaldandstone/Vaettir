import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";

const port = 49774;
const baseUrl = `http://127.0.0.1:${port}`;
const allowedOrigin = "https://vaettir.skaldandstone.com";

async function waitForReady(child) {
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  const timeout = Date.now() + 5_000;
  while (!output.includes("Pairing code: TESTCODE")) {
    if (child.exitCode !== null)
      throw new Error(`Connector exited early: ${output}`);
    if (Date.now() > timeout)
      throw new Error(`Connector did not start: ${output}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

test("connector is loopback-paired and permits the production origin", async () => {
  const child = spawn(
    process.execPath,
    [
      "apps/web/public/connectors/vaettir-device-connector.mjs",
      "--port",
      String(port),
      "--pairing-code",
      "TESTCODE",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  try {
    await waitForReady(child);

    const preflight = await fetch(`${baseUrl}/health`, {
      method: "OPTIONS",
      headers: {
        origin: allowedOrigin,
        "access-control-request-private-network": "true",
      },
    });
    assert.equal(preflight.status, 204);
    assert.equal(
      preflight.headers.get("access-control-allow-origin"),
      allowedOrigin,
    );
    assert.equal(
      preflight.headers.get("access-control-allow-private-network"),
      "true",
    );

    const untrusted = await fetch(`${baseUrl}/health`, {
      headers: {
        origin: "https://attacker.example",
        "x-vaettir-pairing-code": "TESTCODE",
      },
    });
    assert.equal(untrusted.status, 403);

    const unpaired = await fetch(`${baseUrl}/health`, {
      headers: { origin: allowedOrigin, "x-vaettir-pairing-code": "WRONG" },
    });
    assert.equal(unpaired.status, 401);

    const paired = await fetch(`${baseUrl}/health`, {
      headers: { origin: allowedOrigin, "x-vaettir-pairing-code": "TESTCODE" },
    });
    assert.equal(paired.status, 200);
    assert.deepEqual(await paired.json(), { connected: true, version: 2 });
  } finally {
    child.kill();
    if (child.exitCode === null) await once(child, "exit");
  }
});
