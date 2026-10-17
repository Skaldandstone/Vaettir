import test from "node:test";
import assert from "node:assert/strict";
import worker, { handleRequest } from "./worker.mjs";
import { createHmac } from "node:crypto";
const secret = "synthetic-edge-fixture-".repeat(4);
const env = {
  ASSETS: { fetch: async () => new Response("Public Vaettir homepage") },
  VAETTIR_APP_ORIGIN: "https://d35bt2repnvk6t.cloudfront.net",
  VAETTIR_DOMAIN_INGRESS_SECRET: secret,
  ENABLED_WORKSPACE_HOSTS: "synthetic-team.vaettir.app",
};
test("serves marketing through the deployed fetch signature without enabling app hosts", async () => {
  assert.equal(await (await worker.fetch(new Request("https://vaettir.app/"), env, {})).text(), "Public Vaettir homepage");
  assert.equal((await handleRequest(new Request("https://app.vaettir.app/"), env)).status, 404);
  assert.equal((await handleRequest(new Request("https://atwist.vaettir.app/"), env)).status, 404);
});
test("strips spoofed forwarding/staff headers, signs the exact host/target and disables private caching", async () => {
  let calls = 0;
  const upstream = async (request, options) => {
    calls++;
    assert.equal(request.redirect, "manual");
    assert.equal(options.cf.cacheTtl, 0);
    assert.equal(request.headers.get("x-staff-token"), null);
    assert.equal(request.headers.get("forwarded"), null);
    assert.equal(request.headers.get("x-forwarded-host"), "synthetic-team.vaettir.app");
    const timestamp = request.headers.get("x-vaettir-time");
    const url = new URL(request.url);
    const message = ["vaettir-domain-v1", timestamp, "GET", "synthetic-team.vaettir.app", (url.pathname + url.search).replace(/^\/api(?=\/)/, "")].join("\n");
    assert.equal(request.headers.get("x-vaettir-signature"), createHmac("sha256", secret).update(message).digest("hex"));
    return new Response(calls === 1 ? "healthy" : "workspace", { headers: { "Cache-Control": "public, max-age=86400" } });
  };
  const response = await handleRequest(new Request("https://synthetic-team.vaettir.app/projects", {
    headers: { "x-vaettir-host": "evil.vaettir.app", "x-staff-token": "spoof", forwarded: "host=evil.vaettir.app" },
  }), env, upstream);
  assert.equal(calls, 2);
  assert.equal(await response.text(), "workspace");
  assert.equal(response.headers.get("cache-control"), "no-store");
});
test("denies unknown claims, unapproved hosts, origin spoofing and cross-origin upstream redirects", async () => {
  assert.equal((await handleRequest(new Request("https://synthetic-team.vaettir.app/"), { ...env, VAETTIR_APP_ORIGIN: "malformed" })).status, 503);
  assert.equal((await handleRequest(new Request("https://unknown-team.vaettir.app/"), env)).status, 404);
  assert.equal((await handleRequest(new Request("https://synthetic-team.vaettir.app/"), env, async () => new Response("", { status: 404 }))).status, 404);
  assert.equal((await handleRequest(new Request("https://synthetic-team.vaettir.app/api/trpc", { headers: { origin: "https://other-team.vaettir.app" } }), env)).status, 403);
  let call = 0;
  const response = await handleRequest(new Request("https://synthetic-team.vaettir.app/projects"), env, async () => {
    call++; return call === 1 ? new Response("ok") : new Response(null, { status: 302, headers: { Location: "https://evil.test/" } });
  });
  assert.equal(response.status, 502);
});
test("only forwards bounded Vaettir invitation requests with a validated browser origin", async () => {
  let calls = 0;
  const withStudio = { ...env, STUDIO: { fetch: async request => {
    calls++; assert.equal(request.headers.get("cookie"), null);
    assert.equal(request.headers.get("authorization"), null);
    assert.equal(request.headers.get("origin"), "https://skaldandstone.com");
    return Response.json({ ok: true });
  } } };
  const request = (body, origin = "https://vaettir.app") => new Request("https://vaettir.app/api/access-requests", {
    method: "POST", headers: { Origin: origin, "Content-Type": "application/json", Cookie: "private", Authorization: "Bearer private" }, body,
  });
  assert.equal((await handleRequest(request('{"product":"vaettir"}'), withStudio)).status, 200);
  assert.equal((await handleRequest(request('{"product":"vaettir"}', "https://evil.test"), withStudio)).status, 403);
  assert.equal((await handleRequest(request('{"product":"other"}'), withStudio)).status, 400);
  assert.equal((await handleRequest(request(JSON.stringify({ product: "vaettir", note: "x".repeat(9000) })), withStudio)).status, 413);
  assert.equal(calls, 1);
});
