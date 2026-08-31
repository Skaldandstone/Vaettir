import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";

const isPublicRoute = createRouteMatcher(["/", "/beta-guide", "/sign-in(.*)", "/sign-up(.*)"]);

const authenticate = clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export default function middleware(req: NextRequest, event: NextFetchEvent) {
  // This unused endpoint is disabled in next.config.mjs. Return directly so
  // Next's auth-dependent 404 layout is never rendered without Clerk context.
  // Do not fetch or parse any client-supplied image URL here.
  if (req.nextUrl.pathname === "/_next/image") {
    return new NextResponse(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  return authenticate(req, event);
}

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)", "/(api|trpc)(.*)", "/__clerk/:path*", "/_next/image"],
};
