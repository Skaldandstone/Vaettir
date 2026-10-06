"use client";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { currentSessionScope, sameAuthScope } from "./auth-query-cache";
import {
  admitRunStartRead,
  inspectRunStartReadWire,
  runStartReadWireSignature,
  runStartReadIdentity,
  sameRunStartReadOrigin,
  RunStartReadRenderGuard,
  type RunStartReadInput,
  type RunStartReadOrigin,
  type RunStartReadSnapshot,
  type RunStartProjection,
} from "./manual-run-start-reviewed-reader";

/** Unmounted transport adapter. Functions return untouched wire data; keys
 * merely isolate query storage and never confer current native authority. */
export type ManualRunStartReadAdapter = Readonly<{
  access(input: RunStartReadInput): Promise<unknown>;
  preview(
    input: RunStartReadInput & { expectedNativeActorId: string },
  ): Promise<unknown>;
  key(projection: RunStartProjection, input: RunStartReadInput): QueryKey;
}>;
type Session = NonNullable<ReturnType<typeof currentSessionScope>>;
type Client = ReturnType<typeof useQueryClient>;
type SDKProof = Readonly<{ resource: NonNullable<typeof window.Clerk> }>;
type CacheProof = Readonly<{
  client: Client;
  cache: ReturnType<Client["getQueryCache"]>;
}>;
type Intent = Readonly<{
  requestId: string;
  projection: RunStartProjection;
  session: Session;
  sdkEpoch: number;
  cacheEpoch: number;
  contextEpoch: number;
  origin: RunStartReadOrigin | null;
}>;
type Frame = {
  active: boolean;
  baseEligible: boolean;
  eligible: boolean;
  origin: RunStartReadOrigin | null;
  session: Session | null;
  sdkEpoch: number;
  cacheEpoch: number;
  contextEpoch: number;
  activation: string | null;
  sdkProof: SDKProof | null;
  cacheProof: CacheProof | null;
  adapter: ManualRunStartReadAdapter | undefined;
  key: QueryKey;
  raw: unknown;
  revision: number;
  projection: RunStartProjection;
  signature: string | null;
  queryIdentity: object | undefined;
};
/** Read the installed resource and exact session together. Getter failures and
 * malformed identities are unavailable, never cached or synthesized authority. */
function readSDK(): Readonly<{
  resource: SDKProof["resource"] | null;
  session: Session | null;
}> {
  try {
    const resource =
      typeof window === "undefined" ? null : (window.Clerk ?? null);
    if (!resource || resource.loaded !== true)
      return { resource, session: null };
    const session = resource.session;
    if (!session) return { resource, session: null };
    const sessionId = session.id,
      userId = session.user.id;
    if (!runStartReadIdentity(sessionId) || !runStartReadIdentity(userId))
      return { resource, session: null };
    return { resource, session: Object.freeze({ sessionId, userId }) };
  } catch {
    return { resource: null, session: null };
  }
}
function sdkSession() {
  return readSDK().session;
}
function immutableKey(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  return Object.freeze(
    Array.isArray(value)
      ? value.map(immutableKey)
      : Object.fromEntries(
          Object.entries(value).map(([k, v]) => [k, immutableKey(v)]),
        ),
  );
}
function safeKey(
  adapter: ManualRunStartReadAdapter | undefined,
  projection: RunStartProjection,
  input: RunStartReadInput,
): QueryKey {
  try {
    if (!adapter) return ["manual-run-start-reviewed-unavailable"];
    const key = adapter.key(projection, input);
    inspectRunStartReadWire(key, 8192);
    if (!Array.isArray(key)) throw Error();
    return Object.freeze([
      "manual-run-start-reviewed",
      projection,
      input,
      immutableKey(key),
    ]);
  } catch {
    return ["manual-run-start-reviewed-unavailable"];
  }
}
/** Profile-metadata reader only. No selected cohort, configuration, procedure,
 * receipt or run-start permission is inferred from either projection. Original
 * N is established only for this new reader, never for an old pending attempt. */
