import { workspaceNameError } from "@vaettir/core";

export function isWorkspaceAuthHost(host: string) {
  if (host === "app.vaettir.app") return true;
  const name = host.endsWith(".vaettir.app") ? host.slice(0, -".vaettir.app".length) : "";
  return Boolean(name && !workspaceNameError(name) && host === host.toLowerCase());
}
export function workspaceRedirectOrigins(names: string | undefined) {
  return ["https://app.vaettir.app", ...(names ?? "").split(",").map(s => s.trim())
    .filter(s => s && !workspaceNameError(s)).map(s => `https://${s}.vaettir.app`)];
}
// Only used by Next's middleware. The provider selects its satellite from the
// actual browser URL; the server additionally verifies the edge attestation.
export async function verifiedWorkspaceWebHost(request: { headers: Headers; method: string; url: string }, secret: string | undefined) {
  const host = request.headers.get("x-vaettir-host");
  const forwarded = request.headers.get("x-forwarded-host");
  if (!host) {
    if (forwarded && isWorkspaceAuthHost(forwarded)) throw new Error("Workspace ingress required");
    return null;
  }
  const time = request.headers.get("x-vaettir-time") ?? "";
  const signature = request.headers.get("x-vaettir-signature") ?? "";
  if (!isWorkspaceAuthHost(host) || !secret || secret.length < 64 || !/^\d{13}$/.test(time)
      || Math.abs(Date.now() - Number(time)) > 30_000 || !/^[a-f0-9]{64}$/.test(signature))
    throw new Error("Invalid workspace ingress");
  const url = new URL(request.url);
  const path = (url.pathname + url.search).replace(/^\/api(?=\/)/, "");
  const message = ["vaettir-domain-v1", time, request.method.toUpperCase(), host, path].join("\n");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const bytes = Uint8Array.from(signature.match(/../g)!, x => parseInt(x, 16));
  if (!(await crypto.subtle.verify("HMAC", key, bytes, new TextEncoder().encode(message))))
    throw new Error("Invalid workspace ingress");
  return host;
}
