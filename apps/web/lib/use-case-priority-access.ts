"use client";
import { useState } from "react";
import { useAuth } from "@clerk/nextjs";
import type { UseQueryResult } from "@tanstack/react-query";
import { trpcReact } from "./trpcReact";
import { samePriorityReader, type PriorityOrigin, type PriorityPreview } from "./case-priority-draft";
export type PriorityAccess = { origin: PriorityOrigin | null; fresh: PriorityPreview | null; readable: boolean; activation: string; refresh: () => void; query: UseQueryResult<PriorityPreview, NonNullable<ReturnType<typeof trpcReact.casePriority.preview.useQuery>["error"]>> };
export function useCasePriorityAccess(projectId: string, caseId: string, active: boolean): PriorityAccess {
  const auth = useAuth(), [origin, setOrigin] = useState<PriorityOrigin | null>(null), [refresh, setRefresh] = useState(0);
  const clerk = origin?.clerkActorId ?? auth.userId ?? "";
  const ready = active && !!projectId && !!caseId && auth.isLoaded && auth.isSignedIn && !!auth.sessionId && auth.userId === clerk && (!origin || origin.projectId === projectId && origin.caseId === caseId);
  const binding = JSON.stringify([!!ready, active, projectId, caseId, origin, auth.sessionId, refresh]);
  const [cycle, setCycle] = useState({ binding: "", requestId: crypto.randomUUID() });
  if (cycle.binding !== binding) setCycle({ binding, requestId: crypto.randomUUID() });
  const query = trpcReact.casePriority.preview.useQuery({ projectId, caseId, requestId: cycle.requestId, ...(origin ? { originalOrganizationId: origin.organizationId, expectedClerkActorId: origin.clerkActorId, expectedNativeActorId: origin.nativeActorId } : {}) }, { enabled: !!ready && cycle.binding === binding, retry: false, staleTime: 0, refetchOnWindowFocus: false });
  const candidate = ready && cycle.binding === binding && query.isFetchedAfterMount && !query.error && !query.isFetching && !query.isPaused && query.data?.requestId === cycle.requestId && query.data.projectId === projectId && query.data.caseId === caseId && query.data.readScope.projectId === projectId && query.data.readScope.actorClerkUserId === clerk && !!query.data.readScope.actorId && !!query.data.readScope.organizationId ? query.data : null;
  if (!origin && candidate) setOrigin(Object.freeze({ projectId, caseId, organizationId: candidate.readScope.organizationId, clerkActorId: candidate.readScope.actorClerkUserId, nativeActorId: candidate.readScope.actorId }));
  const fresh = origin && candidate && samePriorityReader(candidate.readScope, origin) ? candidate : null;
  return { query, origin, fresh, readable: !!fresh, activation: cycle.requestId, refresh: () => setRefresh(value => value + 1) };
}
