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
    return new Response(calls === 1 ? "healthy" : "workspace", { headers: { "Cache-Control": "public, max-age=86400", "X-Vaettir-Workspace-Verified": "tenant-v1" } });
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
  assert.equal((await handleRequest(new Request("https://synthetic-team.vaettir.app/"), env, async () => new Response("old API healthy"))).status, 503);
  assert.equal((await handleRequest(new Request("https://unknown-team.vaettir.app/"), { ...env, ENABLED_WORKSPACE_HOSTS: "*" }, async () => new Response("", { status: 404 }))).status, 404);
  assert.equal((await handleRequest(new Request("https://synthetic-team.vaettir.app/api/trpc", { headers: { origin: "https://other-team.vaettir.app" } }), env)).status, 403);
  let call = 0;
  const response = await handleRequest(new Request("https://synthetic-team.vaettir.app/projects"), env, async () => {
    call++; return call === 1 ? new Response("ok", { headers: { "X-Vaettir-Workspace-Verified": "tenant-v1" } }) : new Response(null, { status: 302, headers: { Location: "https://evil.test/" } });
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

const workspace = "https://synthetic-team.vaettir.app";
function handshake(back = workspace + "/projects?__clerk_synced=false") {
  const url = new URL("https://clerk.vaettir.app/v1/client/handshake");
  url.searchParams.set("redirect_url", back);
  url.searchParams.set("format", "nonce");
  return url;
}
async function redirectResponse(location, { method = "GET", path = "/projects?__clerk_synced=false", document = true } = {}) {
  let calls = 0, canceled = false;
  const response = await handleRequest(new Request(workspace + path, {
    method, headers: document ? { "sec-fetch-dest": "document" } : {},
  }), env, async () => {
    if (++calls === 1) return new Response("ok", { headers: { "X-Vaettir-Workspace-Verified": "tenant-v1" } });
    const headers = new Headers({ Location: String(location), "Cache-Control": "public, max-age=3600" });
    headers.append("Set-Cookie", "fixture_a=synthetic; Secure; HttpOnly");
    headers.append("Set-Cookie", "fixture_b=synthetic; Secure; HttpOnly");
    return new Response(new ReadableStream({ cancel() { canceled = true; } }), { status: 307, headers });
  });
  return { response, canceled };
}
test("allows the exact Clerk satellite document handshake and preserves cookie directives without caching", async () => {
  const location = handshake();
  const { response } = await redirectResponse(location);
  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), location.href);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.deepEqual(response.headers.getSetCookie(), ["fixture_a=synthetic; Secure; HttpOnly", "fixture_b=synthetic; Secure; HttpOnly"]);
  await response.body.cancel();
});
test("denies handshake returns to HTTP, another workspace, another path, credentials, fragments or ambiguous values", async () => {
  for (const back of [
    "http://synthetic-team.vaettir.app/projects", "https://other-team.vaettir.app/projects",
    "https://evil.test/projects", workspace + "/other", workspace + "/projects#fragment",
    "https://user:synthetic@synthetic-team.vaettir.app/projects", "/projects", "",
  ]) {
    const { response, canceled } = await redirectResponse(handshake(back));
    assert.equal(response.status, 502, back);
    assert.equal(response.headers.get("location"), null);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(canceled, true);
  }
  const duplicate = handshake();duplicate.searchParams.append("redirect_url", "https://evil.test/projects");
  assert.equal((await redirectResponse(duplicate)).response.status, 502);
  const missing = handshake();missing.searchParams.delete("redirect_url");
  assert.equal((await redirectResponse(missing)).response.status, 502);
});
test("rejects other provider navigation and non-document, write or API handshake redirects", async () => {
  for (const location of [
    handshake().href.replace("clerk.vaettir.app", "clerk.evil.test"),
    handshake().href.replace("/v1/client/handshake", "/v1/client/other"),
    handshake().href.replace("https://", "http://"),
    handshake().href.replace("https://", "https://user:synthetic@"),
    handshake().href + "#fragment",
  ]) assert.equal((await redirectResponse(location)).response.status, 502);
  assert.equal((await redirectResponse(handshake(), { document: false })).response.status, 502);
  assert.equal((await redirectResponse(handshake(), { method: "POST" })).response.status, 502);
  for (const path of ["/api", "/api/trpc", "/trpc"]) {
    assert.equal((await redirectResponse(handshake(workspace + path), { path })).response.status, 502);
  }
});
test("keeps primary sign-in returns workspace-bound, including duplicate redirect parameters", async () => {
  const location = new URL("https://vaettir.skaldandstone.com/sign-in");
  location.searchParams.set("redirect_url", workspace + "/projects?__clerk_synced=false");
  const accepted = (await redirectResponse(location)).response;
  assert.equal(accepted.status, 307);await accepted.body.cancel();
  location.searchParams.append("redirect_url", "https://other-team.vaettir.app/projects");
  assert.equal((await redirectResponse(location)).response.status, 502);
});
