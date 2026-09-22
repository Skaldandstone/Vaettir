import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import Constants from "expo-constants";
import type { AppRouter } from "@vaettir/api/src/router";
import { containsExpiredSession } from "./recovery";

const API_URL =
  process.env.EXPO_PUBLIC_API_URL ?? (Constants.expoConfig?.extra?.apiUrl as string) ?? "https://vaettir.skaldandstone.com/api";

// Populated once from a component that has access to Clerk's useAuth() hook
// (see App.tsx) -- this module is a singleton created outside React, so it
// can't call the hook itself.
let getToken: (() => Promise<string | null>) | null = null;
let onSessionExpired: (() => void) | null = null;
let sessionGeneration = 0;

export function setSessionExpiredHandler(handler: (() => void) | null) {
  onSessionExpired = handler;
}

export function setAuthTokenGetter(fn: (() => Promise<string | null>) | null) {
  sessionGeneration += 1;
  getToken = fn;
}

export const trpc = createTRPCProxyClient<AppRouter>({
  links: [
    httpBatchLink({
      url: `${API_URL}/trpc`,
      async fetch(url, options) {
        const generation = sessionGeneration;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20_000);
        const cancel = () => controller.abort();
        options?.signal?.addEventListener("abort", cancel, { once: true });
        if (options?.signal?.aborted) controller.abort();
        let response: Response;
        try { response = await fetch(url, { ...options, signal: controller.signal }); }
        finally { clearTimeout(timeout); options?.signal?.removeEventListener("abort", cancel); }
        // An old user's response must not expire a newly selected session.
        if (generation !== sessionGeneration) throw new Error("The session changed. Refresh the workspace.");
        if (response.status === 401) onSessionExpired?.();
        // Batched tRPC responses can carry a 401 inside an HTTP 207 body.
        if (response.status === 207) {
          const body: unknown = await response.clone().json();
          if (generation === sessionGeneration && containsExpiredSession(body)) onSessionExpired?.();
        }
        return response;
      },
      async headers() {
        const generation = sessionGeneration;
        const token = await getToken?.();
        if (generation !== sessionGeneration) throw new Error("The session changed. Refresh the workspace.");
        if (!token) {
          onSessionExpired?.();
          throw new Error("Your session expired. Please sign in again.");
        }
        return token ? { authorization: `Bearer ${token}` } : {};
      },
    }),
  ],
});
