import { authReturnUrl, LEGACY_APPLICATION_ORIGIN } from "./auth-return";
import { isWorkspaceAuthHost, workspaceRedirectOrigins } from "./workspace-auth";

export const PRIMARY_AUTH_ORIGIN = "https://app.vaettir.app";

// This switch is baked into the web artifact. Enable only in a reviewed,
// coordinated same-instance Clerk domain/publishable-key release.
export function workspaceClerkConfiguration(host: string | null, primary: boolean, names?: string) {
  const allowedRedirectOrigins = workspaceRedirectOrigins(names);
  if (primary) return {
    allowedRedirectOrigins,
    isSatellite: false as const,
    signInUrl: PRIMARY_AUTH_ORIGIN + "/sign-in",
    signUpUrl: PRIMARY_AUTH_ORIGIN + "/sign-up",
  };
  return {
    allowedRedirectOrigins,
    ...(host && isWorkspaceAuthHost(host) ? {
      isSatellite: true as const,
      domain: "vaettir.app",
      signInUrl: LEGACY_APPLICATION_ORIGIN + "/sign-in",
      signUpUrl: LEGACY_APPLICATION_ORIGIN + "/sign-up",
    } : {}),
  };
}

export function legacyAuthDocumentDestination(
  request: { method: string; headers: Headers; url: string },
  verifiedWorkspaceHost: string | null,
  names?: string,
): string | null {
  // No API, OAuth callback, webhook, write or bearer-bearing request enters
  // document routing. In particular, Forge continues to use direct JSON APIs.
  if (verifiedWorkspaceHost || !["GET", "HEAD"].includes(request.method)
      || request.headers.has("authorization")) return null;
  const destination = request.headers.get("sec-fetch-dest");
  if (!(destination === "document" || destination === "iframe"
      || (!destination && (request.headers.get("accept") ?? "").includes("text/html")))) return null;
  const url = new URL(request.url);
  if (!/^\/(?:$|(?:projects|dashboard|onboarding|settings|account|sign-in|sign-up|share|beta-guide)(?:\/|$)|integrations\/atlassian\/connect(?:\/|$))/.test(url.pathname)) return null;
  const result = new URL(authReturnUrl(url, PRIMARY_AUTH_ORIGIN));
  if (/^\/sign-(?:in|up)(?:\/|$)/.test(url.pathname)) {
    const allowed = new Set(workspaceRedirectOrigins(names));
    for (const key of ["redirect_url", "redirectUrl", "after_sign_in_url", "after_sign_up_url"]) {
      const values = result.searchParams.getAll(key);
      if (values.length > 1) throw new Error("Ambiguous sign-in return.");
      if (!values.length || !values[0]) continue;
      const back = new URL(values[0], LEGACY_APPLICATION_ORIGIN);
      if (back.username || back.password || back.protocol !== "https:") throw new Error("Invalid sign-in return.");
      if (back.origin === LEGACY_APPLICATION_ORIGIN) {
        const translated = new URL(authReturnUrl(back, PRIMARY_AUTH_ORIGIN));
        translated.hash = back.hash;
        result.searchParams.set(key, translated.href);
      } else if (!allowed.has(back.origin)) throw new Error("Invalid sign-in return.");
    }
  }
  return result.href;
}
