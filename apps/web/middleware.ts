import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import type { NextFetchEvent, NextRequest } from "next/server";
import { verifiedWorkspaceWebHost } from "./lib/workspace-auth";
import { verifiedWorkspaceClerkRequest } from "./lib/workspace-clerk-request";
import { authReturnUrl, isBrowserDocument, LEGACY_APPLICATION_ORIGIN } from "./lib/auth-return";
import { legacyAuthDocumentDestination, PRIMARY_AUTH_ORIGIN, workspaceClerkConfiguration } from "./lib/clerk-auth-domain";

// /share is a deliberately public, token-gated preview surface (see
// requirements.getSharedSummary's own comment on why) - a Jira/Linear
// unfurl bot fetching a pasted link has no way to authenticate as a real
// Vaettir session, so the page itself must be reachable without one. The
// unguessable share token is the entire access control, not this route
// being public.
const isPublicRoute = createRouteMatcher(["/", "/sign-in(.*)", "/sign-up(.*)", "/share(.*)", "/beta-guide(.*)", "/google-sheets-privacy"]);

const handleClerk = clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    // TLS terminates before Next. Clerk's inferred request URL may therefore
    // use HTTP. Pin only the browser return URL; do not trust forwarded hosts,
    // weaken auth.protect, alter API errors or intercept pending session tasks.
    if (isBrowserDocument(req) && !/^\/(api|trpc)(\/|$)/.test(req.nextUrl.pathname)) {
      const session = await auth();
      if (!session.isAuthenticated && session.sessionStatus !== "pending") {
        const production = process.env.NODE_ENV === "production";
        const workspaceHost = process.env.NEXT_PUBLIC_VAETTIR_WORKSPACE_AUTH_ENABLED === "1"
          ? await verifiedWorkspaceWebHost(req, process.env.VAETTIR_DOMAIN_INGRESS_SECRET) : null;
        const origin = workspaceHost ? `https://${workspaceHost}` :
          process.env.NEXT_PUBLIC_VAETTIR_PRIMARY_AUTH_ENABLED === "1" ? PRIMARY_AUTH_ORIGIN :
            process.env.VAETTIR_PUBLIC_ORIGIN ?? (production ? LEGACY_APPLICATION_ORIGIN : "http://localhost:3000");
        return session.redirectToSignIn({ returnBackUrl: authReturnUrl(req.nextUrl, origin, !production) });
      }
    }
    await auth.protect();
  }
}, async req => {
  if (process.env.NEXT_PUBLIC_VAETTIR_WORKSPACE_AUTH_ENABLED !== "1") return {};
  const host = await verifiedWorkspaceWebHost(req, process.env.VAETTIR_DOMAIN_INGRESS_SECRET);
  const primary = process.env.NEXT_PUBLIC_VAETTIR_PRIMARY_AUTH_ENABLED === "1";
  // CloudFront replaces the retired viewer Host at the origin. Primary sign-in
  // configuration is application-wide; only customer returns require attestation.
  if (!host && !primary) return {};
  return workspaceClerkConfiguration(host, primary,
    process.env.NEXT_PUBLIC_VAETTIR_ACTIVE_WORKSPACE_NAMES);
});

export default async function middleware(request: NextRequest, event: NextFetchEvent) {
  const clerkRequest = await verifiedWorkspaceClerkRequest(
    request,
    process.env.NEXT_PUBLIC_VAETTIR_WORKSPACE_AUTH_ENABLED === "1",
    process.env.VAETTIR_DOMAIN_INGRESS_SECRET,
  );
  if (process.env.NEXT_PUBLIC_VAETTIR_PRIMARY_AUTH_ENABLED === "1") {
    const host = await verifiedWorkspaceWebHost(request, process.env.VAETTIR_DOMAIN_INGRESS_SECRET);
    try {
      const destination = legacyAuthDocumentDestination(request, host, process.env.NEXT_PUBLIC_VAETTIR_ACTIVE_WORKSPACE_NAMES);
      if (destination) return new Response(null, { status: 307, headers: {
        Location: destination, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
      } });
    } catch {
      return new Response("Invalid sign-in return.", { status: 400, headers: { "Cache-Control": "no-store" } });
    }
  }
  const response = await handleClerk(clerkRequest, event);
  // Clerk materializes thrown sign-in redirects outside the auth callback.
  // Opaque setup returns need these controls even on the retired proxy host.
  if (response && isBrowserDocument(request) && !/^\/(api|trpc)(\/|$)/.test(request.nextUrl.pathname)
      && response.status >= 300 && response.status < 400) {
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)", "/(api|trpc)(.*)", "/__clerk/:path*"],
};
