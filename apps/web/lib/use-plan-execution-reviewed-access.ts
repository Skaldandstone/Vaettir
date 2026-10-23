"use client";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { currentSessionScope, sameAuthScope } from "./auth-query-cache";
import {
  admitPlanExecutionRead,
  inspectPlanExecutionReadWire,
  planExecutionReadWireSignature,
  planExecutionReadIdentity,
  planExecutionReviewedReadKey,
  isPlanExecutionPageInput,
  samePlanExecutionReadOrigin,
  PlanExecutionReadRenderGuard,
  type PlanExecutionReadInput,
  type PlanExecutionReadAccessInput,
  type PlanExecutionReadPageInput,
  type PlanExecutionReadOrigin,
  type PlanExecutionReadSnapshot,
  type PlanExecutionReadProjection,
} from "./plan-execution-reviewed-reader";

/** Unmounted transport adapter. Functions return untouched wire data; keys
 * merely isolate query storage and never confer current native authority. */
export type PlanExecutionReadAdapter = Readonly<{
  access(input: PlanExecutionReadAccessInput): Promise<unknown>;
  page(input: PlanExecutionReadPageInput): Promise<unknown>;
  key(projection: PlanExecutionReadProjection, input: PlanExecutionReadInput): QueryKey;
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
  projection: PlanExecutionReadProjection;
  session: Session;
  sdkEpoch: number;
  cacheEpoch: number;
  contextEpoch: number;
  origin: PlanExecutionReadOrigin | null;
  selection?: Readonly<Pick<PlanExecutionReadPageInput, "search" | "limit" | "cursor">>;
}>;
type Frame = {
  active: boolean;
  baseEligible: boolean;
  eligible: boolean;
  origin: PlanExecutionReadOrigin | null;
  session: Session | null;
  sdkEpoch: number;
  cacheEpoch: number;
  contextEpoch: number;
  activation: string | null;
  sdkProof: SDKProof | null;
  cacheProof: CacheProof | null;
  adapter: PlanExecutionReadAdapter | undefined;
  key: QueryKey;
  raw: unknown;
  revision: number;
  projection: PlanExecutionReadProjection;
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
    if (!planExecutionReadIdentity(sessionId) || !planExecutionReadIdentity(userId))
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
  adapter: PlanExecutionReadAdapter | undefined,
  projection: PlanExecutionReadProjection,
  input: PlanExecutionReadInput,
): QueryKey {
  try {
    if (!adapter) return ["plan-execution-reviewed-unavailable"];
    const key = adapter.key(projection, input);
    inspectPlanExecutionReadWire(key, 8192);
    if (!Array.isArray(key)) throw Error();
    return Object.freeze([
      "plan-execution-reviewed",
      projection,
      input,
      immutableKey(key),
    ]);
  } catch {
    return ["plan-execution-reviewed-unavailable"];
  }
}
/** Template/current candidate metadata only. Neither projection grants save,
 * start, frozen cohort approval or receipt recovery. Original N belongs only
 * to this newly observed reader, never to a historical UNKNOWN attempt. */
