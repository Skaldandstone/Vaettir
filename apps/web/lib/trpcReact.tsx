"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink } from "@trpc/client";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@vaettir/api/src/router";
import { getAuthHeaders } from "./trpc";
import { canEditProject } from "./membership";

export type RouterOutputs = inferRouterOutputs<AppRouter>;

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

// P1-15: a second, hooks-based client living alongside the original
// imperative `trpc` proxy client in trpc.ts (deliberately untouched - every
// page not yet migrated keeps working exactly as before). Pages migrate one
// at a time by switching their import from "../lib/trpc" to
// "../lib/trpcReact" and calling `trpcReact.<router>.<procedure>.useQuery()`
// instead of manually managing loading/error/data useState - real caching
// and invalidation, not the ad-hoc per-page state every page does today.
export const trpcReact: ReturnType<typeof createTRPCReact<AppRouter>> = createTRPCReact<AppRouter>();

// P12-03 read-only seat gating, as a hook. Six project pages used to repeat
// the same project.byId + organization.mine lookup in a useEffect; now they
// share one cached pair of queries. Unknown/loading membership fails closed.
export function useReadOnlySeat(projectId: string): boolean {
  const projectQuery = trpcReact.project.byId.useQuery({ id: projectId });
  const orgsQuery = trpcReact.organization.mine.useQuery();
  const org = orgsQuery.data?.find((o) => o.id === projectQuery.data?.organizationId);
  return !canEditProject(org);
}

export function TRPCReactProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const [client] = useState(() =>
    trpcReact.createClient({
      links: [httpBatchLink({ url: `${API_URL}/trpc`, headers: getAuthHeaders })],
    }),
  );

  return (
    <trpcReact.Provider client={client} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpcReact.Provider>
  );
}
