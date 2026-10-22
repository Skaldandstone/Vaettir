"use client";
import type { IdentityPermission } from "@vaettir/core";
import { useLayoutEffect, useRef } from "react";
import { useAuth } from "@clerk/nextjs";
import { trpcReact } from "./trpcReact";
import { currentSessionScope, sameAuthScope } from "./auth-query-cache";

/** Presentation only. Every mutation rechecks its explicit action server-side.
 * Never feed this into broad canEdit/admin/provider/AI authority. */
export function useProjectCustomActions(projectId: string) {
  const auth = useAuth();
  const enabled = !!(auth.isLoaded && auth.isSignedIn && auth.userId && auth.sessionId);
  const query = trpcReact.identityAccess.projectActions.useQuery({ projectId }, { enabled, retry: false, staleTime: 0, refetchOnWindowFocus: "always" });
  const current = enabled && query.isSuccess && !query.isError && !query.isFetching && !query.isPaused &&
    query.data.projectId === projectId && query.data.clerkSubject === auth.userId ? query.data : null;
  const latest = useRef(current);
  useLayoutEffect(() => { latest.current = current; return () => { latest.current = null; }; }, [current]);
  const matchesSession = () => sameAuthScope({ userId: auth.userId ?? "", sessionId: auth.sessionId ?? "" },
    typeof window === "undefined" ? null : currentSessionScope(window.Clerk?.loaded ? window.Clerk.session : null));
  const allows = (action: IdentityPermission, organizationId?: string) => !!current && matchesSession() &&
    (!organizationId || current.organizationId === organizationId) && current.permissions.includes(action);
  return { allows, ready: !!current, owns: (action: IdentityPermission, organizationId?: string) => latest.current === current && allows(action, organizationId),
    error: query.error?.message ?? null, retry: () => query.refetch() };
}
