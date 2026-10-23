"use client";
import { useState, useRef, useLayoutEffect, useMemo } from "react";
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
function wholeCaseSdkSession() {
  return typeof window === "undefined" ? null : currentSessionScope(window.Clerk?.loaded ? window.Clerk.session : null);
}
function wholeCaseAccessGuard() {
  let key = "", generation = 0;
  return {
    observe(next: string) { if (key !== next) { key = next; generation++; } return generation; },
    revoke() { generation++; },
    matches(candidate: string, stamp: number) { return key === candidate && generation === stamp; },
  };
}
type WholeCaseMonitor = Readonly<{ resource: NonNullable<typeof window.Clerk> }>;
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
  observedSessionId: string | null;
  current: () => boolean;
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
  const resource = typeof window === "undefined" ? null : window.Clerk ?? null,
    sdk = wholeCaseSdkSession();
  const [monitor, setMonitor] = useState<WholeCaseMonitor | null>(null), monitorRef = useRef<WholeCaseMonitor | null>(null),
    [sdkEpoch, setSdkEpoch] = useState(0), sdkEpochRef = useRef(0),
    [installation, setInstallation] = useState(0), cleanupRef = useRef(false),
    lastResource = useRef<typeof resource>(null),
    acceptedOrigin = useRef<WholeCaseOrigin | null>(null),
    [guard] = useState(wholeCaseAccessGuard),
    published = useRef<{ key: string; stamp: number; activation: string; readable: boolean } | null>(null),
    [intent, setIntent] = useState<{ sessionId: string; clerkActorId: string; sdkEpoch: number } | null>(null),
    [originalRead, setOriginalRead] = useState<{ projectId: string; testRunId: string; testCaseId: string; organizationId: string; clerkActorId: string } | null>(null);
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
  const baseEligible =
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
        origin.organizationId === (parent.required ? parent.pin?.organizationId : project.data?.organizationId)));
  const sdkMatches = !!sdk && sdk.userId === auth.userId && sdk.sessionId === auth.sessionId;
  const originalMatches = !originalRead || originalRead.projectId === projectId && originalRead.testRunId === testRunId && originalRead.testCaseId === testCaseId && originalRead.organizationId === organizationId && originalRead.clerkActorId === auth.userId;
  if (!originalRead && baseEligible && sdkMatches) setOriginalRead(Object.freeze({ projectId, testRunId, testCaseId, organizationId, clerkActorId: auth.userId! }));
  if (!intent && baseEligible && originalMatches && sdkMatches) setIntent(Object.freeze({ sessionId: auth.sessionId!, clerkActorId: auth.userId!, sdkEpoch }));
  const enabled = baseEligible && originalMatches && sdkMatches && !!monitor && monitor.resource === resource && !!intent && intent.sessionId === auth.sessionId && intent.clerkActorId === auth.userId && intent.sdkEpoch === sdkEpoch;
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
      sdkEpoch,
      intent,
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
  const sdkSession = wholeCaseSdkSession();
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
    typeof c.scope.actorId === "string" && c.scope.actorId.length > 0 && c.scope.actorId.length <= 200 &&
    typeof c.canRecover === "boolean"
      ? c
      : null;
  useLayoutEffect(() => {
    const epochHolder = sdkEpochRef;
    cleanupRef.current = false;
    if (lastResource.current && lastResource.current !== resource) sdkEpochRef.current++;
    lastResource.current = resource;
    setSdkEpoch(sdkEpochRef.current);
    const addListener = resource ? Reflect.get(resource, "addListener") : undefined;
    if (typeof addListener !== "function") { monitorRef.current = null; published.current = null; setMonitor(null); return; }
    const proof: WholeCaseMonitor = Object.freeze({ resource: resource! });
    let live = true, observed = wholeCaseSdkSession(), unsubscribe: (() => void) | undefined;
    const revoke = () => {
      guard.revoke();
      const prior = published.current;
      if (prior && !blockedRef.current.has(prior.activation)) {
        blockedRef.current.add(prior.activation); setBlocked(previous => new Set(previous).add(prior.activation));
      }
      published.current = null; sdkEpochRef.current++; setSdkEpoch(sdkEpochRef.current);
    };
    const changed = () => {
      if (!live) return;
      if (typeof window === "undefined" || window.Clerk !== resource) {
        live = false; monitorRef.current = null; setMonitor(null); revoke(); setInstallation(value => value + 1); return;
      }
      const next = wholeCaseSdkSession();
      if (observed?.userId !== next?.userId || observed?.sessionId !== next?.sessionId) { observed = next; revoke(); }
    };
    try {
      const result = addListener.call(resource, changed);
      if (typeof result === "function") unsubscribe = result;
      if (!unsubscribe || !live || typeof window === "undefined" || window.Clerk !== resource) throw Error("Listener unavailable");
      monitorRef.current = proof; setMonitor(proof); changed();
    } catch {
      live = false; monitorRef.current = null; published.current = null; setMonitor(null); guard.revoke(); cleanupRef.current = true;
      try { unsubscribe?.(); } catch { /* Already revoked. */ }
      cleanupRef.current = false;
      return;
    }
    return () => {
      live = false; cleanupRef.current = true; monitorRef.current = null; published.current = null; guard.revoke();
      if (acceptedOrigin.current) epochHolder.current++;
      try { unsubscribe?.(); } catch { /* Revocation precedes cleanup. */ }
    };
  }, [resource, installation, guard]);
  if (!origin && candidate && auth.userId && auth.sessionId)
    setOrigin(
      Object.freeze({
        projectId,
        testRunId,
        testCaseId,
        organizationId,
        clerkActorId: auth.userId,
        nativeActorId: candidate.scope.actorId,
        sessionId: intent!.sessionId,
      }),
    );
  const readable =
    !!origin && !!candidate && candidate.scope.actorId === origin.nativeActorId;
  const key = JSON.stringify([projectId, testRunId, testCaseId, organizationId, active, baseEligible, originalMatches, parentMatches, parentPresented, parentActivation ?? null, auth.isLoaded, auth.isSignedIn, auth.userId, auth.sessionId, sdk?.userId, sdk?.sessionId, sdkEpoch, intent, cycle.requestId, cycle.ready, readable, !!query.error, query.isFetching, query.isPaused, query.isFetchedAfterMount, c?.requestId, c?.requested, c?.projection, c?.scope, c?.canRecover]);
  const stamp = guard.observe(key);
  useLayoutEffect(() => {
    if (!guard.matches(key, stamp)) return;
    const verified = !!monitor && monitorRef.current === monitor && typeof window !== "undefined" && monitor.resource === window.Clerk && sdkEpochRef.current === sdkEpoch;
    published.current = { key, stamp, activation: cycle.requestId, readable: readable && verified };
    if (origin && verified) acceptedOrigin.current = origin;
    return () => { published.current = null; };
  }, [key, stamp, guard, monitor, sdkEpoch, cycle.requestId, readable, origin]);
  const current = useMemo(() => () => {
    const live = published.current, now = wholeCaseSdkSession();
    if (!monitor || monitorRef.current !== monitor || cleanupRef.current || typeof window === "undefined" || window.Clerk !== monitor.resource || now?.userId !== auth.userId || now?.sessionId !== intent?.sessionId || sdkEpochRef.current !== intent?.sdkEpoch) {
      if (live && monitor && monitorRef.current === monitor && !cleanupRef.current && (live.readable || now?.userId !== auth.userId || now?.sessionId !== auth.sessionId || typeof window === "undefined" || window.Clerk !== monitor.resource)) {
        guard.revoke(); published.current = null;
        if (!blockedRef.current.has(live.activation)) { blockedRef.current.add(live.activation); setBlocked(previous => new Set(previous).add(live.activation)); }
        sdkEpochRef.current++; setSdkEpoch(sdkEpochRef.current);
        if (typeof window === "undefined" || window.Clerk !== monitor.resource) { monitorRef.current = null; setMonitor(null); setInstallation(value => value + 1); }
      }
      return false;
    }
    return !!live?.readable && live.key === key && live.stamp === stamp && guard.matches(key, stamp) && wholeCaseParentCurrent(parentCurrent);
  }, [monitor, auth.userId, auth.sessionId, intent, key, stamp, guard, parentCurrent, setBlocked, setSdkEpoch, setMonitor, setInstallation]);
  const refreshCurrent = useMemo(() => () => {
    const live = published.current, now = wholeCaseSdkSession();
    if (cleanupRef.current || !live || live.key !== key || live.stamp !== stamp || !guard.matches(key, stamp) || !baseEligible || !originalMatches || !parentMatches || !parentPresented || !wholeCaseParentCurrent(parentCurrent)) return false;
    if (now?.userId !== auth.userId || now?.sessionId !== auth.sessionId || monitor && typeof window !== "undefined" && window.Clerk !== monitor.resource) {
      guard.revoke(); published.current = null;
      if (!blockedRef.current.has(live.activation)) { blockedRef.current.add(live.activation); setBlocked(previous => new Set(previous).add(live.activation)); }
      sdkEpochRef.current++; setSdkEpoch(sdkEpochRef.current);
      if (monitor && typeof window !== "undefined" && window.Clerk !== monitor.resource) { monitorRef.current = null; setMonitor(null); setInstallation(value => value + 1); }
      return false;
    }
    if (!monitor || monitorRef.current !== monitor) { setInstallation(value => value + 1); return false; }
    guard.revoke(); published.current = null;
    setIntent(Object.freeze({ sessionId: now.sessionId, clerkActorId: now.userId, sdkEpoch: sdkEpochRef.current }));
    setRefresh(value => value + 1);
    if (!parent.required) void project.refetch();
    return true;
  }, [key, stamp, guard, baseEligible, originalMatches, parentMatches, parentPresented, parentCurrent, auth.userId, auth.sessionId, monitor, parent.required, project, setBlocked, setSdkEpoch, setMonitor, setInstallation, setIntent, setRefresh]);
  return {
    origin,
    readable,
    canRecover: readable && !!candidate?.canRecover,
    activation: cycle.requestId,
    observedSessionId: readable ? intent!.sessionId : null,
    current,
    error:
      query.error || !parent.required && project.error
        ? "Current original project read could not be admitted. Retained private evidence is hidden."
        : null,
    refresh: refreshCurrent,
  };
}
