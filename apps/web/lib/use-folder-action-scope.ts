"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { trpcReact } from "@/lib/trpcReact";

export type FolderActionScope = {
  projectId: string;
  organizationId: string;
  clerkActorId: string;
};

// Copy/recovery retain mounted drafts and exact requests. Scope changes hide
// them, not rebind them; generation also blocks cached data on identity return.
export function useFolderActionScope(projectId: string, enabled: boolean) {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const actorReady = isLoaded && isSignedIn && !!userId;
  const project = trpcReact.project.byId.useQuery(
    { id: projectId },
    {
      enabled: enabled && actorReady,
      staleTime: 0,
      retry: false,
    },
  );
  const organizations = trpcReact.organization.mine.useQuery(undefined, {
    enabled: enabled && actorReady,
    staleTime: 0,
    retry: false,
  });
  const organizationId =
    project.data?.id === projectId ? project.data.organizationId : undefined;
  const accessReady =
    enabled &&
    actorReady &&
    !project.error &&
    !project.isFetching &&
    !project.isPaused &&
    project.data?.id === projectId &&
    !organizations.error &&
    !organizations.isFetching &&
    !organizations.isPaused &&
    !!organizations.data?.some((org) => org.id === organizationId);
  const [origin, setOrigin] = useState<FolderActionScope | null>(null);
  useEffect(() => {
    if (!origin && accessReady && organizationId)
      setOrigin({ projectId, organizationId, clerkActorId: userId! });
  }, [origin, accessReady, organizationId, projectId, userId]);
  const key = JSON.stringify([
    projectId,
    organizationId,
    userId,
    isLoaded,
    isSignedIn,
    enabled,
    !!project.error,
    project.isFetching,
    project.isPaused,
    !!organizations.error,
    organizations.isFetching,
    organizations.isPaused,
    accessReady,
  ]);
  // Conditional tracked state, not a ref mutation during speculative render.
  // Each committed availability/identity transition invalidates old approvals,
  // including A -> B -> A, denial -> recovery and close -> reopen.
  const [epoch, setEpoch] = useState({ key, generation: 0 });
  const generation =
    epoch.key === key ? epoch.generation : epoch.generation + 1;
  if (epoch.key !== key) setEpoch({ key, generation });
  const ready =
    accessReady &&
    !!origin &&
    origin.projectId === projectId &&
    origin.organizationId === organizationId &&
    origin.clerkActorId === userId;
  const changed =
    !!origin &&
    (origin.projectId !== projectId ||
      (!!organizationId && origin.organizationId !== organizationId) ||
      (actorReady && origin.clerkActorId !== userId));
  // Consumers read this only from events/asynchronous callbacks. Publish only
  // committed state before paint; abandoned renders cannot authorize an action.
  const live = useRef<{
    ready: boolean;
    origin: FolderActionScope | null;
    generation: number;
  }>({ ready: false, origin: null, generation: -1 });
  useLayoutEffect(() => {
    live.current = { ready, origin, generation };
    return () => {
      live.current = { ready: false, origin, generation: -1 };
    };
  }, [ready, origin, generation]);
  const matches = (value: FolderActionScope | undefined | null) =>
    ready &&
    !!value &&
    value.projectId === projectId &&
    value.organizationId === origin?.organizationId &&
    value.clerkActorId === userId;
  async function refresh() {
    if (!actorReady || changed) return;
    await Promise.all([project.refetch(), organizations.refetch()]);
  }
  return {
    ready,
    changed,
    origin,
    generation,
    live,
    matches,
    actorReady,
    signedOut: isLoaded && !actorReady,
    refresh,
  };
}
