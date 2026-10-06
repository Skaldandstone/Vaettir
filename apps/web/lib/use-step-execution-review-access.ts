"use client";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { trpcReact } from "./trpcReact";
import { currentSessionScope, sameAuthScope } from "./auth-query-cache";
import { decodeStepReviewWire, sameStepReviewReader, type StepReviewOrigin, type StepReviewWire } from "./step-execution-review-draft";
export type StepReviewAccess = { origin: StepReviewOrigin | null; activation: string; observedSessionId: string | null; fresh: StepReviewWire | null; error: string | null; refresh: () => void };
type NativeOrigin = Omit<StepReviewOrigin, "stepIndex">;
export function currentStepReviewSession() { return typeof window === "undefined" ? null : currentSessionScope(window.Clerk?.loaded ? window.Clerk.session : null); }
type ResourceListener = { addListener?: (callback: () => void) => () => void };
/** Query activation is original scope + current SDK/hook agreement, not an auth
 * cache hit. Session IDs are browser observation only, never native proof. */
export function useStepExecutionReviewAccess(projectId: string, testRunId: string, testCaseId: string, stepIndex: number, visible: boolean): StepReviewAccess {
  const auth = useAuth();
  const [nativeOrigin, setOrigin] = useState<NativeOrigin | null>(null), [refresh, setRefresh] = useState(0), [sdkEpoch, setSdkEpoch] = useState(0);
  const hookScope = useMemo(() => auth.userId && auth.sessionId ? { userId: auth.userId, sessionId: auth.sessionId } : null, [auth.userId, auth.sessionId]);
  const observedSdkScope = currentStepReviewSession();
  const sdkScope = useMemo(() => observedSdkScope?.userId && observedSdkScope?.sessionId ? { userId: observedSdkScope.userId, sessionId: observedSdkScope.sessionId } : null, [observedSdkScope?.userId, observedSdkScope?.sessionId]);
  const clerk = nativeOrigin?.clerkActorId ?? auth.userId ?? "";
  const origin = useMemo<StepReviewOrigin | null>(() => nativeOrigin ? Object.freeze({ ...nativeOrigin, stepIndex }) : null, [nativeOrigin, stepIndex]);
  const ready = visible && auth.isLoaded && auth.isSignedIn && !!projectId && !!testRunId && !!testCaseId && Number.isInteger(stepIndex) && stepIndex >= 0 && stepIndex <= 499 && auth.userId === clerk && sameAuthScope(hookScope, sdkScope) && (!nativeOrigin || nativeOrigin.projectId === projectId && nativeOrigin.testRunId === testRunId && nativeOrigin.testCaseId === testCaseId);
  const binding = JSON.stringify([ready, visible, projectId, testRunId, testCaseId, stepIndex, nativeOrigin, hookScope, sdkScope, sdkEpoch, refresh]);
  const [cycle, setCycle] = useState({ binding: "", requestId: crypto.randomUUID() });
  if (cycle.binding !== binding) setCycle({ binding, requestId: crypto.randomUUID() });
  const query = trpcReact.manualStepExecutionReview.preview.useQuery({ projectId, testRunId, testCaseId, stepIndex, readRequestId: cycle.requestId,
    ...(nativeOrigin ? { originalOrganizationId: nativeOrigin.organizationId, expectedClerkActorId: nativeOrigin.clerkActorId, expectedNativeActorId: nativeOrigin.nativeActorId } : {}) },
  { enabled: ready && cycle.binding === binding, retry: false, staleTime: 0, refetchOnWindowFocus: false });
  const decoded = useMemo(() => { if (!query.data) return null; try { return decodeStepReviewWire(query.data); } catch { return null; } }, [query.data]);
  const candidate = ready && cycle.binding === binding && query.isFetchedAfterMount && !query.error && !query.isFetching && !query.isPaused && decoded?.readRequestId === cycle.requestId && decoded.projectId === projectId && decoded.testRunId === testRunId && decoded.testCaseId === testCaseId && decoded.stepIndex === stepIndex && decoded.scope.projectId === projectId && decoded.scope.actorClerkUserId === clerk ? decoded : null;
  if (!nativeOrigin && candidate) setOrigin(Object.freeze({ projectId, testRunId, testCaseId, organizationId: candidate.scope.organizationId, clerkActorId: candidate.scope.actorClerkUserId, nativeActorId: candidate.scope.actorId }));
  const fresh = origin && candidate && sameStepReviewReader(candidate.scope, origin) ? candidate : null;
  // This is permission to ask the protected server for a new read, not native
  // body/write authorization. A refused response must not dead-end Refresh.
  const live = useRef<{ activation: string; sessionId: string | null; userId: string } | null>(null);
  useLayoutEffect(() => {
    live.current = ready && cycle.binding === binding && sameAuthScope(hookScope, currentStepReviewSession()) ? { activation: cycle.requestId, sessionId: auth.sessionId ?? null, userId: clerk } : null;
    // Seed from render, not commit: immediate SDK emission must detect movement
    // between those boundaries before any retained body can be published.
    let previous = JSON.stringify(sdkScope);
    // Window's existing declaration covers token transport only. This is a
    // narrow optional installed resource capability, not a replacement SDK.
    const resource = (typeof window === "undefined" ? null : window.Clerk) as ResourceListener | null | undefined;
    const unsubscribe = typeof resource?.addListener === "function" ? resource.addListener(() => {
      const current = currentStepReviewSession(), identity = JSON.stringify(current);
      if (identity !== previous) { previous = identity; live.current = null; setSdkEpoch(value => value + 1); }
      if (!sameAuthScope(hookScope, current)) live.current = null;
    }) : undefined;
    return () => { unsubscribe?.(); live.current = null; };
  }, [cycle.requestId, cycle.binding, binding, ready, auth.sessionId, clerk, auth.userId, hookScope, sdkScope]);
  return { origin, fresh, activation: cycle.requestId, observedSessionId: fresh ? auth.sessionId ?? null : null,
    error: query.error || query.data && !decoded ? "The current original-reader step response could not be verified. Entries and identical requests remain retained." : null,
    refresh: () => { const current = live.current; if (ready && current?.activation === cycle.requestId && current.userId === clerk && current.sessionId === auth.sessionId && sameAuthScope(hookScope, currentStepReviewSession())) setRefresh(value => value + 1); } };
}
