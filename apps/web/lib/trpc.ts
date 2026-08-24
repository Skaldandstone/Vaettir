import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@tci/api/src/router";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

// This client is a module-level singleton used from client components
// outside any hook context, so it reads the session token off the global
// `window.Clerk` instance (set once <ClerkProvider> has loaded) rather than
// `useAuth()`. `getToken()` is async, which httpBatchLink's `headers()`
// supports directly.
async function getAuthHeaders(): Promise<Record<string, string>> {
  if (typeof window === "undefined") return {};
  const token = await window.Clerk?.session?.getToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}

export const trpc = createTRPCProxyClient<AppRouter>({
  links: [httpBatchLink({ url: `${API_URL}/trpc`, headers: getAuthHeaders })],
});

export type RouterOutputs = inferRouterOutputs<AppRouter>;
