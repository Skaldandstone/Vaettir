"use client";
import { trpcReact, type RouterOutputs } from "./trpcReact";
import type { UseQueryResult } from "@tanstack/react-query";
import { useCaseFieldAccess } from "./use-case-field-access";
import { sameGovernanceReader } from "./plan-governance-receipt";
type PlanGovernanceAccess = {
  access: ReturnType<typeof useCaseFieldAccess>;
  query: UseQueryResult<
    RouterOutputs["testPlanGovernance"]["preview"],
    NonNullable<
      ReturnType<typeof trpcReact.testPlanGovernance.preview.useQuery>["error"]
    >
  >;
  fresh: RouterOutputs["testPlanGovernance"]["preview"] | null;
};
export function usePlanGovernance(
  projectId: string,
  testPlanId: string,
  active = true,
): PlanGovernanceAccess {
  const access = useCaseFieldAccess(projectId, undefined, active);
  const origin = access.origin;
  const query = trpcReact.testPlanGovernance.preview.useQuery(
    {
      projectId,
      testPlanId,
      originalOrganizationId: origin?.organizationId ?? "",
      expectedClerkActorId: origin?.clerkActorId ?? "",
    },
    {
      enabled: active && access.readable && !!testPlanId,
      retry: false,
      staleTime: 0,
      refetchOnWindowFocus: false,
    },
  );
  const fresh =
    active &&
    access.readable &&
    !query.isFetching &&
    !query.isPaused &&
    !query.error &&
    sameGovernanceReader(query.data?.scope, origin) &&
    query.data?.snapshot.id === testPlanId &&
    query.data.snapshot.projectId === projectId
      ? query.data
      : null;
  return { access, query, fresh };
}
