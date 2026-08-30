import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import Constants from "expo-constants";
import type { AppRouter } from "@vaettir/api/src/router";

const API_URL =
  process.env.EXPO_PUBLIC_API_URL ?? (Constants.expoConfig?.extra?.apiUrl as string) ?? "http://localhost:4000";

// Populated once from a component that has access to Clerk's useAuth() hook
// (see App.tsx) -- this module is a singleton created outside React, so it
// can't call the hook itself.
let getToken: (() => Promise<string | null>) | null = null;
let onSessionExpired: (() => void) | null = null;

export function setSessionExpiredHandler(handler: (() => void) | null) {
  onSessionExpired = handler;
}

export function setAuthTokenGetter(fn: (() => Promise<string | null>) | null) {
  getToken = fn;
}

export const trpc = createTRPCProxyClient<AppRouter>({
  links: [
    httpBatchLink({
      url: `${API_URL}/trpc`,
      async fetch(url, options) {
        const response = await fetch(url, options);
        if (response.status === 401) onSessionExpired?.();
        // Batched tRPC responses can carry a 401 inside an HTTP 207 body.
        if (response.status === 207) {
          const body: unknown = await response.clone().json();
          const entries = Array.isArray(body) ? body : [body];
          if (entries.some((entry) => entry?.error?.data?.code === "UNAUTHORIZED" || entry?.error?.json?.data?.code === "UNAUTHORIZED")) onSessionExpired?.();
        }
        return response;
      },
      async headers() {
        const token = await getToken?.();
        if (!token) {
          onSessionExpired?.();
          throw new Error("Your session expired. Please sign in again.");
        }
        return token ? { authorization: `Bearer ${token}` } : {};
      },
    }),
  ],
});
