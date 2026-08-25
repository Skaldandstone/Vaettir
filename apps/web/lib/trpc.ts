import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@vaettir/api/src/router";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

// This client is a module-level singleton used from client components
// outside any hook context, so it reads the session token off the global
// `window.Clerk` instance (set once <ClerkProvider> has loaded) rather than
// `useAuth()`. `getToken()` is async, which httpBatchLink's `headers()`
// supports directly.
//
// `window.Clerk` itself can exist before Clerk has actually finished
// loading -- `.session` stays undefined until `.load()` resolves. A page
// that fires its first query in a mount-time useEffect (e.g. /onboarding)
// can easily race ahead of that, silently sending no Authorization header
// at all rather than an expired one -- which is exactly what happened
// here: every request 401'd with no token-verification error logged on
// the API side, because there was no token to verify in the first place.
async function getAuthHeaders(): Promise<Record<string, string>> {
  if (typeof window === "undefined") return {};
  if (window.Clerk && !window.Clerk.loaded) {
    await window.Clerk.load();
  }
  const token = await window.Clerk?.session?.getToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}

export const trpc = createTRPCProxyClient<AppRouter>({
  links: [httpBatchLink({ url: `${API_URL}/trpc`, headers: getAuthHeaders })],
});

export type RouterOutputs = inferRouterOutputs<AppRouter>;
