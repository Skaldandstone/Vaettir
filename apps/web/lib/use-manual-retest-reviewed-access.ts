"use client";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { trpcReact, type RouterInputs } from "./trpcReact";
import { currentSessionScope, sameAuthScope } from "./auth-query-cache";
import { admitRetestRead, inspectRetestWire, retestIdentity, sameRetestOrigin, RetestReadRenderGuard, type RetestReviewedInput, type RetestReviewedOrigin, type RetestReviewedSnapshot, type RetestProjection } from "./manual-retest-reviewed-read";
import type { ManualRunCurrentOrigin } from "./manual-run-current-reader";
type Session = NonNullable<ReturnType<typeof currentSessionScope>>;
type Client = ReturnType<typeof useQueryClient>;
type SDKProof = Readonly<{ resource: NonNullable<typeof window.Clerk> }>;
type CacheProof = Readonly<{ client: Client; cache: ReturnType<Client["getQueryCache"]> }>;
type Intent = Readonly<{ requestId: string; projection: RetestProjection; before?: string; session: Session; sdkEpoch: number; cacheEpoch: number; contextEpoch: number; origin: RetestReviewedOrigin | null }>;
type Frame = { active: boolean; baseEligible: boolean; parentPresented: boolean; parentCurrent: (() => boolean) | null | undefined; eligible: boolean; origin: RetestReviewedOrigin | null; session: Session | null; sdkEpoch: number; cacheEpoch: number; contextEpoch: number; activation: string | null; sdkProof: SDKProof | null; cacheProof: CacheProof | null; key: QueryKey; raw: unknown; revision: number; projection: RetestProjection };
function sdkSession() { return typeof window === "undefined" ? null : currentSessionScope(window.Clerk?.loaded ? window.Clerk.session : null); }
function parentCurrent(callback: (() => boolean) | null | undefined) { try { return callback === undefined || typeof callback === "function" && callback() === true; } catch { return false; } }
function parentMatches(pin: ManualRunCurrentOrigin | null | undefined, projectId: string, sourceRunId: string) { try { inspectRetestWire(pin, 8192); return !!pin && pin.projectId === projectId && pin.testRunId === sourceRunId && [pin.projectId, pin.testRunId, pin.organizationId, pin.clerkActorId, pin.nativeActorId].every(retestIdentity); } catch { return false; } }
function copyParent(p: ManualRunCurrentOrigin) { return Object.freeze({ projectId: p.projectId, testRunId: p.testRunId, organizationId: p.organizationId, clerkActorId: p.clerkActorId, nativeActorId: p.nativeActorId }); }
function sameParent(a: ManualRunCurrentOrigin, b: ManualRunCurrentOrigin) { return a.projectId === b.projectId && a.testRunId === b.testRunId && a.organizationId === b.organizationId && a.clerkActorId === b.clerkActorId && a.nativeActorId === b.nativeActorId; }
/** Read-only foundation, no draft/approval/write UUID/capability ownership.
 * ACCESS does not prove source relationships or FULL write/recovery permission. */
