"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import type { UseQueryResult } from "@tanstack/react-query";
import { trpcReact, type RouterOutputs } from "./trpcReact";
import { sameCaseFieldOrigin, type CaseFieldOrigin } from "./case-field-origin";

// Keep private drafts and uncertain receipts mounted. Fresh authorization may
// hide them, but never transfers them to another actor or organization.
type CaseFieldAccess = {
  query: UseQueryResult<
    RouterOutputs["caseFields"]["get"],
    NonNullable<ReturnType<typeof trpcReact.caseFields.get.useQuery>["error"]>
  >;
  origin: CaseFieldOrigin | null;
  current: CaseFieldOrigin | null;
  authReady: boolean;
  owns: (
    original: CaseFieldOrigin,
    mode?: "read" | "edit" | "configure",
  ) => boolean;
  fresh: RouterOutputs["caseFields"]["get"] | null;
  readable: boolean;
  canEdit: boolean;
  canConfigure: boolean;
};
export function useCaseFieldAccess(
  projectId: string,
  caseId?: string,
  active = true,
): CaseFieldAccess {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const authReady = Boolean(isLoaded && isSignedIn && userId);
  const query = trpcReact.caseFields.get.useQuery(
    { projectId, caseId },
    {
      enabled: active && authReady,
      retry: false,
      staleTime: 0,
      refetchOnWindowFocus: false,
    },
  );
  const fresh =
    active &&
    authReady &&
    !query.error &&
    !query.isFetching &&
    !query.isPaused &&
    query.data?.projectId === projectId &&
    query.data.caseId === (caseId ?? null)
      ? query.data
      : null;
  const current = useMemo<CaseFieldOrigin | null>(
    () =>
      fresh && userId
        ? {
            projectId,
            caseId: caseId ?? null,
            organizationId: fresh.organizationId,
            clerkActorId: userId,
          }
        : null,
    [fresh, projectId, caseId, userId],
  );
  const [origin, setOrigin] = useState<CaseFieldOrigin | null>(null);
  useEffect(() => {
    if (!origin && current) setOrigin(current);
  }, [origin, current]);
  const readable = sameCaseFieldOrigin(origin, current);
  const accessNow = useRef({
    current,
    canEdit: !!fresh?.canEdit,
    canConfigure: !!fresh?.canConfigure,
  });
  useLayoutEffect(() => {
    accessNow.current = {
      current,
      canEdit: !!fresh?.canEdit,
      canConfigure: !!fresh?.canConfigure,
    };
  }, [current, fresh]);
  function owns(
    original: CaseFieldOrigin,
    mode: "read" | "edit" | "configure" = "read",
  ) {
    const latest = accessNow.current;
    return (
      sameCaseFieldOrigin(original, latest.current) &&
      (mode === "read" ||
        (mode === "edit" ? latest.canEdit : latest.canConfigure))
    );
  }
  return {
    query,
    origin,
    current,
    authReady,
    owns,
    fresh: readable ? fresh : null,
    readable,
    canEdit: readable && !!fresh?.canEdit,
    canConfigure: readable && !!fresh?.canConfigure,
  };
}
