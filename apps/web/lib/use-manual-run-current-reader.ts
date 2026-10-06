"use client";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { trpcReact } from "./trpcReact";
import { currentSessionScope, sameAuthScope } from "./auth-query-cache";
import {
  admitManualRunCurrent,
  ManualRunCurrentRenderGuard,
  sameManualRunCurrentOrigin,
  type ManualRunCurrentOrigin,
  type ManualRunCurrentInput,
  type ManualRunCurrentSnapshot,
} from "./manual-run-current-reader";
type Session = NonNullable<ReturnType<typeof currentSessionScope>>;
type ListenerProof = Readonly<{ sdk: NonNullable<typeof window.Clerk> }>;
type Intent = {
  requestId: string;
  session: Session;
  contextEpoch: number;
  sdkEpoch: number;
  origin: ManualRunCurrentOrigin | null;
};
type Frame = {
  projectId: string;
  testRunId: string;
  organizationId: string;
  active: boolean;
  eligible: boolean;
  baseEligible: boolean;
  listenerProof: ListenerProof | null;
  session: Session | null;
  origin: ManualRunCurrentOrigin | null;
  contextEpoch: number;
  sdkEpoch: number;
  activation: string | null;
  key: QueryKey;
  raw: unknown;
  revision: number;
};
function sdkSession() {
  return typeof window === "undefined"
    ? null
    : currentSessionScope(window.Clerk?.loaded ? window.Clerk.session : null);
}
/** This held whole-view reader owns no observation draft, UUID or UNKNOWN write
 * state. Parent must keep existing reviewed editors mounted through read loss. */
