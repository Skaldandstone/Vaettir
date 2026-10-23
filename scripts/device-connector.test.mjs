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

test("customer launcher origin is admitted exactly without granting sibling tenant access", async () => {
  for (const [index, origin] of ["https://atwist.vaettir.app", "https://skaldandstone.vaettir.app", "https://app.vaettir.app", "https://future-customer.vaettir.app"].entries()) {
    const customerUrl = `http://127.0.0.1:${port + 1 + index}`;
    const child = spawn(process.execPath, ["apps/web/public/connectors/vaettir-device-connector.mjs", "--port", String(port + 1 + index), "--pairing-code", "TESTCODE", "--origin", origin], { stdio: ["ignore", "pipe", "pipe"] });
    try {
      await waitForReady(child);
      const preflight = await fetch(`${customerUrl}/health`, { method: "OPTIONS", headers: { origin, "access-control-request-method": "GET", "access-control-request-headers": "x-vaettir-pairing-code" } });
      assert.equal(preflight.status, 204);
      assert.equal(preflight.headers.get("access-control-allow-origin"), origin);
      assert.equal((await fetch(`${customerUrl}/health`, { headers: { origin, "x-vaettir-pairing-code": "WRONG" } })).status, 401);
      const paired = await fetch(`${customerUrl}/health`, { headers: { origin, "x-vaettir-pairing-code": "TESTCODE" } });
      assert.equal(paired.status, 200);
      assert.deepEqual(await paired.json(), { connected: true, version: 2 });
      for (const foreign of ["https://other-customer.vaettir.app", "https://vaettir.skaldandstone.com", "https://atwist.vaettir.app.attacker.example", "https://attacker.example", "null"]) {
        const refused = await fetch(`${customerUrl}/health`, { headers: { origin: foreign, "x-vaettir-pairing-code": "TESTCODE" } });
        assert.equal(refused.status, 403);
        assert.equal(refused.headers.get("access-control-allow-origin"), null);
      }
      assert.equal((await fetch(`${customerUrl}/health`, { headers: { "x-vaettir-pairing-code": "TESTCODE" } })).status, 403);
      assert.equal((await fetch(`${customerUrl}/devices?source=android`, { headers: { origin: "https://other-customer.vaettir.app", "x-vaettir-pairing-code": "TESTCODE" } })).status, 403);
    } finally {
      child.kill();
      if (child.exitCode === null) await once(child, "exit");
    }
  }
});

test("invalid explicit origins refuse startup before opening a helper listener", async () => {
  for (const origin of ["https://attacker.example", "https://atwist.vaettir.app.attacker.example", "https://nested.atwist.vaettir.app", "https://atwist.vaettir.app:8443", "https://atwist.vaettir.app/", "https://user@atwist.vaettir.app", "http://atwist.vaettir.app", "http://localhost:4774"]) {
    const child = spawn(process.execPath, ["apps/web/public/connectors/vaettir-device-connector.mjs", "--port", String(port + 5), "--pairing-code", "TESTCODE", "--origin", origin], { stdio: ["ignore", "pipe", "pipe"] });
    let error = "";
    child.stderr.setEncoding("utf8"); child.stderr.on("data", chunk => { error += chunk; });
    const [code] = await once(child, "exit");
    assert.notEqual(code, 0);
    assert.match(error, /--origin must be an exact supported/);
  }
});
