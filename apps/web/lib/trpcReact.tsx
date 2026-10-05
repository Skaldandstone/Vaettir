"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useAuth } from "@clerk/nextjs";
import { QueryClientProvider } from "@tanstack/react-query";
import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink } from "@trpc/client";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@vaettir/api/src/router";
import { getAuthHeaders } from "./trpc";
import { canEditProject } from "./membership";
import { AuthQueryClient, authQueryIdentity } from "./auth-query-cache";

export type RouterOutputs = inferRouterOutputs<AppRouter>;
export type RouterInputs = inferRouterInputs<AppRouter>;

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

// P1-15: a second, hooks-based client living alongside the original
// imperative `trpc` proxy client in trpc.ts (deliberately untouched - every
// page not yet migrated keeps working exactly as before). Pages migrate one
// at a time by switching their import from "../lib/trpc" to
// "../lib/trpcReact" and calling `trpcReact.<router>.<procedure>.useQuery()`
// instead of manually managing loading/error/data useState - real caching
// and invalidation, not the ad-hoc per-page state every page does today.
export const trpcReact: ReturnType<typeof createTRPCReact<AppRouter>> =
  createTRPCReact<AppRouter>();

// P12-03 read-only seat gating, as a hook. Six project pages used to repeat
// the same project.byId + organization.mine lookup in a useEffect; now they
// share one cached pair of queries. Unknown/loading membership fails closed.
export function useReadOnlySeat(projectId: string): boolean {
  const projectQuery = trpcReact.project.byId.useQuery({ id: projectId });
  const orgsQuery = trpcReact.organization.mine.useQuery();
  const org = orgsQuery.data?.find(
    (o) => o.id === projectQuery.data?.organizationId,
  );
  return !canEditProject(org);
}

export function TRPCReactProvider({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, userId, sessionId } = useAuth();
  const scope = useMemo(
    () =>
      isLoaded && isSignedIn && userId && sessionId
        ? Object.freeze({ userId, sessionId })
        : null,
    [isLoaded, isSignedIn, userId, sessionId],
  );
  const identity = authQueryIdentity(scope);
  const [queryClient] = useState(() => new AuthQueryClient());
  const [generation, setGeneration] = useState(() => ({
    number: 0,
    identity,
    scope,
  }));
  if (generation.identity !== identity) {
    // React retries this provider before rendering descendants. Keep the same
    // child tree/drafts and increment even when returning to the same account.
    setGeneration({ number: generation.number + 1, identity, scope });
  } else {
    queryClient.selectGeneration(generation);
  }
  const client = useMemo(
    () =>
      trpcReact.createClient({
        links: [
          httpBatchLink({
            url: `${API_URL}/trpc`,
            headers: () => getAuthHeaders(scope),
          }),
        ],
      }),
    [scope],
  );
  useEffect(() => {
    // Commit transitions, not effect cleanup: StrictMode's repeated setup
    // must never cancel current reads. Only the prior committed generation
    // is canceled; mutations and the new generation remain untouched.
    void queryClient.commitGeneration(generation).catch(() => undefined);
  }, [queryClient, generation]);

  return (
    <trpcReact.Provider client={client} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpcReact.Provider>
  );
}
