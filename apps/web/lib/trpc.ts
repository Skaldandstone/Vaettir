import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@qi/api/src/router";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export const trpc = createTRPCProxyClient<AppRouter>({
  links: [httpBatchLink({ url: `${API_URL}/trpc` })],
});

export type RouterOutputs = inferRouterOutputs<AppRouter>;