export function useManualRetestReviewedAccess(projectId: string, sourceRunId: string, testCaseId: string, { active = true, organizationId, parentRunScope, parentCurrent: presentation, parentActivation }: { active?: boolean; organizationId?: string | null; parentRunScope?: ManualRunCurrentOrigin | null; parentCurrent?: (() => boolean) | null; parentActivation?: string } = {}) {
  const auth = useAuth(), session = useMemo(() => auth.userId && auth.sessionId ? { userId: auth.userId, sessionId: auth.sessionId } : null, [auth.userId, auth.sessionId]), sdk = sdkSession(), instance = typeof window === "undefined" ? null : window.Clerk ?? null, client = useQueryClient(), cache = client.getQueryCache();
  const [origin, setOrigin] = useState<RetestReviewedOrigin | null>(null), [original, setOriginal] = useState<Readonly<{ projectId: string; sourceRunId: string; testCaseId: string; clerkActorId: string; organizationId?: string }> | null>(null), [intent, setIntent] = useState<Intent | null>(null), [seen, setSeen] = useState<string | null>(null), [blocked, setBlocked] = useState<string | null>(null), [sdkEpoch, setSdkEpoch] = useState(0), sdkEpochRef = useRef(0), [sdkProof, setSdkProof] = useState<SDKProof | null>(null), sdkRef = useRef<SDKProof | null>(null), [cacheProof, setCacheProof] = useState<CacheProof | null>(null), cacheRef = useRef<CacheProof | null>(null), cleanupRef = useRef(false), [installation, setInstallation] = useState(0), lastSDK = useRef<typeof instance>(null), [guard] = useState(() => new RetestReadRenderGuard());
  const [cacheEpoch, setCacheEpoch] = useState(0), cacheEpochRef = useRef(0), admittedEver = useRef(false);
  const [parent, setParent] = useState(() => ({ required: parentRunScope !== undefined, pin: parentMatches(parentRunScope, projectId, sourceRunId) ? copyParent(parentRunScope!) : null })), [presentationRequired, setPresentationRequired] = useState(presentation !== undefined);
  if (!presentationRequired && presentation !== undefined) setPresentationRequired(true);
  if (!parent.required && parentRunScope !== undefined) setParent({ required: true, pin: parentMatches(parentRunScope, projectId, sourceRunId) ? copyParent(parentRunScope!) : null });
  else if (parent.required && !parent.pin && parentMatches(parentRunScope, projectId, sourceRunId)) setParent({ required: true, pin: copyParent(parentRunScope!) });
  const pinReady = parent.required ? !!parent.pin && parentMatches(parentRunScope, projectId, sourceRunId) && sameParent(parent.pin, parentRunScope!) && parent.pin.clerkActorId === session?.userId && (organizationId === undefined || organizationId === parent.pin.organizationId) : parentRunScope === undefined;
  const parentPresented = parentCurrent(presentation) && (!presentationRequired || typeof presentation === "function" && retestIdentity(parentActivation));
  const expectedOrg = intent?.origin?.organizationId ?? parent.pin?.organizationId ?? organizationId;
  const binding = JSON.stringify([projectId, sourceRunId, testCaseId, organizationId ?? null, active, parent.required, parent.pin, pinReady, parentPresented, parentActivation ?? null, auth.isLoaded, auth.isSignedIn, session, sdk]), [context, setContext] = useState({ binding, epoch: 0 });
  if (binding !== context.binding) setContext({ binding, epoch: context.epoch + 1 });
  const baseEligible = active && context.binding === binding && pinReady && parentPresented && auth.isLoaded && !!auth.isSignedIn && !!session && sameAuthScope(session, sdk) && [projectId, sourceRunId, testCaseId, session.userId].every(retestIdentity) && organizationId !== null && (organizationId === undefined || retestIdentity(organizationId)) && (!parent.pin || !origin || parent.pin.nativeActorId === origin.nativeActorId && parent.pin.organizationId === origin.organizationId) && (!origin || origin.projectId === projectId && origin.sourceRunId === sourceRunId && origin.testCaseId === testCaseId && origin.clerkActorId === session.userId && (organizationId === undefined || organizationId === origin.organizationId)) && (!original || original.projectId === projectId && original.sourceRunId === sourceRunId && original.testCaseId === testCaseId && original.clerkActorId === session.userId && (original.organizationId === undefined || original.organizationId === expectedOrg));
  if (!original && baseEligible) setOriginal(Object.freeze({ projectId, sourceRunId, testCaseId, clerkActorId: session!.userId, ...(typeof expectedOrg !== "string" ? {} : { organizationId: expectedOrg }) }));
  const eligible = baseEligible && !!sdkProof && sdkProof.resource === instance && !!cacheProof && cacheProof.client === client && cacheProof.cache === cache;
  if (!intent && !origin && eligible) setIntent(Object.freeze({ requestId: crypto.randomUUID(), projection: "ACCESS", session: session!, sdkEpoch, cacheEpoch, contextEpoch: context.epoch, origin: null }));
  const enabled = eligible && !!intent && !guard.isBlocked(intent.requestId) && blocked !== intent.requestId && intent.sdkEpoch === sdkEpoch && intent.cacheEpoch === cacheEpoch && intent.contextEpoch === context.epoch && sameAuthScope(intent.session, session);
  const input: RetestReviewedInput = useMemo(() => ({ request: { projectId, sourceRunId, testCaseId, ...(expectedOrg === undefined ? {} : { expectedScope: { projectId, organizationId: expectedOrg || "unavailable", clerkActorId: intent?.session.userId ?? "unavailable" } }), ...(intent?.projection === "LINKS" && intent.before !== undefined ? { before: intent.before } : {}) }, readRequestId: intent?.requestId ?? "00000000-0000-4000-8000-000000000000", ...(intent?.origin || parent.pin ? { expectedNativeActorId: intent?.origin?.nativeActorId ?? parent.pin!.nativeActorId } : {}) }), [projectId, sourceRunId, testCaseId, expectedOrg, intent, parent.pin]);
  const projection = intent?.projection ?? "ACCESS", privateReady = enabled && !!origin;
  const options = { retry: false, staleTime: 0, refetchOnWindowFocus: false };
  const accessQuery = trpcReact.manualRetest.accessReviewed.useQuery(input, { ...options, enabled: enabled && projection === "ACCESS" });
  const previewQuery = trpcReact.manualRetest.previewReviewed.useQuery(input as RouterInputs["manualRetest"]["previewReviewed"], { ...options, enabled: privateReady && projection === "PREVIEW" });
  const linksQuery = trpcReact.manualRetest.linksReviewed.useQuery(input as RouterInputs["manualRetest"]["linksReviewed"], { ...options, enabled: privateReady && projection === "LINKS" });
  const query = projection === "ACCESS" ? accessQuery : projection === "PREVIEW" ? previewQuery : linksQuery;
  const admitted = useMemo(() => enabled && (projection === "ACCESS" || privateReady) && query.isFetchedAfterMount && !query.error && !query.isFetching && !query.isPaused ? admitRetestRead(query.data, input, projection, intent!.session.userId, origin) : null, [enabled, privateReady, projection, query.isFetchedAfterMount, query.error, query.isFetching, query.isPaused, query.data, input, intent, origin]);
  if (!origin && admitted) setOrigin(admitted.origin);
  const refused = enabled && !!intent && (!!query.error || query.isPaused || seen === intent.requestId && !admitted || query.isFetchedAfterMount && !query.isFetching && query.data !== undefined && !admitted);
  if (refused && intent && blocked !== intent.requestId) setBlocked(intent.requestId);
  const received = useMemo(() => ({ admitted, revision: query.dataUpdatedAt, at: new Date().toISOString() }), [admitted, query.dataUpdatedAt]);
  const snapshot = useMemo<RetestReviewedSnapshot | null>(() => !refused && admitted && origin && intent && sameRetestOrigin(origin, admitted.origin) ? Object.freeze({ origin, observedSessionId: intent.session.sessionId, projection, epoch: context.epoch + sdkEpoch, revision: query.dataUpdatedAt, receivedAt: received.at, data: admitted.data }) : null, [refused, admitted, origin, intent, projection, context.epoch, sdkEpoch, query.dataUpdatedAt, received.at]);
  const key = useMemo(() => projection === "ACCESS" ? getQueryKey(trpcReact.manualRetest.accessReviewed, input, "query") : projection === "PREVIEW" ? getQueryKey(trpcReact.manualRetest.previewReviewed, input, "query") : getQueryKey(trpcReact.manualRetest.linksReviewed, input, "query"), [projection, input]);
  const frame: Frame = useMemo(() => ({ active, baseEligible, parentPresented, parentCurrent: presentation, eligible, origin, session, sdkEpoch, cacheEpoch, contextEpoch: context.epoch, activation: intent?.requestId ?? null, sdkProof, cacheProof, key, raw: query.data, revision: query.dataUpdatedAt, projection }), [active, baseEligible, parentPresented, presentation, eligible, origin, session, sdkEpoch, cacheEpoch, context.epoch, intent?.requestId, sdkProof, cacheProof, key, query.data, query.dataUpdatedAt, projection]);
  const stamp = guard.observe(frame, snapshot), viewRef = useRef<RetestReviewedSnapshot | null>(null), frameRef = useRef<(Frame & { stamp: typeof stamp }) | null>(null);
  useLayoutEffect(() => {
    if (!guard.matchesRender(stamp)) return;
    frameRef.current = { ...frame, stamp };
    viewRef.current = guard.matchesRead(stamp, frame.activation) && parentCurrent(frame.parentCurrent) && sdkEpochRef.current === frame.sdkEpoch && cacheEpochRef.current === frame.cacheEpoch && sdkRef.current === frame.sdkProof && cacheRef.current === frame.cacheProof && frame.sdkProof?.resource === window.Clerk && frame.cacheProof?.cache === client.getQueryCache() ? snapshot : null;
    if (viewRef.current) { admittedEver.current = true; setSeen(previous => previous === frame.activation ? previous : frame.activation); }
    return () => { frameRef.current = null; viewRef.current = null; };
  }, [guard, stamp, frame, snapshot, client]);
  useLayoutEffect(() => {
    let live = true;
    const epoch = cacheEpochRef;
    setCacheEpoch(epoch.current);
    const proof: CacheProof = Object.freeze({ client, cache });
    const changed = () => { const captured = (guard.candidateFrame() as Frame | null) ?? (viewRef.current ? frameRef.current : null); if (!live || !captured) return; const state = client.getQueryState(captured.key); if (client.getQueryCache() !== cache || state?.status !== "success" || state.fetchStatus !== "idle" || state.data !== captured.raw || state.dataUpdatedAt !== captured.revision) { guard.revokeCache(captured.activation); viewRef.current = null; setBlocked(captured.activation); } };
    let unsubscribe: (() => void) | undefined;
    try { const installed = cache.subscribe(changed); if (typeof installed !== "function") throw Error("Cache listener unavailable"); unsubscribe = installed; cacheRef.current = proof; setCacheProof(proof); changed(); }
    catch { live = false; cacheRef.current = null; viewRef.current = null; guard.revokeActions(); setCacheProof(null); try { unsubscribe?.(); } catch { /* Already revoked. */ } return; }
    return () => { live = false; cacheRef.current = null; viewRef.current = null; guard.revokeActions(); if (admittedEver.current) epoch.current++; try { unsubscribe?.(); } catch { /* Detached before cleanup. */ } };
  }, [client, cache, guard, installation]);
  useLayoutEffect(() => {
    cleanupRef.current = false; let live = true, observed = sdkSession();
    const epoch = sdkEpochRef;
    if (lastSDK.current && lastSDK.current !== instance) { epoch.current++; setSdkEpoch(epoch.current); }
    setSdkEpoch(epoch.current);
    lastSDK.current = instance;
    const addListener = instance ? Reflect.get(instance, "addListener") : undefined;
    if (typeof addListener !== "function") { sdkRef.current = null; viewRef.current = null; setSdkProof(null); return; }
    const proof: SDKProof = Object.freeze({ resource: instance! });
    const revoke = () => { viewRef.current = null; const captured = (guard.candidateFrame() as Frame | null) ?? frameRef.current; if (captured?.activation) { guard.revokeCache(captured.activation); setBlocked(captured.activation); } epoch.current++; setSdkEpoch(epoch.current); };
    const changed = () => { if (!live) return; if (window.Clerk !== instance) { live = false; sdkRef.current = null; setSdkProof(null); revoke(); setInstallation(v => v + 1); return; } const next = sdkSession(); if (!(observed === null && next === null) && !sameAuthScope(observed, next)) { observed = next; revoke(); } };
    let unsubscribe: (() => void) | undefined;
    try { const installed = addListener.call(instance, changed); if (typeof installed === "function") unsubscribe = installed; if (!unsubscribe || !live || window.Clerk !== instance) throw Error("SDK listener unavailable"); sdkRef.current = proof; setSdkProof(proof); changed(); }
    catch { live = false; cleanupRef.current = true; sdkRef.current = null; viewRef.current = null; guard.revokeActions(); setSdkProof(null); try { unsubscribe?.(); } catch { /* Already revoked. */ } cleanupRef.current = false; return; }
    return () => { live = false; cleanupRef.current = true; sdkRef.current = null; viewRef.current = null; guard.revokeActions(); if (admittedEver.current) epoch.current++; try { unsubscribe?.(); } catch { /* Revocation precedes cleanup. */ } };
  }, [instance, installation, guard]);
  function monitored(f: Frame) {
    if (cleanupRef.current || !f.sdkProof || sdkRef.current !== f.sdkProof || !f.cacheProof || cacheRef.current !== f.cacheProof) return false;
    if (typeof window === "undefined" || window.Clerk !== f.sdkProof.resource || client.getQueryCache() !== f.cacheProof.cache || !sameAuthScope(f.session, sdkSession())) { viewRef.current = null; guard.revokeCache(f.activation); setBlocked(f.activation); sdkEpochRef.current++; setSdkEpoch(sdkEpochRef.current); if (typeof window === "undefined" || window.Clerk !== f.sdkProof.resource) { sdkRef.current = null; setSdkProof(null); setInstallation(v => v + 1); } return false; }
    return true;
  }
  function current() {
    const f = frameRef.current, v = viewRef.current;
    if (f && !parentCurrent(f.parentCurrent)) { guard.revokeCache(f.activation); viewRef.current = null; setBlocked(f.activation); return null; }
    if (!f || !guard.matchesRender(stamp) || !monitored(f) || !v || !guard.matchesRead(f.stamp, f.activation) || !f.active || !f.eligible || !parentCurrent(f.parentCurrent) || sdkEpochRef.current !== f.sdkEpoch || cacheEpochRef.current !== f.cacheEpoch || !sameAuthScope(f.session, sdkSession()) || f.session?.sessionId !== v.observedSessionId || !sameRetestOrigin(f.origin, v.origin)) return null;
    const state = client.getQueryState(f.key);
    if (state?.status !== "success" || state.fetchStatus !== "idle" || state.data !== f.raw || state.dataUpdatedAt !== f.revision) { guard.revokeCache(f.activation); viewRef.current = null; setBlocked(f.activation); return null; }
    return v;
  }
  function begin(projection: RetestProjection, before?: string) {
    const f = frameRef.current, now = sdkSession();
    if (typeof projection !== "string" || !["ACCESS", "PREVIEW", "LINKS"].includes(projection)) return false;
    if (f && !parentCurrent(f.parentCurrent)) { guard.revokeCache(f.activation); viewRef.current = null; setBlocked(f.activation); return false; }
    if (!f || !guard.matchesRender(stamp) || !guard.matchesRender(f.stamp) || cleanupRef.current || !f.baseEligible || !f.active || !f.parentPresented || !parentCurrent(f.parentCurrent) || !f.session || !sameAuthScope(f.session, now) || before !== undefined && (projection !== "LINKS" || !retestIdentity(before))) return false;
    if (!monitored(f)) { if (!cleanupRef.current) setInstallation(v => v + 1); return false; }
    if (projection !== "ACCESS" && (!current() || !f.origin)) return false;
    viewRef.current = null; guard.revokeActions(); setIntent(Object.freeze({ requestId: crypto.randomUUID(), projection, ...(before === undefined ? {} : { before }), session: f.session, sdkEpoch: sdkEpochRef.current, cacheEpoch: cacheEpochRef.current, contextEpoch: f.contextEpoch, origin: f.origin })); return true;
  }
  return { origin, snapshot, fresh: snapshot?.data ?? null, projection, observedSessionId: snapshot?.observedSessionId ?? null, readable: !!snapshot, canCreate: false as const, current, refresh: () => begin("ACCESS"), read: (projection: "PREVIEW" | "LINKS", before?: string) => begin(projection, before), loading: enabled && query.isFetching, error: baseEligible && (!sdkProof || !cacheProof) ? "Independent session/cache monitoring is unavailable. Retest views stay withheld; explicitly refresh to retry installation." : refused || query.error ? "The exact current retest projection could not be admitted; retained private views are withheld. Explicitly refresh original access." : intent && !enabled ? "Original reader/session or monitoring changed. Explicit native refresh is required; cached retest evidence is withheld." : null };
}
