"use client";
import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { trpcReact } from "./trpcReact";

/** Keeps the first freshly verified scope; a changed actor/tenant is not a rebase. */
export function useManualExecutionAccess(projectId: string) {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const [origin, setOrigin] = useState<{ organizationId: string; clerkActorId: string }>();
  const project = trpcReact.project.byId.useQuery({ id: projectId }, { staleTime: 0, retry: false });
  const organizations = trpcReact.organization.mine.useQuery(undefined, { staleTime: 0, retry: false });
  const actorReady = Boolean(isLoaded && isSignedIn && userId);
  const projectReady = !project.error && !project.isFetching && !project.isPaused && project.data?.id === projectId;
  const membershipReady = !organizations.error && !organizations.isFetching && !organizations.isPaused && Array.isArray(organizations.data);
  const member = membershipReady ? organizations.data?.find(row => row.id === project.data?.organizationId) : undefined;
  const canRead = !!member && ["OWNER", "ADMIN", "EDITOR", "VIEWER", "COMPLIANCE_AUDITOR"].includes(member.role) && ["FULL", "READ_ONLY"].includes(member.seatType);
  const changed = !!origin && ((actorReady && userId !== origin.clerkActorId) || (projectReady && project.data?.organizationId !== origin.organizationId));
  useEffect(() => {
    if (!origin && actorReady && projectReady && canRead) setOrigin({ organizationId: project.data!.organizationId, clerkActorId: userId! });
  }, [origin, actorReady, projectReady, canRead, project.data, userId]);
  const ready = actorReady && projectReady && membershipReady && canRead && !!origin && !changed &&
    project.data?.organizationId === origin.organizationId && userId === origin.clerkActorId;
  return { origin, ready,
    canWrite: ready && member?.seatType === "FULL" && ["OWNER", "ADMIN", "EDITOR"].includes(member.role),
    denied: changed || (isLoaded && !actorReady) || !!project.error || !!organizations.error || (projectReady && membershipReady && !canRead),
    paused: project.isPaused || organizations.isPaused,
    refresh: () => Promise.all([project.refetch(), organizations.refetch()]),
  };
}
