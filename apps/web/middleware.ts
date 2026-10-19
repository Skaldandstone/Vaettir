import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import type { NextFetchEvent, NextRequest } from "next/server";
import { verifiedWorkspaceWebHost } from "./lib/workspace-auth";
import { verifiedWorkspaceClerkRequest } from "./lib/workspace-clerk-request";
import { authReturnUrl, isBrowserDocument, LEGACY_APPLICATION_ORIGIN } from "./lib/auth-return";

// /share is a deliberately public, token-gated preview surface (see
// requirements.getSharedSummary's own comment on why) - a Jira/Linear
// unfurl bot fetching a pasted link has no way to authenticate as a real
// Vaettir session, so the page itself must be reachable without one. The
// unguessable share token is the entire access control, not this route
// being public.
const isPublicRoute = createRouteMatcher(["/", "/sign-in(.*)", "/sign-up(.*)", "/share(.*)", "/beta-guide(.*)"]);

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
          process.env.VAETTIR_PUBLIC_ORIGIN ?? (production ? LEGACY_APPLICATION_ORIGIN : "http://localhost:3000");
        return session.redirectToSignIn({ returnBackUrl: authReturnUrl(req.nextUrl, origin, !production) });
      }
    }
    await auth.protect();
  }
}, async req => {
  if (process.env.NEXT_PUBLIC_VAETTIR_WORKSPACE_AUTH_ENABLED !== "1") return {};
  const host = await verifiedWorkspaceWebHost(req, process.env.VAETTIR_DOMAIN_INGRESS_SECRET);
  if (!host) return {};
  return {
    isSatellite: true,
    domain: "vaettir.app",
    signInUrl: "https://vaettir.skaldandstone.com/sign-in",
    signUpUrl: "https://vaettir.skaldandstone.com/sign-up",
  };
});

export default async function middleware(request: NextRequest, event: NextFetchEvent) {
  const clerkRequest = await verifiedWorkspaceClerkRequest(
    request,
    process.env.NEXT_PUBLIC_VAETTIR_WORKSPACE_AUTH_ENABLED === "1",
    process.env.VAETTIR_DOMAIN_INGRESS_SECRET,
  );
  return handleClerk(clerkRequest, event);
}

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)", "/(api|trpc)(.*)", "/__clerk/:path*"],
};
