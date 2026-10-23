"use client";
import { useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { trpcReact, type RouterOutputs } from "./trpcReact";
import type { UseQueryResult } from "@tanstack/react-query";
import type { CaseFieldOrigin } from "./case-field-origin";
export type PlanChangePreview = RouterOutputs["testPlanGovernance"]["preview"];
export type PlanChangeAccess = { query: UseQueryResult<PlanChangePreview, NonNullable<ReturnType<typeof trpcReact.testPlanGovernance.preview.useQuery>["error"]>>; fresh: PlanChangePreview | null; origin: CaseFieldOrigin | null; nativeActorId: string | null; activation: string; readable: boolean; refresh: () => void };

/** Project organization is discovery ONLY. A new echoed native read establishes
 * original organization/Clerk/native identity; no case-schema dependency exists.
 * Lost/returned sessions rotate activation UUID, including A -> B -> A. */
export function usePlanChangeAccess(projectId: string, testPlanId: string, organizationId: string, active: boolean): PlanChangeAccess {
  const auth = useAuth(), [pins, setPins] = useState<{ origin: CaseFieldOrigin; nativeActorId: string } | null>(null), [refresh, setRefresh] = useState(0);
  const origin = pins?.origin ?? null, nativeActorId = pins?.nativeActorId ?? null;
  const org = origin?.organizationId ?? organizationId, clerk = origin?.clerkActorId ?? auth.userId ?? "";
  const discoveryReady = !!organizationId && (!origin || organizationId === origin.organizationId);
  const ready = active && discoveryReady && !!projectId && !!testPlanId && !!org && auth.isLoaded && auth.isSignedIn && !!auth.sessionId && auth.userId === clerk;
  const binding = JSON.stringify([!!ready, active, projectId, testPlanId, organizationId, org, clerk, nativeActorId, auth.sessionId, refresh]);
  const [cycle, setCycle] = useState({ binding: "", requestId: crypto.randomUUID() });
  if (cycle.binding !== binding) setCycle({ binding, requestId: crypto.randomUUID() });
  const input = { projectId, testPlanId, originalOrganizationId: org, expectedClerkActorId: clerk, requestId: cycle.requestId };
  const query = trpcReact.testPlanGovernance.preview.useQuery(input, { enabled: !!ready && cycle.binding === binding, retry: false, staleTime: 0, refetchOnWindowFocus: false });
  const candidate = ready && cycle.binding === binding && query.isFetchedAfterMount && !query.isFetching && !query.isPaused && !query.error && query.data?.requestId === cycle.requestId
    && query.data.scope.projectId === projectId && query.data.scope.organizationId === org && query.data.scope.actorClerkUserId === clerk && !!query.data.scope.actorId
    && query.data.snapshot.id === testPlanId && query.data.snapshot.projectId === projectId ? query.data : null;
  if (!pins && candidate) setPins({ nativeActorId: candidate.scope.actorId, origin: { projectId, organizationId: candidate.scope.organizationId, clerkActorId: candidate.scope.actorClerkUserId, caseId: null } });
  const fresh = origin?.projectId === projectId && candidate?.scope.actorId === nativeActorId ? candidate : null;
  return { query, fresh, origin, nativeActorId, activation: cycle.requestId, readable: !!fresh,
    refresh: () => setRefresh(value => value + 1) };
}