export function useManualRunStartReviewedAccess(
  projectId: string,
  organizationId: string | null | undefined,
  adapter?: ManualRunStartReadAdapter,
  {
    active = true,
    originalNativeActorId,
  }: { active?: boolean; originalNativeActorId?: string | null } = {},
) {
  const auth = useAuth(),
    session = useMemo(
      () =>
        auth.userId && auth.sessionId
          ? Object.freeze({ userId: auth.userId, sessionId: auth.sessionId })
          : null,
      [auth.userId, auth.sessionId],
    ),
    sdkRead = readSDK(),
    sdk = sdkRead.session,
    instance = sdkRead.resource,
    client = useQueryClient(),
    cache = client.getQueryCache();
  const [origin, setOrigin] = useState<RunStartReadOrigin | null>(null),
    [original, setOriginal] = useState<Readonly<{
      projectId: string;
      organizationId: string;
      clerkActorId: string;
      nativeActorId?: string;
    }> | null>(null),
    [intent, setIntent] = useState<Intent | null>(null),
    [seen, setSeen] = useState<string | null>(null),
    [blocked, setBlocked] = useState<string | null>(null),
    [sdkEpoch, setSdkEpoch] = useState(0),
    sdkEpochRef = useRef(0),
    [sdkProof, setSdkProof] = useState<SDKProof | null>(null),
    sdkRef = useRef<SDKProof | null>(null),
    [cacheProof, setCacheProof] = useState<CacheProof | null>(null),
    cacheRef = useRef<CacheProof | null>(null),
    cleanupRef = useRef(false),
    [installation, setInstallation] = useState(0),
    lastSDK = useRef<typeof instance>(null),
    [guard] = useState(() => new RunStartReadRenderGuard());
  const [cacheEpoch, setCacheEpoch] = useState(0),
    cacheEpochRef = useRef(0),
    admittedEver = useRef(false);
  const binding = JSON.stringify([
      projectId,
      organizationId ?? null,
      originalNativeActorId ?? null,
      active,
      auth.isLoaded,
      auth.isSignedIn,
      session,
      sdk,
    ]),
    [context, setContext] = useState({ binding, adapter, epoch: 0 });
  if (binding !== context.binding || adapter !== context.adapter)
    setContext({ binding, adapter, epoch: context.epoch + 1 });
  const baseEligible =
    active &&
    context.binding === binding &&
    context.adapter === adapter &&
    !!adapter &&
    auth.isLoaded &&
    !!auth.isSignedIn &&
    !!session &&
    sameAuthScope(session, sdk) &&
    [projectId, organizationId, session.userId].every(runStartReadIdentity) &&
    originalNativeActorId !== null &&
    (originalNativeActorId === undefined ||
      runStartReadIdentity(originalNativeActorId)) &&
    (!origin ||
      (origin.projectId === projectId &&
        origin.organizationId === organizationId &&
        origin.clerkActorId === session.userId &&
        (originalNativeActorId === undefined ||
          origin.nativeActorId === originalNativeActorId))) &&
    (!original ||
      (original.projectId === projectId &&
        original.organizationId === organizationId &&
        original.clerkActorId === session.userId &&
        (original.nativeActorId === undefined
          ? originalNativeActorId === undefined
          : original.nativeActorId === originalNativeActorId)));
  if (!original && baseEligible)
    setOriginal(
      Object.freeze({
        projectId,
        organizationId: organizationId!,
        clerkActorId: session!.userId,
        ...(originalNativeActorId === undefined
          ? {}
          : { nativeActorId: originalNativeActorId }),
      }),
    );
  const eligible =
    baseEligible &&
    !!sdkProof &&
    sdkProof.resource === instance &&
    !!cacheProof &&
    cacheProof.client === client &&
    cacheProof.cache === cache;
  if (!intent && !origin && eligible)
    setIntent(
      Object.freeze({
        requestId: crypto.randomUUID(),
        projection: "ACCESS",
        session: session!,
        sdkEpoch,
        cacheEpoch,
        contextEpoch: context.epoch,
        origin: null,
      }),
    );
  const enabled =
    eligible &&
    !!intent &&
    !guard.isBlocked(intent.requestId) &&
    blocked !== intent.requestId &&
    intent.sdkEpoch === sdkEpoch &&
    intent.cacheEpoch === cacheEpoch &&
    intent.contextEpoch === context.epoch &&
    sameAuthScope(intent.session, session);
  const input: RunStartReadInput = useMemo(
    () =>
      Object.freeze({
        projectId: original?.projectId ?? projectId,
        originalOrganizationId:
          original?.organizationId ?? organizationId ?? "unavailable",
        expectedClerkActorId:
          original?.clerkActorId ?? intent?.session.userId ?? "unavailable",
        ...(intent?.origin || original?.nativeActorId
          ? {
              expectedNativeActorId:
                intent?.origin?.nativeActorId ?? original!.nativeActorId!,
            }
          : {}),
        requestId: intent?.requestId ?? "00000000-0000-4000-8000-000000000000",
      }),
    [projectId, organizationId, original, intent],
  );
  const projection = intent?.projection ?? "ACCESS",
    previewReady = enabled && !!origin && !!input.expectedNativeActorId;
  const accessKey = useMemo(
      () => safeKey(adapter, "ACCESS", input),
      [adapter, input],
    ),
    previewKey = useMemo(
      () => safeKey(adapter, "PREVIEW", input),
      [adapter, input],
    );
  const options = {
    retry: false as const,
    staleTime: 0,
    refetchOnWindowFocus: false,
    refetchOnMount: false as const,
  };
  // Fixed actual TanStack hook order even while the namespace/adapter is absent.
  const accessQuery = useQuery({
    ...options,
    queryKey: accessKey,
    enabled:
      enabled &&
      projection === "ACCESS" &&
      accessKey[0] === "manual-run-start-reviewed",
    queryFn: () => {
      if (!adapter) throw Error("Transport unavailable");
      return adapter.access(input);
    },
  });
  const previewQuery = useQuery({
    ...options,
    queryKey: previewKey,
    enabled:
      previewReady &&
      projection === "PREVIEW" &&
      previewKey[0] === "manual-run-start-reviewed",
    queryFn: () => {
      if (!adapter || !input.expectedNativeActorId)
        throw Error("Native preview scope unavailable");
      return adapter.preview({
        ...input,
        expectedNativeActorId: input.expectedNativeActorId,
      });
    },
  });
  const query = projection === "ACCESS" ? accessQuery : previewQuery,
    key = projection === "ACCESS" ? accessKey : previewKey;
  const admitted = useMemo(
    () =>
      enabled &&
      (projection === "ACCESS" || previewReady) &&
      query.isFetchedAfterMount &&
      !query.error &&
      !query.isFetching &&
      !query.isPaused
        ? admitRunStartRead(
            query.data,
            input,
            projection,
            intent!.session.userId,
            origin,
          )
        : null,
    [
      enabled,
      previewReady,
      projection,
      query.isFetchedAfterMount,
      query.error,
      query.isFetching,
      query.isPaused,
      query.data,
      input,
      intent,
      origin,
    ],
  );
  if (!origin && admitted) setOrigin(admitted.origin);
  const refused =
    enabled &&
    !!intent &&
    (key[0] !== "manual-run-start-reviewed" ||
      !!query.error ||
      query.isPaused ||
      (seen === intent.requestId && !admitted) ||
      (query.isFetchedAfterMount &&
        !query.isFetching &&
        query.data !== undefined &&
        !admitted));
  if (refused && intent && blocked !== intent.requestId)
    setBlocked(intent.requestId);
  const received = useMemo(
    () => ({
      admitted,
      revision: query.dataUpdatedAt,
      at: new Date().toISOString(),
    }),
    [admitted, query.dataUpdatedAt],
  );
  const snapshot = useMemo<RunStartReadSnapshot | null>(
    () =>
      !refused &&
      admitted &&
      origin &&
      intent &&
      sameRunStartReadOrigin(origin, admitted.origin)
        ? Object.freeze({
            origin,
            observedSessionId: intent.session.sessionId,
            projection,
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
      projection,
      context.epoch,
      sdkEpoch,
      query.dataUpdatedAt,
      received.at,
    ],
  );
  const frame: Frame = useMemo(
    () => ({
      active,
      baseEligible,
      eligible,
      origin,
      session,
      sdkEpoch,
      cacheEpoch,
      contextEpoch: context.epoch,
      activation: intent?.requestId ?? null,
      sdkProof,
      cacheProof,
      adapter,
      key,
      raw: query.data,
      revision: query.dataUpdatedAt,
      projection,
      signature: admitted
        ? runStartReadWireSignature(admitted.data, projection)
        : null,
      queryIdentity: cache.find({ queryKey: key, exact: true }),
    }),
    [
      active,
      baseEligible,
      eligible,
      origin,
      session,
      sdkEpoch,
      cacheEpoch,
      context.epoch,
      intent?.requestId,
      sdkProof,
      cacheProof,
      adapter,
      key,
      query.data,
      query.dataUpdatedAt,
      projection,
      admitted,
      cache,
    ],
  );
  const stamp = guard.observe(frame, snapshot),
    viewRef = useRef<RunStartReadSnapshot | null>(null),
    frameRef = useRef<(Frame & { stamp: typeof stamp }) | null>(null);
  // An ephemeral effect token, not native/read authority: inspect every commit
  // even if a silent SDK change followed an otherwise identical render.
  const publication = Symbol();
  useLayoutEffect(() => {
    if (!guard.matchesRender(stamp)) return;
    frameRef.current = { ...frame, stamp };
    const state = client.getQueryState(frame.key);
    const sdkNow = readSDK();
    const exactSession = sameAuthScope(frame.session, sdkNow.session);
    const admittedNow =
      guard.matchesRead(stamp, frame.activation) &&
      exactSession &&
      sdkEpochRef.current === frame.sdkEpoch &&
      cacheEpochRef.current === frame.cacheEpoch &&
      sdkRef.current === frame.sdkProof &&
      cacheRef.current === frame.cacheProof &&
      frame.sdkProof?.resource === sdkNow.resource &&
      frame.cacheProof?.cache === client.getQueryCache() &&
      state?.status === "success" &&
      state.fetchStatus === "idle" &&
      state.data === frame.raw &&
      state.dataUpdatedAt === frame.revision &&
      runStartReadWireSignature(state.data, frame.projection) ===
        frame.signature;
    viewRef.current = admittedNow ? snapshot : null;
    if (snapshot && !admittedNow) {
      guard.revokeCache(frame.activation);
      setBlocked(frame.activation);
      if (!exactSession) {
        sdkEpochRef.current++;
        setSdkEpoch(sdkEpochRef.current);
      }
    }
    if (viewRef.current) {
      admittedEver.current = true;
      setSeen((previous) =>
        previous === frame.activation ? previous : frame.activation,
      );
    }
    return () => {
      frameRef.current = null;
      viewRef.current = null;
    };
  }, [publication, guard, stamp, frame, snapshot, client]);
  useLayoutEffect(() => {
    let live = true;
    const epoch = cacheEpochRef;
    setCacheEpoch(epoch.current);
    const proof: CacheProof = Object.freeze({ client, cache });
    const changed = (event?: { query?: object }) => {
      const captured =
        (guard.candidateFrame() as Frame | null) ??
        (viewRef.current ? frameRef.current : null);
      if (!live || !captured) return;
      if (event && event.query !== captured.queryIdentity) return;
      const state = client.getQueryState(captured.key);
      if (
        client.getQueryCache() !== cache ||
        state?.status !== "success" ||
        state.fetchStatus !== "idle" ||
        state.data !== captured.raw ||
        state.dataUpdatedAt !== captured.revision ||
        runStartReadWireSignature(state.data, captured.projection) !==
          captured.signature
      ) {
        guard.revokeCache(captured.activation);
        viewRef.current = null;
        setBlocked(captured.activation);
      }
    };
    let unsubscribe: (() => void) | undefined;
    try {
      const installed = cache.subscribe(changed);
      if (typeof installed !== "function")
        throw Error("Cache listener unavailable");
      unsubscribe = installed;
      cacheRef.current = proof;
      setCacheProof(proof);
      changed();
    } catch {
      live = false;
      cacheRef.current = null;
      viewRef.current = null;
      guard.revokeActions();
      setCacheProof(null);
      try {
        unsubscribe?.();
      } catch {
        /* Already revoked. */
      }
      return;
    }
    return () => {
      live = false;
      cacheRef.current = null;
      viewRef.current = null;
      guard.revokeActions();
      if (admittedEver.current) epoch.current++;
      try {
        unsubscribe?.();
      } catch {
        /* Detached before cleanup. */
      }
    };
  }, [client, cache, guard, installation]);
  useLayoutEffect(() => {
    cleanupRef.current = false;
    let live = true,
      observed = sdkSession();
    const epoch = sdkEpochRef;
    if (lastSDK.current && lastSDK.current !== instance) {
      epoch.current++;
      setSdkEpoch(epoch.current);
    }
    setSdkEpoch(epoch.current);
    lastSDK.current = instance;
    let addListener: unknown;
    try {
      addListener = instance ? Reflect.get(instance, "addListener") : undefined;
    } catch {
      sdkRef.current = null;
      viewRef.current = null;
      guard.revokeActions();
      setSdkProof(null);
      return;
    }
    if (typeof addListener !== "function") {
      sdkRef.current = null;
      viewRef.current = null;
      setSdkProof(null);
      return;
    }
    const proof: SDKProof = Object.freeze({ resource: instance! });
    const revoke = () => {
      viewRef.current = null;
      const captured =
        (guard.candidateFrame() as Frame | null) ?? frameRef.current;
      if (captured?.activation) {
        guard.revokeCache(captured.activation);
        setBlocked(captured.activation);
      }
      epoch.current++;
      setSdkEpoch(epoch.current);
    };
    const changed = () => {
      if (!live) return;
      const sdkNow = readSDK();
      if (sdkNow.resource !== instance) {
        live = false;
        sdkRef.current = null;
        setSdkProof(null);
        revoke();
        setInstallation((v) => v + 1);
        return;
      }
      const next = sdkNow.session;
      if (
        !(observed === null && next === null) &&
        !sameAuthScope(observed, next)
      ) {
        observed = next;
        revoke();
      }
    };
    let unsubscribe: (() => void) | undefined;
    try {
      const installed = addListener.call(instance, changed);
      if (typeof installed === "function") unsubscribe = installed;
      if (!unsubscribe || !live || readSDK().resource !== instance)
        throw Error("SDK listener unavailable");
      sdkRef.current = proof;
      setSdkProof(proof);
      changed();
    } catch {
      live = false;
      cleanupRef.current = true;
      sdkRef.current = null;
      viewRef.current = null;
      guard.revokeActions();
      setSdkProof(null);
      try {
        unsubscribe?.();
      } catch {
        /* Already revoked. */
      }
      cleanupRef.current = false;
      return;
    }
    return () => {
      live = false;
      cleanupRef.current = true;
      sdkRef.current = null;
      viewRef.current = null;
      guard.revokeActions();
      if (admittedEver.current) epoch.current++;
      try {
        unsubscribe?.();
      } catch {
        /* Revocation precedes cleanup. */
      }
    };
  }, [instance, installation, guard]);
  function monitored(f: Frame) {
    if (
      cleanupRef.current ||
      !f.sdkProof ||
      sdkRef.current !== f.sdkProof ||
      !f.cacheProof ||
      cacheRef.current !== f.cacheProof
    )
      return false;
    const sdkNow = readSDK();
    if (
      sdkNow.resource !== f.sdkProof.resource ||
      client.getQueryCache() !== f.cacheProof.cache ||
      !sameAuthScope(f.session, sdkNow.session)
    ) {
      viewRef.current = null;
      guard.revokeCache(f.activation);
      setBlocked(f.activation);
      sdkEpochRef.current++;
      setSdkEpoch(sdkEpochRef.current);
      if (sdkNow.resource !== f.sdkProof.resource) {
        sdkRef.current = null;
        setSdkProof(null);
        setInstallation((v) => v + 1);
      }
      return false;
    }
    return true;
  }
  function current() {
    const f = frameRef.current,
      v = viewRef.current;
    // A revoked/empty view grants nothing. Repeated render-time reads must not
    // enqueue monitoring updates; explicit ACCESS refresh owns reinstallation.
    if (!f || !v) return null;
    if (
      !guard.matchesRender(stamp) ||
      !monitored(f) ||
      !guard.matchesRead(f.stamp, f.activation) ||
      !f.active ||
      !f.eligible ||
      sdkEpochRef.current !== f.sdkEpoch ||
      cacheEpochRef.current !== f.cacheEpoch ||
      f.session?.sessionId !== v.observedSessionId ||
      !sameRunStartReadOrigin(f.origin, v.origin)
    )
      return null;
    const state = client.getQueryState(f.key);
    if (
      state?.status !== "success" ||
      state.fetchStatus !== "idle" ||
      state.data !== f.raw ||
      state.dataUpdatedAt !== f.revision ||
      runStartReadWireSignature(state.data, f.projection) !== f.signature
    ) {
      guard.revokeCache(f.activation);
      viewRef.current = null;
      setBlocked(f.activation);
      return null;
    }
    return v;
  }
  function begin(projection: RunStartProjection) {
    const f = frameRef.current,
      now = sdkSession();
    if (
      !["ACCESS", "PREVIEW"].includes(projection) ||
      !guard.canRenew() ||
      !f ||
      !guard.matchesRender(stamp) ||
      !guard.matchesRender(f.stamp) ||
      cleanupRef.current ||
      !f.baseEligible ||
      !f.active ||
      !f.session ||
      !sameAuthScope(f.session, now)
    )
      return false;
    if (!monitored(f)) {
      if (!cleanupRef.current) setInstallation((v) => v + 1);
      return false;
    }
    if (projection === "PREVIEW" && (!current() || !f.origin)) return false;
    viewRef.current = null;
    guard.revokeActions();
    setIntent(
      Object.freeze({
        requestId: crypto.randomUUID(),
        projection,
        session: f.session,
        sdkEpoch: sdkEpochRef.current,
        cacheEpoch: cacheEpochRef.current,
        contextEpoch: f.contextEpoch,
        origin: f.origin,
      }),
    );
    return true;
  }
  return {
    origin,
    snapshot,
    fresh: snapshot?.data ?? null,
    projection,
    current,
    refresh: () => begin("ACCESS"),
    readPreview: () => begin("PREVIEW"),
    observedSessionId: snapshot?.observedSessionId ?? null,
    readable: !!snapshot,
    canRecoverMetadata: !!snapshot?.data.canRecover,
    canStartMetadata:
      snapshot?.projection === "PREVIEW" &&
      "canStart" in snapshot.data &&
      snapshot.data.canStart,
    cohortVerified: false as const,
    receiptVerified: false as const,
    loading: enabled && query.isFetching,
    error: !adapter
      ? "The reviewed run-start metadata transport is unavailable. No cached authority was substituted."
      : !guard.canRenew()
        ? "The current metadata reader reached its bounded activation history. Views stay withheld; no retained run request was changed or discarded."
        : baseEligible && (!sdkProof || !cacheProof)
          ? "Independent session/cache monitoring is unavailable. Run-start metadata stays withheld; explicitly refresh to retry installation."
          : refused || query.error
            ? "The exact current run-start metadata could not be admitted. Explicitly refresh original access."
            : intent && !enabled
              ? "Original reader/session or monitoring changed. Explicit native refresh is required; cached metadata is withheld."
              : null,
  };
}
