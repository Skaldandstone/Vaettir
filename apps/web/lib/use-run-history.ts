"use client";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { trpcReact } from "./trpcReact";
import { currentSessionScope, sameAuthScope } from "./auth-query-cache";
import {
  admitRunHistoryAccess,
  admitRunHistoryPage,
  sameRunHistoryOrigin,
  freezeRunHistory,
  RunHistoryRenderGuard,
  type RunHistoryOrigin,
  type RunHistoryPage,
  type RunHistoryReadSnapshot,
} from "./run-history-reader";
type Session = NonNullable<ReturnType<typeof currentSessionScope>>;
type Intent = {
  requestId: string;
  session: Session;
  sdkEpoch: number;
  contextEpoch: number;
  origin: RunHistoryOrigin | null;
};
type Cursor = NonNullable<RunHistoryPage["before"]>;
type Page = {
  activation: string;
  requestId: string;
  asOf: string;
  cursors: Array<Cursor | undefined>;
  index: number;
};
type Frame = {
  projectId: string;
  organizationId: string;
  active: boolean;
  limit: number;
  origin: RunHistoryOrigin | null;
  session: Session | null;
  contextEpoch: number;
  sdkEpoch: number;
  activation: string | null;
  accessKey: QueryKey;
  pageKey: QueryKey;
  accessData: unknown;
  pageData: unknown;
  accessRevision: number;
  pageRevision: number;
};
function sdkSession() {
  return typeof window === "undefined"
    ? null
    : currentSessionScope(window.Clerk?.loaded ? window.Clerk.session : null);
}
/** Fresh native activation is separate from hook auth and SDK session. Caller
 * props discover scope; none can replace the first completed native origin. */
