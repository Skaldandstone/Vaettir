"use client";
import { useState } from "react";
import { useAuth } from "@clerk/nextjs";
import type { UseQueryResult } from "@tanstack/react-query";
import { trpcReact, type RouterOutputs } from "./trpcReact";
import { sameVersionReader, type VersionOrigin } from "./case-version-draft";
type AccessData = RouterOutputs["caseVersionReview"]["access"];
export type VersionAccess = {
  query: UseQueryResult<
    AccessData,
    NonNullable<
      ReturnType<typeof trpcReact.caseVersionReview.access.useQuery>["error"]
    >
  >;
  origin: VersionOrigin | null;
  fresh: AccessData | null;
  readable: boolean;
  activation: string;
  refresh: () => void;
};
export function useVersionReadNonce(binding: string) {
  const [cycle, setCycle] = useState({
    binding: "",
    requestId: crypto.randomUUID(),
  });
  if (cycle.binding !== binding)
    setCycle({ binding, requestId: crypto.randomUUID() });
  return { requestId: cycle.requestId, ready: cycle.binding === binding };
}
/** Schema-independent native bootstrap. Active/session/access/page activations
 * never inherit another reader's successful cache, including A -> B -> A. */
export function useCaseVersionAccess(
  projectId: string,
  caseId: string,
  active: boolean,
): VersionAccess {
  const auth = useAuth(),
    [origin, setOrigin] = useState<VersionOrigin | null>(null),
    [refresh, setRefresh] = useState(0);
  const clerk = origin?.clerkActorId ?? auth.userId ?? "";
  const ready =
    active &&
    !!projectId &&
    !!caseId &&
    auth.isLoaded &&
    auth.isSignedIn &&
    !!auth.sessionId &&
    auth.userId === clerk &&
    (!origin || (origin.projectId === projectId && origin.caseId === caseId));
  const cycle = useVersionReadNonce(
    JSON.stringify([
      !!ready,
      active,
      projectId,
      caseId,
      origin,
      auth.sessionId,
      refresh,
    ]),
  );
  const query = trpcReact.caseVersionReview.access.useQuery(
    {
      projectId,
      testCaseId: caseId,
      readRequestId: cycle.requestId,
      ...(origin
        ? {
            originalOrganizationId: origin.organizationId,
            expectedClerkActorId: origin.clerkActorId,
          }
        : {}),
    },
    {
      enabled: !!ready && cycle.ready,
      retry: false,
      staleTime: 0,
      refetchOnWindowFocus: false,
    },
  );
  const candidate =
    ready &&
    cycle.ready &&
    query.isFetchedAfterMount &&
    !query.error &&
    !query.isFetching &&
    !query.isPaused &&
    query.data?.readRequestId === cycle.requestId &&
    query.data.caseId === caseId &&
    query.data.readScope.projectId === projectId &&
    query.data.readScope.actorClerkUserId === clerk &&
    !!query.data.readScope.actorId &&
    !!query.data.readScope.organizationId &&
    query.data.projection.kind === "ACCESS"
      ? query.data
      : null;
  if (!origin && candidate)
    setOrigin(
      Object.freeze({
        projectId,
        caseId,
        organizationId: candidate.readScope.organizationId,
        clerkActorId: candidate.readScope.actorClerkUserId,
        nativeActorId: candidate.readScope.actorId,
      }),
    );
  const fresh =
    origin && candidate && sameVersionReader(candidate.readScope, origin)
      ? candidate
      : null;
  return {
    query,
    origin,
    fresh,
    readable: !!fresh,
    activation: cycle.requestId,
    refresh: () => setRefresh((value) => value + 1),
  };
}
