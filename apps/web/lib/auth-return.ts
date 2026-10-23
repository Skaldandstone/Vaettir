// This is a server-trusted origin, never a Host/X-Forwarded-Host or query value.
// Customer-host routing must pass its independently verified HTTPS origin.
export const LEGACY_APPLICATION_ORIGIN = "https://vaettir.skaldandstone.com";

export function authReturnUrl(
  path: { pathname: string; search: string },
  trustedOrigin: string,
  allowLocalHttp = false,
): string {
  const target = new URL(trustedOrigin);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname);
  if (
    target.username || target.password || target.pathname !== "/" ||
    target.search || target.hash ||
    (target.protocol !== "https:" && !(allowLocalHttp && local && target.protocol === "http:"))
  ) throw new Error("The application sign-in return origin is not configured safely.");
  // Assign path components, rather than resolving a caller path against a base:
  // a leading // or an encoded slash must never replace the trusted authority.
  target.pathname = path.pathname;
  target.search = path.search;
  return target.href;
}

export function isBrowserDocument(request: { method: string; headers: Headers }): boolean {
  if (request.method !== "GET") return false;
  const destination = request.headers.get("sec-fetch-dest");
  return destination === "document" || destination === "iframe" ||
    (!destination && (request.headers.get("accept") ?? "").includes("text/html"));
}