export function useManualRunCurrentReader(
  projectId: string,
  testRunId: string,
  organizationIdDiscovery: string | null | undefined,
  { active = true, ready = true }: { active?: boolean; ready?: boolean } = {},
) {
  const auth = useAuth(),
    hookSession = useMemo(
      () =>
        auth.userId && auth.sessionId
          ? { userId: auth.userId, sessionId: auth.sessionId }
          : null,
      [auth.userId, auth.sessionId],
    ),
    sdk = sdkSession(),
    sdkInstance = typeof window === "undefined" ? null : window.Clerk,
    organizationId = organizationIdDiscovery ?? "",
    client = useQueryClient();
  const [origin, setOrigin] = useState<ManualRunCurrentOrigin | null>(null),
    [originalIntent, setOriginalIntent] = useState<Readonly<{
      projectId: string;
      testRunId: string;
      organizationId: string;
      clerkActorId: string;
    }> | null>(null),
    [intent, setIntent] = useState<Intent | null>(null),
    [sdkEpoch, setSdkEpoch] = useState(0),
    sdkEpochRef = useRef(0),
    [listenerProof, setListenerProof] = useState<ListenerProof | null>(null),
    listenerRef = useRef<ListenerProof | null>(null),
    monitorCleanupRef = useRef(false),
    lastSdkRef = useRef<typeof sdkInstance>(null),
    [installationCycle, setInstallationCycle] = useState(0),
    [blocked, setBlocked] = useState<string | null>(null),
    [seen, setSeen] = useState<string | null>(null),
    [guard] = useState(() => new ManualRunCurrentRenderGuard());
  const viewRef = useRef<ManualRunCurrentSnapshot | null>(null),
    frameRef = useRef<
      | (Frame & {
          stamp: { renderGeneration: number; cacheGeneration: number };
        })
      | null
    >(null);
  const binding = JSON.stringify([
      projectId,
      testRunId,
      organizationId,
      active,
      ready,
      auth.isLoaded,
      auth.isSignedIn,
      hookSession,
      sdk,
    ]),
    [context, setContext] = useState({ binding, epoch: 0 });
  if (context.binding !== binding)
    setContext({ binding, epoch: context.epoch + 1 });
  const baseEligible =
    active &&
    ready &&
    context.binding === binding &&
    auth.isLoaded &&
    !!auth.isSignedIn &&
    !!projectId &&
    !!testRunId &&
    !!organizationId &&
    !!hookSession &&
    sameAuthScope(hookSession, sdk) &&
    (!originalIntent ||
      (originalIntent.projectId === projectId &&
        originalIntent.testRunId === testRunId &&
        originalIntent.organizationId === organizationId &&
        originalIntent.clerkActorId === hookSession.userId)) &&
    (!origin ||
      (origin.projectId === projectId &&
        origin.testRunId === testRunId &&
        origin.organizationId === organizationId &&
        origin.clerkActorId === hookSession.userId));
  if (!originalIntent && baseEligible)
    setOriginalIntent(
      Object.freeze({
        projectId,
        testRunId,
        organizationId,
        clerkActorId: hookSession!.userId,
      }),
    );
  const eligible =
    baseEligible && !!listenerProof && listenerProof.sdk === sdkInstance;
  if (!intent && !origin && eligible) {
    setIntent({
      requestId: crypto.randomUUID(),
      session: hookSession!,
      contextEpoch: context.epoch,
      sdkEpoch,
      origin: null,
    });
  }
  const enabled =
    !!eligible &&
    !!intent &&
    !guard.isBlocked(intent.requestId) &&
    blocked !== intent.requestId &&
    intent.contextEpoch === context.epoch &&
    intent.sdkEpoch === sdkEpoch &&
    sameAuthScope(intent.session, hookSession);
  const input: ManualRunCurrentInput = useMemo(
    () => ({
      projectId,
      testRunId,
      originalOrganizationId: organizationId || "unavailable",
      expectedClerkActorId: intent?.session.userId ?? "unavailable",
      ...(intent?.origin
        ? { expectedNativeActorId: intent.origin.nativeActorId }
        : {}),
      requestId: intent?.requestId ?? "00000000-0000-4000-8000-000000000000",
    }),
    [projectId, testRunId, organizationId, intent],
  );
  const query = trpcReact.manualRunReads.current.useQuery(input, {
    enabled,
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
  const admitted = useMemo(
    () =>
      enabled &&
      query.isFetchedAfterMount &&
      !query.error &&
      !query.isFetching &&
      !query.isPaused
        ? admitManualRunCurrent(query.data, input, origin)
        : null,
    [
      enabled,
      query.isFetchedAfterMount,
      query.error,
      query.isFetching,
      query.isPaused,
      query.data,
      input,
      origin,
    ],
  );
  if (!origin && admitted) setOrigin(admitted.origin);
  const refused =
    enabled &&
    !!intent &&
    (!!query.error ||
      query.isPaused ||
      // Any loss of an already admitted observer also revokes that nonce;
      // restoring the same cached object cannot establish another fresh read.
      (seen === intent.requestId && !admitted) ||
      (query.isFetchedAfterMount &&
        !query.isFetching &&
        !query.isPaused &&
        query.data !== undefined &&
        !admitted));
  if (refused && intent && blocked !== intent.requestId)
    setBlocked(intent.requestId);
  if (admitted && seen !== intent?.requestId)
    setSeen(intent?.requestId ?? null);
  const received = useMemo(
    () => ({
      at: new Date().toISOString(),
      data: admitted,
      revision: query.dataUpdatedAt,
    }),
    [admitted, query.dataUpdatedAt],
  );
  const snapshot = useMemo<ManualRunCurrentSnapshot | null>(
    () =>
      !refused &&
      admitted &&
      origin &&
      intent &&
      sameManualRunCurrentOrigin(admitted.origin, origin)
        ? Object.freeze({
            origin,
            observedSessionId: intent.session.sessionId,
            epoch: context.epoch + sdkEpoch,
            revision: query.dataUpdatedAt,
            receivedAt: received.at,
            data: admitted.data,
          })
        : null,
    [
      refused,
      admitted,
      origin,
      intent,
      context.epoch,
      sdkEpoch,
      query.dataUpdatedAt,
      received.at,
    ],
  );
  const frame: Frame = useMemo(
    () => ({
      projectId,
      testRunId,
      organizationId,
      active,
      eligible,
      baseEligible,
      listenerProof,
      session: hookSession,
      origin,
      contextEpoch: context.epoch,
      sdkEpoch,
      activation: intent?.requestId ?? null,
      key: getQueryKey(trpcReact.manualRunReads.current, input, "query"),
      raw: query.data,
      revision: query.dataUpdatedAt,
    }),
    [
      projectId,
      testRunId,
      organizationId,
      active,
      eligible,
      baseEligible,
      listenerProof,
      hookSession,
      origin,
      context.epoch,
      sdkEpoch,
      intent?.requestId,
      input,
      query.data,
      query.dataUpdatedAt,
    ],
  );
  const stamp = guard.observe(frame, snapshot);
  useLayoutEffect(() => {
    if (!guard.matchesRender(stamp)) return;
    frameRef.current = { ...frame, stamp };
    viewRef.current =
      guard.matchesRead(stamp, frame.activation) &&
      sdkEpochRef.current === frame.sdkEpoch &&
      listenerRef.current === frame.listenerProof &&
      frame.listenerProof?.sdk === window.Clerk
        ? snapshot
        : null;
    return () => {
      frameRef.current = null;
      viewRef.current = null;
    };
  }, [guard, stamp, frame, snapshot]);
  useLayoutEffect(() => {
    let live = true;
    const changed = () => {
      const captured =
        (guard.candidateFrame() as Frame | null) ??
        (viewRef.current ? frameRef.current : null);
      if (!live || !captured) return;
      const state = client.getQueryState(captured.key);
      if (
        state?.status !== "success" ||
        state.fetchStatus !== "idle" ||
        state.data !== captured.raw ||
        state.dataUpdatedAt !== captured.revision
      ) {
        guard.revokeCache(captured.activation);
        viewRef.current = null;
        setBlocked(captured.activation);
      }
    };
    const unsubscribe = client.getQueryCache().subscribe(changed);
    changed();
    return () => {
      live = false;
      unsubscribe();
    };
  }, [client, guard]);
  useLayoutEffect(() => {
    type SDK = NonNullable<typeof window.Clerk> & {
      addListener?: (listener: () => void) => () => void;
    };
    const clerk = sdkInstance as SDK | null;
    monitorCleanupRef.current = false;
    let live = true,
      observed = hookSession;
    if (lastSdkRef.current && lastSdkRef.current !== clerk) {
      sdkEpochRef.current++;
      setSdkEpoch(sdkEpochRef.current);
    }
    lastSdkRef.current = clerk;
    if (!clerk || typeof clerk.addListener !== "function") {
      listenerRef.current = null;
      setListenerProof(null);
      viewRef.current = null;
      return;
    }
    const proof: ListenerProof = Object.freeze({ sdk: clerk });
    const changed = () => {
      if (!live) return;
      if (window.Clerk !== clerk) {
        live = false;
        listenerRef.current = null;
        setListenerProof(null);
        viewRef.current = null;
        sdkEpochRef.current++;
        setSdkEpoch(sdkEpochRef.current);
        setInstallationCycle((value) => value + 1);
        return;
      }
      const next = sdkSession();
      if (
        !(observed === null && next === null) &&
        !sameAuthScope(observed, next)
      ) {
        observed = next;
        viewRef.current = null;
        sdkEpochRef.current++;
        setSdkEpoch(sdkEpochRef.current);
      }
    };
    let unsubscribe: (() => void) | undefined;
    try {
      const installed = clerk.addListener(changed);
      if (typeof installed === "function") unsubscribe = installed;
      if (typeof installed !== "function" || !live || window.Clerk !== clerk)
        throw Error("Independent SDK listener was not installed");
      listenerRef.current = proof;
      setListenerProof(proof);
    } catch {
      live = false;
      listenerRef.current = null;
      setListenerProof(null);
      viewRef.current = null;
      monitorCleanupRef.current = true;
      try {
        unsubscribe?.();
      } catch {
        // Already revoked; never publish a private SDK cleanup error.
      }
      monitorCleanupRef.current = false;
      return;
    }
    changed();
    return () => {
      live = false;
      monitorCleanupRef.current = true;
      if (listenerRef.current === proof) listenerRef.current = null;
      viewRef.current = null;
      try {
        unsubscribe?.();
      } catch {
        // Revocation precedes SDK cleanup even when cleanup throws.
      }
    };
  }, [
    sdkInstance,
    hookSession,
    projectId,
    testRunId,
    organizationId,
    installationCycle,
  ]);
  function monitored(frame: Frame) {
    if (!frame.listenerProof || listenerRef.current !== frame.listenerProof)
      return false;
    if (
      typeof window === "undefined" ||
      window.Clerk !== frame.listenerProof.sdk
    ) {
      listenerRef.current = null;
      viewRef.current = null;
      setListenerProof(null);
      sdkEpochRef.current++;
      setSdkEpoch(sdkEpochRef.current);
      setInstallationCycle((value) => value + 1);
      return false;
    }
    if (!sameAuthScope(frame.session, sdkSession())) {
      viewRef.current = null;
      sdkEpochRef.current++;
      setSdkEpoch(sdkEpochRef.current);
      return false;
    }
    return true;
  }
  function current() {
    const frame = frameRef.current,
      value = viewRef.current;
    if (
      !frame ||
      monitorCleanupRef.current ||
      !monitored(frame) ||
      !guard.matchesRender(stamp) ||
      !value ||
      !guard.matchesRead(frame.stamp, frame.activation) ||
      !frame.active ||
      !frame.eligible ||
      sdkEpochRef.current !== frame.sdkEpoch ||
      !sameAuthScope(frame.session, sdkSession()) ||
      frame.session?.sessionId !== value.observedSessionId ||
      !sameManualRunCurrentOrigin(frame.origin, value.origin) ||
      value.origin.projectId !== frame.projectId ||
      value.origin.testRunId !== frame.testRunId ||
      value.origin.organizationId !== frame.organizationId
    )
      return null;
    const state = client.getQueryState(frame.key);
    if (
      state?.status !== "success" ||
      state.fetchStatus !== "idle" ||
      state.data !== frame.raw ||
      state.dataUpdatedAt !== frame.revision
    ) {
      guard.revokeCache(frame.activation);
      viewRef.current = null;
      setBlocked(frame.activation);
      return null;
    }
    return value;
  }
  function refresh() {
    const frame = frameRef.current,
      now = sdkSession(),
      monitoredNow = !!frame && !monitorCleanupRef.current && monitored(frame);
    if (
      !frame ||
      !guard.matchesRender(stamp) ||
      monitorCleanupRef.current ||
      !guard.matchesRender(frame.stamp) ||
      !frame.active ||
      !frame.baseEligible ||
      !frame.session ||
      !sameAuthScope(frame.session, now) ||
      !frame.projectId ||
      !frame.testRunId ||
      !frame.organizationId ||
      (frame.origin &&
        (frame.origin.projectId !== frame.projectId ||
          frame.origin.testRunId !== frame.testRunId ||
          frame.origin.organizationId !== frame.organizationId ||
          frame.origin.clerkActorId !== now?.userId))
    )
      return false;
    if (!monitoredNow) {
      // Retry installation only; no native request or new nonce is authorized.
      setInstallationCycle((value) => value + 1);
      return false;
    }
    viewRef.current = null;
    guard.revokeActions();
    setIntent({
      requestId: crypto.randomUUID(),
      session: frame.session,
      contextEpoch: frame.contextEpoch,
      sdkEpoch: sdkEpochRef.current,
      origin: frame.origin,
    });
    return true;
  }
  return {
    origin,
    observedSessionId: snapshot?.observedSessionId ?? null,
    snapshot,
    fresh: snapshot?.data.view ?? null,
    readable: !!snapshot,
    loading: enabled && query.isFetching,
    error:
      baseEligible && !listenerProof
        ? "Independent SDK session monitoring is unavailable. Private run bodies stay withheld; explicitly refresh to retry installation."
        : enabled && query.error
          ? "The whole current native run read failed. Previous private bodies are withheld; explicitly refresh the original intent."
          : intent && !enabled
            ? "Original reader/session or current read changed. Cached procedures remain withheld until explicit fresh native access."
            : refused
              ? "The complete current run view could not be admitted. No unsupported fields or saved identities were dropped."
              : null,
    current,
    refresh,
  };
}
