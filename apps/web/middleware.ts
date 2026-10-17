import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { verifiedWorkspaceWebHost } from "./lib/workspace-auth";

// /share is a deliberately public, token-gated preview surface (see
// requirements.getSharedSummary's own comment on why) - a Jira/Linear
// unfurl bot fetching a pasted link has no way to authenticate as a real
// Vaettir session, so the page itself must be reachable without one. The
// unguessable share token is the entire access control, not this route
// being public.
const isPublicRoute = createRouteMatcher(["/", "/sign-in(.*)", "/sign-up(.*)", "/share(.*)", "/beta-guide(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
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

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)", "/(api|trpc)(.*)", "/__clerk/:path*"],
};
