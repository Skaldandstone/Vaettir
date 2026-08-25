import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import Constants from "expo-constants";
import type { AppRouter } from "@vaettir/api/src/router";

const API_URL =
  process.env.EXPO_PUBLIC_API_URL ?? (Constants.expoConfig?.extra?.apiUrl as string) ?? "http://localhost:4000";

// Populated once from a component that has access to Clerk's useAuth() hook
// (see App.tsx) -- this module is a singleton created outside React, so it
// can't call the hook itself.
let getToken: (() => Promise<string | null>) | null = null;

export function setAuthTokenGetter(fn: (() => Promise<string | null>) | null) {
  getToken = fn;
}

export const trpc = createTRPCProxyClient<AppRouter>({
  links: [
    httpBatchLink({
      url: `${API_URL}/trpc`,
      async headers() {
        const token = await getToken?.();
        return token ? { authorization: `Bearer ${token}` } : {};
      },
    }),
  ],
});