export function useRunHistory(
  projectId: string,
  organizationIdDiscovery: string | null | undefined,
  { active = true, limit = 20 }: { active?: boolean; limit?: number } = {},
) {
  const auth = useAuth(),
    hookSession = useMemo(
      () =>
        auth.userId && auth.sessionId
          ? { userId: auth.userId, sessionId: auth.sessionId }
          : null,
      [auth.userId, auth.sessionId],
    ),
    sdk = sdkSession();
  const [origin, setOrigin] = useState<RunHistoryOrigin | null>(null),
    [sdkEpoch, setSdkEpoch] = useState(0),
    sdkEpochRef = useRef(0);
  const [intent, setIntent] = useState<Intent | null>(null),
    [page, setPage] = useState<Page | null>(null),
    [blockedIntent, setBlockedIntent] = useState<string | null>(null),
    [seen, setSeen] = useState<{ access: string | null; page: string | null }>({
      access: null,
      page: null,
    }),
    client = useQueryClient();
  const viewRef = useRef<RunHistoryReadSnapshot | null>(null),
    frameRef = useRef<
      | (Frame & {
          stamp: { renderGeneration: number; cacheGeneration: number };
        })
      | null
    >(null);
  const [renderGuard] = useState(() => new RunHistoryRenderGuard());
  const organizationId = organizationIdDiscovery ?? "",
    binding = JSON.stringify([
      projectId,
      organizationId,
      active,
      limit,
      auth.isLoaded,
      auth.isSignedIn,
      hookSession,
      sdk,
    ]),
    [context, setContext] = useState({ binding, epoch: 0 });
  if (context.binding !== binding)
    setContext({ binding, epoch: context.epoch + 1 });
  const contextCurrent = context.binding === binding;
  const eligible =
    active &&
    contextCurrent &&
    auth.isLoaded &&
    !!auth.isSignedIn &&
    !!projectId &&
    !!organizationId &&
    Number.isInteger(limit) &&
    limit >= 1 &&
    limit <= 21 &&
    !!hookSession &&
    sameAuthScope(hookSession, sdk) &&
    (!origin ||
      (origin.projectId === projectId &&
        origin.organizationId === organizationId &&
        origin.clerkActorId === hookSession.userId));
  if (!intent && !origin && eligible)
    setIntent({
      requestId: crypto.randomUUID(),
      session: hookSession!,
      sdkEpoch,
      contextEpoch: context.epoch,
      origin: null,
    });
  const accessEnabled =
    !!eligible &&
    !!intent &&
    !renderGuard.isBlocked(intent.requestId) &&
    blockedIntent !== intent.requestId &&
    intent.sdkEpoch === sdkEpoch &&
    intent.contextEpoch === context.epoch &&
    sameAuthScope(intent.session, hookSession);
  const accessInput = useMemo(
    () => ({
      projectId,
      originalOrganizationId: organizationId || "unavailable",
      expectedClerkActorId: intent?.session.userId ?? "unavailable",
      ...(intent?.origin
        ? { expectedNativeActorId: intent.origin.nativeActorId }
        : {}),
      requestId: intent?.requestId ?? "00000000-0000-4000-8000-000000000000",
    }),
    [projectId, organizationId, intent],
  );
  const accessQuery = trpcReact.runHistory.access.useQuery(accessInput, {
    enabled: accessEnabled,
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
  const access = useMemo(
    () =>
      accessEnabled &&
      accessQuery.isFetchedAfterMount &&
      !accessQuery.error &&
      !accessQuery.isFetching &&
      !accessQuery.isPaused
        ? admitRunHistoryAccess(accessQuery.data, accessInput, origin)
        : null,
    [
      accessEnabled,
      accessQuery.isFetchedAfterMount,
      accessQuery.error,
      accessQuery.isFetching,
      accessQuery.isPaused,
      accessQuery.data,
      origin,
      accessInput,
    ],
  );
  if (!origin && access) setOrigin(access.origin);
  const nativeAccess =
    origin && access && sameRunHistoryOrigin(access.origin, origin)
      ? access
      : null;
  if (nativeAccess && intent && page?.activation !== intent.requestId)
    setPage({
      activation: intent.requestId,
      requestId: crypto.randomUUID(),
      asOf: nativeAccess.data.readContext.asOf,
      cursors: [undefined],
      index: 0,
    });
  const pageEnabled =
    !!nativeAccess &&
    !!origin &&
    !!page &&
    page.activation === intent?.requestId;
  const input: RunHistoryPage = useMemo(
    () => ({
      projectId,
      originalOrganizationId: origin?.organizationId ?? "unavailable",
      expectedClerkActorId: origin?.clerkActorId ?? "unavailable",
      expectedNativeActorId: origin?.nativeActorId ?? "unavailable",
      requestId: page?.requestId ?? "00000000-0000-4000-8000-000000000000",
      limit,
      asOf: page?.asOf ?? "2000-01-01T00:00:00.000Z",
      ...(page?.cursors[page.index]
        ? { before: page.cursors[page.index] }
        : {}),
    }),
    [projectId, origin, page, limit],
  );
  const query = trpcReact.runHistory.page.useQuery(input, {
    enabled: pageEnabled,
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
  const fresh = useMemo(
    () =>
      pageEnabled &&
      origin &&
      query.isFetchedAfterMount &&
      !query.error &&
      !query.isFetching &&
      !query.isPaused
        ? admitRunHistoryPage(query.data, input, origin)
        : null,
    [
      pageEnabled,
      origin,
      query.isFetchedAfterMount,
      query.error,
      query.isFetching,
      query.isPaused,
      query.data,
      input,
    ],
  );
  const refused =
    accessEnabled &&
    !!intent &&
    (!!accessQuery.error ||
      accessQuery.isPaused ||
      (seen.access === intent.requestId && accessQuery.isFetching) ||
      (accessQuery.isFetchedAfterMount &&
        !accessQuery.isFetching &&
        !accessQuery.isPaused &&
        accessQuery.data !== undefined &&
        !access) ||
      (pageEnabled &&
        (!!query.error ||
          query.isPaused ||
          (seen.page === input.requestId && query.isFetching) ||
          (query.isFetchedAfterMount &&
            !query.isFetching &&
            !query.isPaused &&
            query.data !== undefined &&
            !fresh))));
  if (refused && intent && blockedIntent !== intent.requestId)
    setBlockedIntent(intent.requestId);
  if (access && seen.access !== intent?.requestId)
    setSeen((previous) => ({ ...previous, access: intent?.requestId ?? null }));
  if (fresh && seen.page !== input.requestId)
    setSeen((previous) => ({ ...previous, page: input.requestId }));
  const received = useMemo(
    () => ({
      at: new Date().toISOString(),
      data: fresh,
      revision: query.dataUpdatedAt,
    }),
    [fresh, query.dataUpdatedAt],
  );
  const frame: Frame = useMemo(
    () => ({
      projectId,
      organizationId,
      active,
      limit,
      origin,
      session: hookSession,
      contextEpoch: context.epoch,
      sdkEpoch,
      activation: intent?.requestId ?? null,
      accessKey: getQueryKey(trpcReact.runHistory.access, accessInput, "query"),
      pageKey: getQueryKey(trpcReact.runHistory.page, input, "query"),
      accessData: accessQuery.data,
      pageData: query.data,
      accessRevision: accessQuery.dataUpdatedAt,
      pageRevision: query.dataUpdatedAt,
    }),
    [
      projectId,
      organizationId,
      active,
      limit,
      origin,
      hookSession,
      context.epoch,
      sdkEpoch,
      intent?.requestId,
      accessInput,
      input,
      accessQuery.data,
      query.data,
      accessQuery.dataUpdatedAt,
      query.dataUpdatedAt,
    ],
  );
  const snapshot = useMemo(
    () =>
      !refused && fresh && origin && intent
        ? freezeRunHistory({
            origin,
            observedSessionId: intent.session.sessionId,
            epoch: context.epoch + sdkEpoch,
            revision: query.dataUpdatedAt,
            receivedAt: received.at,
            page: fresh,
          })
        : null,
    [
      refused,
      fresh,
      origin,
      intent,
      context.epoch,
      sdkEpoch,
      received.at,
      query.dataUpdatedAt,
    ],
  );
  const renderStamp = renderGuard.observe(frame, snapshot);
  useLayoutEffect(() => {
    if (!renderGuard.matchesRender(renderStamp)) return;
    frameRef.current = { ...frame, stamp: renderStamp };
    viewRef.current =
      renderGuard.matchesRead(renderStamp, frame.activation) &&
      sdkEpochRef.current === frame.sdkEpoch
        ? snapshot
        : null;
    return () => {
      frameRef.current = null;
      viewRef.current = null;
    };
  }, [frame, snapshot, renderGuard, renderStamp]);
  useLayoutEffect(() => {
    let live = true;
    const changed = () => {
      const captured =
        (renderGuard.candidateFrame() as Frame | null) ??
        (viewRef.current ? frameRef.current : null);
      if (!live || !captured) return;
      const accessState = client.getQueryState(captured.accessKey),
        pageState = client.getQueryState(captured.pageKey);
      if (
        accessState?.status !== "success" ||
        pageState?.status !== "success" ||
        accessState.fetchStatus !== "idle" ||
        pageState.fetchStatus !== "idle" ||
        accessState.data !== captured.accessData ||
        pageState.data !== captured.pageData ||
        accessState.dataUpdatedAt !== captured.accessRevision ||
        pageState.dataUpdatedAt !== captured.pageRevision
      ) {
        renderGuard.revokeCache(captured.activation);
        viewRef.current = null;
        setBlockedIntent(captured.activation);
      }
    };
    const unsubscribe = client.getQueryCache().subscribe(changed);
    changed();
    return () => {
      live = false;
      unsubscribe();
    };
  }, [client, renderGuard]);
  useLayoutEffect(() => {
    type SDK = NonNullable<typeof window.Clerk> & {
      addListener?: (listener: () => void) => () => void;
    };
    const clerk =
      typeof window === "undefined" ? null : (window.Clerk as SDK | null);
    let observed = hookSession,
      live = true;
    const changed = () => {
      if (!live) return;
      const next = sdkSession();
      if (
        !(observed === null && next === null) &&
        !sameAuthScope(observed, next)
      ) {
        observed = next;
        viewRef.current = null;
        sdkEpochRef.current++;
        setSdkEpoch((value) => value + 1);
      }
    };
    const unsubscribe = clerk?.addListener?.(changed);
    changed();
    return () => {
      live = false;
      unsubscribe?.();
      viewRef.current = null;
    };
  }, [hookSession, projectId, organizationId]);
  function current() {
    const value = viewRef.current,
      frame = frameRef.current;
    if (
      !value ||
      !frame ||
      !renderGuard.matchesRead(frame.stamp, frame.activation) ||
      !frame.active ||
      sdkEpochRef.current !== frame.sdkEpoch ||
      !sameAuthScope(frame.session, sdkSession()) ||
      frame.session?.sessionId !== value.observedSessionId ||
      !sameRunHistoryOrigin(value.origin, frame.origin) ||
      value.origin.projectId !== frame.projectId ||
      value.origin.organizationId !== frame.organizationId
    )
      return null;
    const accessState = client.getQueryState(frame.accessKey),
      pageState = client.getQueryState(frame.pageKey);
    if (
      accessState?.status !== "success" ||
      pageState?.status !== "success" ||
      accessState.fetchStatus !== "idle" ||
      pageState.fetchStatus !== "idle" ||
      accessState.data !== frame.accessData ||
      pageState.data !== frame.pageData ||
      accessState.dataUpdatedAt !== frame.accessRevision ||
      pageState.dataUpdatedAt !== frame.pageRevision
    ) {
      renderGuard.revokeCache(frame.activation);
      viewRef.current = null;
      setBlockedIntent(frame.activation);
      return null;
    }
    return value;
  }
  function refresh() {
    const frame = frameRef.current,
      now = sdkSession();
    if (
      !frame ||
      !renderGuard.matchesRender(frame.stamp) ||
      !frame.active ||
      !frame.session ||
      !sameAuthScope(frame.session, now) ||
      !frame.projectId ||
      !frame.organizationId ||
      (frame.origin &&
        (frame.origin.projectId !== frame.projectId ||
          frame.origin.organizationId !== frame.organizationId ||
          frame.origin.clerkActorId !== now?.userId))
    )
      return false;
    viewRef.current = null;
    renderGuard.revokeActions();
    setIntent({
      requestId: crypto.randomUUID(),
      session: frame.session,
      sdkEpoch: sdkEpochRef.current,
      contextEpoch: frame.contextEpoch,
      origin: frame.origin,
    });
    return true;
  }
  function move(direction: "FIRST" | "OLDER" | "NEWER") {
    const currentView = current();
    if (
      !currentView ||
      !page ||
      currentView.page.readContext.requestId !== page.requestId ||
      page.activation !== intent?.requestId
    )
      return false;
    const target =
      direction === "OLDER" ? currentView.page.nextBefore : undefined;
    if (
      (direction === "OLDER" && !target) ||
      (direction === "NEWER" && page.index === 0)
    )
      return false;
    viewRef.current = null;
    renderGuard.revokeActions();
    setPage((previous) => {
      if (
        !previous ||
        previous.activation !== page.activation ||
        previous.requestId !== page.requestId
      )
        return previous;
      return {
        ...previous,
        requestId: crypto.randomUUID(),
        index:
          direction === "FIRST"
            ? 0
            : direction === "OLDER"
              ? previous.index + 1
              : previous.index - 1,
        cursors:
          direction === "OLDER"
            ? [...previous.cursors.slice(0, previous.index + 1), target!]
            : direction === "FIRST"
              ? [undefined]
              : previous.cursors,
      };
    });
    return true;
  }
  const error =
    accessEnabled && (accessQuery.error || (pageEnabled && query.error))
      ? "The current native run-history read failed. Previous rows are withheld; explicitly refresh or retry this current intent."
      : !accessEnabled && intent
        ? "Current reader/session changed. Explicitly refresh native access under the original actor and project; cached history is withheld."
        : null;
  return {
    origin,
    observedSessionId: snapshot?.observedSessionId ?? null,
    fresh: snapshot?.page ?? null,
    snapshot,
    readable: !!snapshot,
    loading:
      accessEnabled &&
      (accessQuery.isFetching || (pageEnabled && query.isFetching)),
    error,
    canOlder: !!snapshot?.page.hasMore,
    canNewer: !!snapshot && !!page && page.index > 0,
    refresh,
    first: () => move("FIRST"),
    older: () => move("OLDER"),
    newer: () => move("NEWER"),
    current,
  };
}