export function usePlanExecutionReviewedAccess(
  projectId: string,
  testPlanId: string,
  organizationId: string | null | undefined,
  adapter?: PlanExecutionReadAdapter,
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
  const [origin, setOrigin] = useState<PlanExecutionReadOrigin | null>(null),
    [original, setOriginal] = useState<Readonly<{
      projectId: string;
      testPlanId: string;
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
    [guard] = useState(() => new PlanExecutionReadRenderGuard());
  const [cacheEpoch, setCacheEpoch] = useState(0),
    cacheEpochRef = useRef(0),
    admittedEver = useRef(false);
  const binding = JSON.stringify([
      projectId,
      testPlanId,
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
    [projectId, testPlanId, organizationId, session.userId].every(planExecutionReadIdentity) &&
    originalNativeActorId !== null &&
    (originalNativeActorId === undefined ||
      planExecutionReadIdentity(originalNativeActorId)) &&
    (!origin ||
      (origin.projectId === projectId &&
        origin.testPlanId === testPlanId &&
        origin.organizationId === organizationId &&
        origin.clerkActorId === session.userId &&
        (originalNativeActorId === undefined ||
          origin.nativeActorId === originalNativeActorId))) &&
    (!original ||
      (original.projectId === projectId &&
        original.testPlanId === testPlanId &&
        original.organizationId === organizationId &&
        original.clerkActorId === session.userId &&
        (original.nativeActorId === undefined
          ? originalNativeActorId === undefined
          : original.nativeActorId === originalNativeActorId)));
  if (!original && baseEligible)
    setOriginal(
      Object.freeze({
        projectId,
        testPlanId,
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
  const input: PlanExecutionReadInput = useMemo(
    () =>
      Object.freeze({
        projectId: original?.projectId ?? projectId,
        testPlanId: original?.testPlanId ?? testPlanId,
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
        ...(intent?.projection === "PAGE" && intent.selection ? intent.selection : {}),
      }),
    [projectId, testPlanId, organizationId, original, intent],
  );
  const projection = intent?.projection ?? "ACCESS",
    pageReady = enabled && !!origin && !!input.expectedNativeActorId && "search" in input;
  const accessInput = useMemo<PlanExecutionReadAccessInput>(() => Object.freeze({
    projectId: input.projectId, testPlanId: input.testPlanId,
    originalOrganizationId: input.originalOrganizationId,
    expectedClerkActorId: input.expectedClerkActorId, requestId: input.requestId,
    ...(input.expectedNativeActorId === undefined ? {} : { expectedNativeActorId: input.expectedNativeActorId }),
  }), [input]);
  const accessKey = useMemo(
      () => safeKey(adapter, "ACCESS", accessInput),
      [adapter, accessInput],
    ),
    pageKey = useMemo(
      () => safeKey(adapter, "PAGE", input),
      [adapter, input],
    );
  const options = {
    retry: false as const,
    staleTime: 0,
    refetchOnWindowFocus: false,
    refetchOnMount: false as const,
    // Only the two observed query slots survive. Prior unobserved nonce/page
    // entries are discarded; this reader is not a saved-page history store.
    gcTime: 0,
  };
  // Fixed actual TanStack hook order even while the namespace/adapter is absent.
  const accessQuery = useQuery({
    ...options,
    queryKey: accessKey,
    enabled:
      enabled &&
      projection === "ACCESS" &&
      accessKey[0] === "plan-execution-reviewed",
    queryFn: () => {
      if (!adapter) throw Error("Transport unavailable");
      return adapter.access(accessInput);
    },
  });
  const pageQuery = useQuery({
    ...options,
    queryKey: pageKey,
    enabled:
      pageReady &&
      projection === "PAGE" &&
      pageKey[0] === "plan-execution-reviewed",
    queryFn: () => {
      if (!adapter || !isPlanExecutionPageInput(input))
        throw Error("Native page scope unavailable");
      return adapter.page(input);
    },
  });
  const query = projection === "ACCESS" ? accessQuery : pageQuery,
    key = projection === "ACCESS" ? accessKey : pageKey;
  const admitted = useMemo(
    () =>
      enabled &&
      (projection === "ACCESS" || pageReady) &&
      query.isFetchedAfterMount &&
      !query.error &&
      !query.isFetching &&
      !query.isPaused
        ? admitPlanExecutionRead(
            query.data,
            input,
            projection,
            intent!.session.userId,
            origin,
          )
        : null,
    [
      enabled,
      pageReady,
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
    (key[0] !== "plan-execution-reviewed" ||
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
  const snapshot = useMemo<PlanExecutionReadSnapshot | null>(
    () =>
      !refused &&
      admitted &&
      origin &&
      intent &&
      samePlanExecutionReadOrigin(origin, admitted.origin)
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
        ? planExecutionReadWireSignature(admitted.data, projection)
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
    viewRef = useRef<PlanExecutionReadSnapshot | null>(null),
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
      !state.isInvalidated &&
      state.fetchStatus === "idle" &&
      state.data === frame.raw &&
      state.dataUpdatedAt === frame.revision &&
      planExecutionReadWireSignature(state.data, frame.projection) ===
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
        state.isInvalidated ||
        state.fetchStatus !== "idle" ||
        state.data !== captured.raw ||
        state.dataUpdatedAt !== captured.revision ||
        planExecutionReadWireSignature(state.data, captured.projection) !==
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
      !samePlanExecutionReadOrigin(f.origin, v.origin)
    )
      return null;
    const state = client.getQueryState(f.key);
    if (
      state?.status !== "success" ||
      state.isInvalidated ||
      state.fetchStatus !== "idle" ||
      state.data !== f.raw ||
      state.dataUpdatedAt !== f.revision ||
      planExecutionReadWireSignature(state.data, f.projection) !== f.signature
    ) {
      guard.revokeCache(f.activation);
      viewRef.current = null;
      setBlocked(f.activation);
      return null;
    }
    return v;
  }
  function begin(projection: PlanExecutionReadProjection, selection?: Pick<PlanExecutionReadPageInput, "search" | "limit" | "cursor">) {
    const f = frameRef.current,
      now = sdkSession();
    if (
      !["ACCESS", "PAGE"].includes(projection) ||
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
    if (projection === "PAGE") {
      if (!current() || !f.origin || !selection) return false;
      try {
        inspectPlanExecutionReadWire(selection, 16384);
        if (!Object.hasOwn(selection, "search") || !Object.hasOwn(selection, "limit") || Object.keys(selection).some(key => !["search", "limit", "cursor"].includes(key))) return false;
        const check = { projectId: f.origin.projectId, testPlanId: f.origin.testPlanId, originalOrganizationId: f.origin.organizationId, expectedClerkActorId: f.origin.clerkActorId, expectedNativeActorId: f.origin.nativeActorId, requestId: crypto.randomUUID(), ...selection };
        // Reuse complete exact request validation before freezing selection.
        if (!planExecutionReviewedReadKey(check, "PAGE")) return false;
        selection = immutableKey(selection) as typeof selection;
      } catch { return false; }
    }
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
        ...(projection === "PAGE" ? { selection } : {}),
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
    readPage: (selection: Pick<PlanExecutionReadPageInput, "search" | "limit" | "cursor">) => begin("PAGE", selection),
    observedSessionId: snapshot?.observedSessionId ?? null,
    readable: !!snapshot,
    hasFullEditorAccess: snapshot?.data.hasFullEditorAccess ?? false,
    canSave: false as const,
    canStart: false as const,
    cohortVerified: false as const,
    receiptVerified: false as const,
    loading: enabled && query.isFetching,
    error: !adapter
      ? "The reviewed plan-execution metadata transport is unavailable. No cached authority was substituted."
      : !guard.canRenew()
        ? "The current metadata reader reached its bounded activation history. Views stay withheld; no retained run request was changed or discarded."
        : baseEligible && (!sdkProof || !cacheProof)
          ? "Independent session/cache monitoring is unavailable. Plan execution metadata stays withheld; explicitly refresh to retry installation."
          : refused || query.error
            ? "The exact current plan-execution metadata could not be admitted. Explicitly refresh original access."
            : intent && !enabled
              ? "Original reader/session or monitoring changed. Explicit native refresh is required; cached metadata is withheld."
              : null,
  };
}
