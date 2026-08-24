import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@tci/api/src/router";
import { getStoredToken } from "./auth";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export const trpc = createTRPCProxyClient<AppRouter>({
  links: [
    httpBatchLink({
      url: `${API_URL}/trpc`,
      headers() {
        const token = getStoredToken();
        return token ? { authorization: `Bearer ${token}` } : {};
      },
    }),
  ],
});

export type RouterOutputs = inferRouterOutputs<AppRouter>;
