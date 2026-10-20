const ROOT = "vaettir.app";
const ENTRY = "app.vaettir.app";
const reserved = new Set(["www", "api", "auth", "clerk", "admin", "support", "status", "mail", "cdn", "assets", "static", "docs", "billing", "login"]);
const privateHeaders = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
const denied = (status = 404) => new Response("Workspace unavailable.", { status, headers: privateHeaders });
function customerName(host) {
  if (!host.endsWith("." + ROOT)) return null;
  const name = host.slice(0, -(ROOT.length + 1));
  return /^[a-z][a-z0-9-]{1,61}[a-z0-9]$/.test(name) && !name.includes("--") && !reserved.has(name) ? name : null;
}
function allowedRedirect(request, current, destination) {
  if (destination.username || destination.password) return false;
  if (destination.origin === current.origin) return true;
  const pageGet = request.method === "GET" && !/^\/(api|trpc)(\/|$)/.test(current.pathname);
  if (!pageGet) return false;
  if (["https://vaettir.skaldandstone.com", "https://app.vaettir.app"].includes(destination.origin)
      && ["/sign-in", "/sign-up"].includes(destination.pathname)) {
    for (const key of ["redirect_url", "redirectUrl", "after_sign_in_url", "after_sign_up_url"]) {
      for (const value of destination.searchParams.getAll(key)) {
        if (value) {
          const back = new URL(value, current);
          if (back.origin !== current.origin || back.username || back.password) return false;
        }
      }
    }
    return true;
  }
  // The reviewed production satellite uses this exact Frontend API endpoint.
  // Never allow arbitrary provider navigation or a return to another tenant.
  if (request.headers.get("sec-fetch-dest") !== "document"
      || destination.origin !== "https://clerk.vaettir.app"
      || destination.pathname !== "/v1/client/handshake" || destination.hash) return false;
  const returns = destination.searchParams.getAll("redirect_url");
  if (returns.length !== 1 || !returns[0]) return false;
  let back;
  try { back = new URL(returns[0]); } catch { return false; }
  return back.origin === current.origin && back.pathname === current.pathname
    && !back.username && !back.password && !back.hash;
}
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
  headers.set("x-vaettir-signature", [...bytes].map(b => b.toString(16).padStart(2, "0")).join(""));
  headers.set("x-forwarded-host", host);
  return headers;
}
export async function handleRequest(request, env, upstreamFetch = fetch) {
  const url = new URL(request.url);
  if (url.protocol !== "https:") return denied(400);
  if (url.hostname === "www." + ROOT)
    return new Response(null, { status: 308, headers: { Location: "https://" + ROOT + url.pathname, ...privateHeaders } });
  if (url.hostname === ROOT) {
    if (url.pathname.startsWith("/api/")) {
      // The invitation flow is the ONLY public write forwarded to Studio.
      if (url.pathname !== "/api/access-requests" || request.method !== "POST" || !env.STUDIO
          || request.headers.get("origin") !== "https://" + ROOT
          || !request.headers.get("content-type")?.startsWith("application/json"))
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
          if (total > 8192) { await reader.cancel(); return denied(413); }
          chunks.push(next.value);
        }
        const body = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
        const data = JSON.parse(new TextDecoder().decode(body));
        if (data.product !== "vaettir") return denied(400);
        const forwarded = new Request("https://skaldandstone.com/api/access-requests", {
          method: "POST", headers: { "Content-Type": "application/json", Origin: "https://skaldandstone.com" },
          body: JSON.stringify(data),
        });
        const response = await env.STUDIO.fetch(forwarded);
        return new Response(response.body, { status: response.status, headers: { "Content-Type": "application/json", ...privateHeaders } });
      } catch { return denied(400); }
    }
    if (!["GET", "HEAD"].includes(request.method)) return denied(405);
    return env.ASSETS.fetch(request);
  }
  if (url.hostname !== ENTRY && !customerName(url.hostname)) return denied();
  if (url.pathname.startsWith("/api/") && request.headers.has("origin") && request.headers.get("origin") !== url.origin)
    return denied(403);
  // A deployment starts with public marketing only. No app hostname becomes
  // active until the explicit sandbox allowlist and origin are reviewed.
  const allowed = new Set((env.ENABLED_WORKSPACE_HOSTS ?? "").split(",").map(s => s.trim()).filter(Boolean));
  if (!(allowed.has(url.hostname) || allowed.has("*")) || !env.VAETTIR_DOMAIN_INGRESS_SECRET || env.VAETTIR_DOMAIN_INGRESS_SECRET.length < 64)
    return denied();
  let origin;
  try { origin = new URL(env.VAETTIR_APP_ORIGIN ?? ""); } catch { return denied(503); }
  if (origin.protocol !== "https:" || !/^[a-z0-9]+\.cloudfront\.net$/.test(origin.hostname)
      || origin.pathname !== "/" || origin.search || origin.username || origin.password || origin.port) return denied(503);
  try {
    {
      const probe = new Request(request.url, { method: "GET" });
      const headers = await signatureHeaders(probe, env.VAETTIR_DOMAIN_INGRESS_SECRET, url.hostname, "/api/health");
      headers.delete("authorization"); headers.delete("cookie");
      const result = await upstreamFetch(new Request(new URL("/api/health", origin), { headers, redirect: "manual" }), { cf: { cacheTtl: 0, cacheEverything: false } });
      const expected = url.hostname === ENTRY ? "entry-v1" : "tenant-v1";
      if (!result.ok || result.headers.get("x-vaettir-workspace-verified") !== expected) {
        await result.body?.cancel(); return denied(result.status === 404 ? 404 : 503);
      }
      await result.body?.cancel();
    }
    const headers = await signatureHeaders(request, env.VAETTIR_DOMAIN_INGRESS_SECRET, url.hostname, url.pathname + url.search);
    const target = new URL(url.pathname + url.search, origin);
    const response = await upstreamFetch(new Request(target, { method: request.method, headers,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body, redirect: "manual",
      ...(request.body ? { duplex: "half" } : {}) }), { cf: { cacheTtl: 0, cacheEverything: false } });
    const out = new Response(response.body, response);
    out.headers.delete("x-vaettir-workspace-verified");
    for (const [key, value] of Object.entries(privateHeaders)) out.headers.set(key, value);
    // Keep external authentication navigation bound to the requesting workspace.
    const location = out.headers.get("location");
    if (location) {
      const destination = new URL(location, url);
      if (!allowedRedirect(request, url, destination)) {
        await out.body?.cancel();
        return denied(502);
      }
    }
    return out;
  } catch { return denied(503); }
}
export default { fetch(request, env) { return handleRequest(request, env); } };
