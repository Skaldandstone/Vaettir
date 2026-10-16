import assert from "node:assert/strict";
import { test } from "node:test";
import { preflight } from "../scripts/preflight.mjs";
import { readFile } from "node:fs/promises";

const commit = "a".repeat(40);
const health = { healthy: true, release: { commit, verifiable: true, imageDigest: "sha256:" + "b".repeat(64) } };
const json = (body) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
const denied = (status = 403, cache = "no-store") => new Response(null, { status, headers: { "cache-control": cache } });

test("preflight pins release, sends no credential and never certifies approval", async () => {
  const paths = [];
  const result = await preflight("https://vaettir.example", commit, async (url, options) => {
    paths.push(url.pathname);
    assert.deepEqual(options.headers, { Accept: "application/json" });
    assert.equal(options.redirect, "error");
    return paths.length === 1 ? json(health) : denied();
  });
  assert.deepEqual(paths, ["/api/health/detailed", "/api/integrations/ai/v1/project-summary"]);
  assert.equal(result.readyForAdminApproval, true);
  assert.equal(result.customerApprovalVerified, false);
  assert.equal(result.installedCodexVerified, false);
});
test("unhealthy or mismatched releases stop before a gateway probe", async () => {
  for (const body of [{ ...health, healthy: false }, { ...health, release: { ...health.release, commit: "c".repeat(40) } }]) {
    let requests = 0;
    await assert.rejects(preflight("https://vaettir.example", commit, async () => { requests++; return json(body); }));
    assert.equal(requests, 1);
  }
});
test("absent gateway, outage, public success and cacheable denial never count as ready", async () => {
  for (const response of [denied(404), denied(503), denied(200), denied(403, "public")]) {
    let requests = 0;
    const result = await preflight("https://vaettir.example", commit, async () => ++requests === 1 ? json(health) : response);
    assert.equal(result.gatewayReady, false);
  }
});
test("preflight rejects credential-bearing configuration and excessive health bodies", async () => {
  await assert.rejects(preflight("https://user:secret@vaettir.example", commit, () => { throw new Error("must not fetch"); }));
  await assert.rejects(preflight("https://vaettir.example", commit, async () => new Response("x".repeat(65537), { headers: { "content-type": "application/json" } })));
});
test("server forwards only dedicated connection variables without literal secrets", async () => {
  const manifest = JSON.parse(await readFile(new URL("../mcp.json", import.meta.url), "utf8"));
  assert.deepEqual(manifest.mcpServers.vaettir.env_vars, ["VAETTIR_AI_BASE_URL", "VAETTIR_AI_TOKEN"]);
  assert.equal(manifest.mcpServers.vaettir.env, undefined);
});
