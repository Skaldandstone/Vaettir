"use client";
import { useState, useRef, useLayoutEffect } from "react";
import { useAuth } from "@clerk/nextjs";
import { trpcReact } from "./trpcReact";
import { currentSessionScope } from "./auth-query-cache";
import { manualCaseReviewedReadKey } from "@vaettir/api/src/services/manualCaseResultSchema";
import type { WholeCaseOrigin } from "./whole-case-reviewed-draft";
import type { ManualRunCurrentOrigin } from "./manual-run-current-reader";
function validWholeCaseParentScope(scope: ManualRunCurrentOrigin | null | undefined, projectId: string, testRunId: string): scope is ManualRunCurrentOrigin {
  return !!scope && scope.projectId === projectId && scope.testRunId === testRunId &&
    [scope.projectId, scope.testRunId, scope.organizationId, scope.clerkActorId, scope.nativeActorId].every(value => typeof value === "string" && value.length > 0 && value.length <= 200);
}
function copyWholeCaseParentScope(scope: ManualRunCurrentOrigin) {
  return Object.freeze({ projectId: scope.projectId, testRunId: scope.testRunId, organizationId: scope.organizationId, clerkActorId: scope.clerkActorId, nativeActorId: scope.nativeActorId });
}
function sameWholeCaseParentScope(a: ManualRunCurrentOrigin, b: ManualRunCurrentOrigin) {
  return a.projectId === b.projectId && a.testRunId === b.testRunId && a.organizationId === b.organizationId && a.clerkActorId === b.clerkActorId && a.nativeActorId === b.nativeActorId;
}
function wholeCaseParentCurrent(callback: (() => boolean) | null | undefined) {
  try { return callback === undefined || typeof callback === "function" && callback() === true; } catch { return false; }
}
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
  parentRunScope?: ManualRunCurrentOrigin | null,
  parentCurrent?: (() => boolean) | null,
  parentActivation?: string,
): WholeCaseAccess {
  const auth = useAuth(),
    [origin, setOrigin] = useState<WholeCaseOrigin | null>(null),
    [refresh, setRefresh] = useState(0);
  const [presentationRequired, setPresentationRequired] = useState(parentCurrent !== undefined);
  if (!presentationRequired && parentCurrent !== undefined) setPresentationRequired(true);
  const parentPresented = wholeCaseParentCurrent(parentCurrent) && (!presentationRequired || typeof parentCurrent === "function" && typeof parentActivation === "string" && parentActivation.length > 0 && parentActivation.length <= 200);
  const [parent, setParent] = useState(() => ({ required: parentRunScope !== undefined, pin: validWholeCaseParentScope(parentRunScope, projectId, testRunId) ? copyWholeCaseParentScope(parentRunScope) : null }));
  if (!parent.required && parentRunScope !== undefined)
    setParent({ required: true, pin: validWholeCaseParentScope(parentRunScope, projectId, testRunId) ? copyWholeCaseParentScope(parentRunScope) : null });
  else if (parent.required && !parent.pin && validWholeCaseParentScope(parentRunScope, projectId, testRunId))
    setParent({ required: true, pin: copyWholeCaseParentScope(parentRunScope) });
  const parentMatches = !parent.required && parentRunScope === undefined || !!parent.pin && validWholeCaseParentScope(parentRunScope, projectId, testRunId) && sameWholeCaseParentScope(parent.pin, parentRunScope) && auth.userId === parent.pin.clerkActorId && (!origin || origin.organizationId === parent.pin.organizationId && origin.clerkActorId === parent.pin.clerkActorId && origin.nativeActorId === parent.pin.nativeActorId);
  const [blocked, setBlocked] = useState(() => new Set<string>()),
    blockedRef = useRef(new Set<string>());
  const project = trpcReact.project.byId.useQuery(
    { id: projectId },
    {
      enabled: active && parentPresented && !parent.required,
      retry: false,
      staleTime: 0,
      refetchOnWindowFocus: false,
    },
  );
  const projectReady = parent.required ? parentMatches :
    project.isFetchedAfterMount &&
    !project.error &&
    !project.isFetching &&
    !project.isPaused &&
    project.data?.id === projectId;
  const organizationId =
    origin?.organizationId ??
    parent.pin?.organizationId ??
    (projectReady ? project.data?.organizationId : undefined) ??
    "pending";
  const enabled =
    active &&
    parentMatches &&
    parentPresented &&
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
        origin.organizationId === (parent.required ? parent.pin?.organizationId : project.data?.organizationId)));
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
      parent.pin,
      parentMatches,
      parentPresented,
      parentActivation ?? null,
    ]),
  );
  const input = {
    projectId,
    testRunId,
    testCaseId,
    expectedScope: {
      projectId,
      organizationId,
      clerkActorId: origin?.clerkActorId ?? parent.pin?.clerkActorId ?? auth.userId ?? "pending",
    },
    readRequestId: cycle.requestId,
    ...(origin || parent.pin ? { expectedNativeActorId: origin?.nativeActorId ?? parent.pin!.nativeActorId } : {}),
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
    (!input.expectedNativeActorId || c.scope.actorId === input.expectedNativeActorId) &&
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
      query.error || !parent.required && project.error
        ? "Current original project read could not be admitted. Retained private evidence is hidden."
        : null,
    refresh: () => {
      if (!parentMatches || !parentPresented || !wholeCaseParentCurrent(parentCurrent)) return;
      setRefresh((n) => n + 1);
      if (!parent.required) void project.refetch();
    },
  };
}
