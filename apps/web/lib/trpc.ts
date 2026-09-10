// P1-15 (completed 2026-09-10): the module-level `createTRPCProxyClient`
// singleton that used to live here is gone - every page and component now
// goes through lib/trpcReact.tsx's react-query client. What remains is the
// one piece both clients always shared: the Clerk-token header resolver.
//
// It runs outside any hook context (httpBatchLink's `headers()` callback),
// so it reads the session token off the global `window.Clerk` instance
// (set once <ClerkProvider> has loaded) rather than `useAuth()`.
// `getToken()` is async, which httpBatchLink's `headers()` supports directly.
//
// `window.Clerk` itself can exist before Clerk has actually finished
// loading -- `.session` stays undefined until `.load()` resolves. A page
// that fires its first query in a mount-time useEffect (e.g. /onboarding,
// /projects) can easily race ahead of that, silently sending no
// Authorization header at all rather than an expired one -- which is
// exactly what happened here: every request 401'd with no
// token-verification error logged on the API side, because there was no
// token to verify in the first place.
//
// The original fix only handled "window.Clerk exists but .loaded is
// false." It missed the earlier window where the Clerk script hasn't run
// at all yet, so `window.Clerk` itself is `undefined` -- e.g. right after
// an OAuth redirect that lands directly on a page which fires a query on
// mount, before <ClerkProvider>'s script tag has even executed. In that
// case `window.Clerk?.session?.getToken()` optional-chains straight to
// `undefined` with nothing to await. Poll briefly for `window.Clerk` to
// appear before giving up.
async function waitForClerk(timeoutMs = 5000): Promise<Window["Clerk"]> {
  const start = Date.now();
  while (!window.Clerk) {
    if (Date.now() - start > timeoutMs) return undefined;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return window.Clerk;
}

// Consumed by lib/trpcReact.tsx's httpBatchLink.
export async function getAuthHeaders(): Promise<Record<string, string>> {
  if (typeof window === "undefined") return {};
  const clerk = await waitForClerk();
  if (clerk && !clerk.loaded) {
    await clerk.load();
  }
  const token = await clerk?.session?.getToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}
