"use client";
import { useState, useRef, useLayoutEffect } from "react";
import { useAuth } from "@clerk/nextjs";
import { trpcReact } from "./trpcReact";
import { currentSessionScope } from "./auth-query-cache";
import { manualCaseReviewedReadKey } from "@vaettir/api/src/services/manualCaseResultSchema";
import type { WholeCaseOrigin } from "./whole-case-reviewed-draft";
export function useWholeCaseReadNonce(binding: string) {
  const [cycle, setCycle] = useState({ binding: "", id: crypto.randomUUID() });
  if (cycle.binding !== binding) setCycle({ binding, id: crypto.randomUUID() });
  return { requestId: cycle.id, ready: cycle.binding === binding };
}
export type WholeCaseAccess = {
  origin: WholeCaseOrigin | null;
  readable: boolean;
  canRecover: boolean;
  activation: string;
  error: string | null;
  refresh: () => void;
};
/** Project lookup is discovery only; admission requires a newly echoed native read. */
export function useWholeCaseReviewedAccess(
  projectId: string,
  testRunId: string,
  testCaseId: string,
  active: boolean,
): WholeCaseAccess {
  const auth = useAuth(),
    [origin, setOrigin] = useState<WholeCaseOrigin | null>(null),
    [refresh, setRefresh] = useState(0);
  const [blocked, setBlocked] = useState(() => new Set<string>()),
    blockedRef = useRef(new Set<string>());
  const project = trpcReact.project.byId.useQuery(
    { id: projectId },
    {
      enabled: active,
      retry: false,
      staleTime: 0,
      refetchOnWindowFocus: false,
    },
  );
  const projectReady =
    project.isFetchedAfterMount &&
    !project.error &&
    !project.isFetching &&
    !project.isPaused &&
    project.data?.id === projectId;
  const organizationId =
    origin?.organizationId ??
    (projectReady ? project.data?.organizationId : undefined) ??
    "pending";
  const enabled =
    active &&
    auth.isLoaded &&
    auth.isSignedIn &&
    !!auth.userId &&
    !!auth.sessionId &&
    projectReady &&
    (!origin ||
      (origin.projectId === projectId &&
        origin.testRunId === testRunId &&
        origin.testCaseId === testCaseId &&
        origin.clerkActorId === auth.userId &&
        origin.sessionId === auth.sessionId &&
        origin.organizationId === project.data?.organizationId));
  const cycle = useWholeCaseReadNonce(
    JSON.stringify([
      enabled,
      active,
      projectId,
      testRunId,
      testCaseId,
      organizationId,
      auth.userId,
      auth.sessionId,
      refresh,
    ]),
  );
  const input = {
    projectId,
    testRunId,
    testCaseId,
    expectedScope: {
      projectId,
      organizationId,
      clerkActorId: origin?.clerkActorId ?? auth.userId ?? "pending",
    },
    readRequestId: cycle.requestId,
    ...(origin ? { expectedNativeActorId: origin.nativeActorId } : {}),
  };
  const query = trpcReact.manualCaseResults.accessReviewed.useQuery(input, {
    enabled: !!enabled && cycle.ready,
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
  const c = query.data?.readContext;
  const sdkSession = currentSessionScope(
    typeof window !== "undefined" && window.Clerk?.loaded
      ? window.Clerk.session
      : null,
  );
  const candidate =
    enabled &&
    !blocked.has(cycle.requestId) &&
    sdkSession?.userId === auth.userId &&
    sdkSession.sessionId === auth.sessionId &&
    cycle.ready &&
    query.isFetchedAfterMount &&
    !query.error &&
    !query.isFetching &&
    !query.isPaused &&
    c?.projection === "ACCESS" &&
    c.requestId === cycle.requestId &&
    c.requested === manualCaseReviewedReadKey(input) &&
    c.scope.projectId === projectId &&
    c.scope.organizationId === organizationId &&
    c.scope.clerkActorId === auth.userId &&
    !!c.scope.actorId
      ? c
      : null;
  useLayoutEffect(() => {
    if (!cycle.ready || !auth.userId || !auth.sessionId) return;
    const reader = cycle.requestId,
      clerkActorId = origin?.clerkActorId ?? auth.userId,
      sessionId = origin?.sessionId ?? auth.sessionId;
    const observe = () => {
      const sdk = currentSessionScope(
        typeof window !== "undefined" && window.Clerk?.loaded
          ? window.Clerk.session
          : null,
      );
      if (sdk?.userId !== clerkActorId || sdk.sessionId !== sessionId) {
        if (!blockedRef.current.has(reader)) {
          blockedRef.current.add(reader);
          setBlocked((previous) => new Set(previous).add(reader));
        }
      }
    };
    observe();
    const clerk = typeof window !== "undefined" ? window.Clerk : null,
      addListener = clerk ? Reflect.get(clerk, "addListener") : undefined;
    const unsubscribe =
      typeof addListener === "function"
        ? addListener.call(clerk, observe)
        : undefined;
    return () => {
      if (typeof unsubscribe === "function") unsubscribe();
    };
  }, [
    cycle.requestId,
    cycle.ready,
    auth.userId,
    auth.sessionId,
    origin?.clerkActorId,
    origin?.sessionId,
  ]);
  if (!origin && candidate && auth.userId && auth.sessionId)
    setOrigin(
      Object.freeze({
        projectId,
        testRunId,
        testCaseId,
        organizationId,
        clerkActorId: auth.userId,
        nativeActorId: candidate.scope.actorId,
        sessionId: auth.sessionId,
      }),
    );
  const readable =
    !!origin && !!candidate && candidate.scope.actorId === origin.nativeActorId;
  return {
    origin,
    readable,
    canRecover: readable && !!candidate?.canRecover,
    activation: cycle.requestId,
    error:
      query.error || project.error
        ? "Current original project read could not be admitted. Retained private evidence is hidden."
        : null,
    refresh: () => {
      setRefresh((n) => n + 1);
      void project.refetch();
    },
  };
}
