import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { authReturnUrl, isBrowserDocument, LEGACY_APPLICATION_ORIGIN } from "./lib/auth-return";

// /share is a deliberately public, token-gated preview surface (see
// requirements.getSharedSummary's own comment on why) - a Jira/Linear
// unfurl bot fetching a pasted link has no way to authenticate as a real
// Vaettir session, so the page itself must be reachable without one. The
// unguessable share token is the entire access control, not this route
// being public.
const isPublicRoute = createRouteMatcher(["/", "/sign-in(.*)", "/sign-up(.*)", "/share(.*)", "/beta-guide(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    // TLS terminates before Next. Clerk's inferred request URL may therefore
    // use HTTP. Pin only the browser return URL; do not trust forwarded hosts,
    // weaken auth.protect, alter API errors or intercept pending session tasks.
    if (isBrowserDocument(req) && !/^\/(api|trpc)(\/|$)/.test(req.nextUrl.pathname)) {
      const session = await auth();
      if (!session.isAuthenticated && session.sessionStatus !== "pending") {
        const production = process.env.NODE_ENV === "production";
        const origin = process.env.VAETTIR_PUBLIC_ORIGIN ??
          (production ? LEGACY_APPLICATION_ORIGIN : "http://localhost:3000");
        return session.redirectToSignIn({ returnBackUrl: authReturnUrl(req.nextUrl, origin, !production) });
      }
    }
    await auth.protect();
  }
});

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)", "/(api|trpc)(.*)", "/__clerk/:path*"],
};
