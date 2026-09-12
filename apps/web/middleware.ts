import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// /share is a deliberately public, token-gated preview surface (see
// requirements.getSharedSummary's own comment on why) - a Jira/Linear
// unfurl bot fetching a pasted link has no way to authenticate as a real
// Vaettir session, so the page itself must be reachable without one. The
// unguessable share token is the entire access control, not this route
// being public.
const isPublicRoute = createRouteMatcher(["/", "/sign-in(.*)", "/sign-up(.*)", "/share(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)", "/(api|trpc)(.*)", "/__clerk/:path*"],
};
