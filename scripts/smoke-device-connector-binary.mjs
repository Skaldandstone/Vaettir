import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { resolve } from "node:path";

const executable = process.argv[2];
if (!executable) throw new Error("Provide the standalone connector executable path");
const reservation = createServer();
await new Promise(resolve => reservation.listen(0, "127.0.0.1", resolve));
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const pairingCode = randomBytes(6).toString("hex").toUpperCase();
const child = spawn(resolve(executable), ["--port", String(port), "--pairing-code", pairingCode], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_OPTIONS: "" } });
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Connector startup timed out")), 15000);
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("exit", code => { clearTimeout(timer); reject(new Error(`Connector exited: ${code}`)); });
    child.stdout.on("data", chunk => { if (chunk.toString().includes("Pairing code:")) { clearTimeout(timer); resolve(); } });
  });
  const url = `http://127.0.0.1:${port}/health`;
  const validHeaders = { Origin: "https://vaettir.skaldandstone.com", "x-vaettir-pairing-code": pairingCode };
  const health = await fetch(url, { headers: validHeaders });
  assert.equal(health.status, 200);
  assert.equal((await health.json()).connected, true);
  assert.equal((await fetch(url, { headers: { ...validHeaders, "x-vaettir-pairing-code": "WRONG" } })).status, 401);
  assert.equal((await fetch(url, { headers: { ...validHeaders, Origin: "https://untrusted.example" } })).status, 403);
  console.log("Standalone binary smoke passed: startup, paired health, bad pairing rejection, foreign-origin rejection. No device capture performed.");
} finally {
  child.kill();
}
