var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.mjs
var ROOT = "vaettir.app";
var ENTRY = "app.vaettir.app";
var reserved = /* @__PURE__ */ new Set(["www", "api", "auth", "admin", "support", "status", "mail", "cdn", "assets", "static", "docs", "billing", "login"]);
var privateHeaders = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
var denied = /* @__PURE__ */ __name((status = 404) => new Response("Workspace unavailable.", { status, headers: privateHeaders }), "denied");
function customerName(host) {
  if (!host.endsWith("." + ROOT)) return null;
  const name = host.slice(0, -(ROOT.length + 1));
  return /^[a-z][a-z0-9-]{1,61}[a-z0-9]$/.test(name) && !name.includes("--") && !reserved.has(name) ? name : null;
}
__name(customerName, "customerName");
async function signatureHeaders(request, secret, host, target) {
  const headers = new Headers(request.headers);
  for (const name of [...headers.keys()])
    if (name.startsWith("x-vaettir-") || name.startsWith("x-forwarded-") || name === "forwarded" || name.startsWith("x-staff-"))
      headers.delete(name);
  const timestamp = String(Date.now());
  const path = target.replace(/^\/api(?=\/)/, "");
  const value = ["vaettir-domain-v1", timestamp, request.method.toUpperCase(), host, path].join("\n");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
  headers.set("x-vaettir-host", host);
  headers.set("x-vaettir-time", timestamp);
  headers.set("x-vaettir-signature", [...bytes].map((b) => b.toString(16).padStart(2, "0")).join(""));
  headers.set("x-forwarded-host", host);
  return headers;
}
__name(signatureHeaders, "signatureHeaders");
async function handleRequest(request, env, upstreamFetch = fetch) {
  const url = new URL(request.url);
  if (url.protocol !== "https:") return denied(400);
  if (url.hostname === "www." + ROOT)
    return new Response(null, { status: 308, headers: { Location: "https://" + ROOT + url.pathname, ...privateHeaders } });
  if (url.hostname === ROOT) {
    if (url.pathname.startsWith("/api/")) {
      if (url.pathname !== "/api/access-requests" || request.method !== "POST" || !env.STUDIO || request.headers.get("origin") !== "https://" + ROOT || !request.headers.get("content-type")?.startsWith("application/json"))
        return denied(403);
      const reader = request.body?.getReader();
      if (!reader) return denied(400);
      let total = 0;
      const chunks = [];
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          total += next.value.byteLength;
          if (total > 8192) {
            await reader.cancel();
            return denied(413);
          }
          chunks.push(next.value);
        }
        const body = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
          body.set(chunk, offset);
          offset += chunk.byteLength;
        }
        const data = JSON.parse(new TextDecoder().decode(body));
        if (data.product !== "vaettir") return denied(400);
        const forwarded = new Request("https://skaldandstone.com/api/access-requests", {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: "https://skaldandstone.com" },
          body: JSON.stringify(data)
        });
        const response = await env.STUDIO.fetch(forwarded);
        return new Response(response.body, { status: response.status, headers: { "Content-Type": "application/json", ...privateHeaders } });
      } catch {
        return denied(400);
      }
    }
    if (!["GET", "HEAD"].includes(request.method)) return denied(405);
    return env.ASSETS.fetch(request);
  }
  if (url.hostname !== ENTRY && !customerName(url.hostname)) return denied();
  if (url.pathname.startsWith("/api/") && request.headers.has("origin") && request.headers.get("origin") !== url.origin)
    return denied(403);
  const allowed = new Set((env.ENABLED_WORKSPACE_HOSTS ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  if (!allowed.has(url.hostname) || !env.VAETTIR_DOMAIN_INGRESS_SECRET || env.VAETTIR_DOMAIN_INGRESS_SECRET.length < 64)
    return denied();
  const origin = new URL(env.VAETTIR_APP_ORIGIN ?? "");
  if (origin.protocol !== "https:" || !/^[a-z0-9]+\.cloudfront\.net$/.test(origin.hostname) || origin.pathname !== "/" || origin.search || origin.username || origin.password || origin.port) return denied(503);
  try {
    if (url.hostname !== ENTRY) {
      const probe = new Request(request.url, { method: "GET" });
      const headers2 = await signatureHeaders(probe, env.VAETTIR_DOMAIN_INGRESS_SECRET, url.hostname, "/api/health");
      headers2.delete("authorization");
      headers2.delete("cookie");
      const result = await upstreamFetch(new Request(new URL("/api/health", origin), { headers: headers2, redirect: "manual" }), { cf: { cacheTtl: 0, cacheEverything: false } });
      if (!result.ok) {
        await result.body?.cancel();
        return denied(result.status === 404 ? 404 : 503);
      }
      await result.body?.cancel();
    }
    const headers = await signatureHeaders(request, env.VAETTIR_DOMAIN_INGRESS_SECRET, url.hostname, url.pathname + url.search);
    const target = new URL(url.pathname + url.search, origin);
    const response = await upstreamFetch(new Request(target, {
      method: request.method,
      headers,
      body: ["GET", "HEAD"].includes(request.method) ? void 0 : request.body,
      redirect: "manual",
      ...request.body ? { duplex: "half" } : {}
    }), { cf: { cacheTtl: 0, cacheEverything: false } });
    const out = new Response(response.body, response);
    for (const [key, value] of Object.entries(privateHeaders)) out.headers.set(key, value);
    const location = out.headers.get("location");
    if (location) {
      const destination = new URL(location, url);
      if (destination.origin !== url.origin) return denied(502);
    }
    return out;
  } catch {
    return denied(503);
  }
}
__name(handleRequest, "handleRequest");
var worker_default = { fetch(request, env) {
  return handleRequest(request, env);
} };
export {
  worker_default as default,
  handleRequest
};
//# sourceMappingURL=worker.js.map
