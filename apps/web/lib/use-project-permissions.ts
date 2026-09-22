"use client";

import { canAdministerOrganization, canEditProject, canSignOffCompliance } from "./membership";
import { trpcReact } from "./trpcReact";

export function useProjectPermissions(projectId: string) {
  const projectQuery = trpcReact.project.byId.useQuery({ id: projectId });
  const orgsQuery = trpcReact.organization.mine.useQuery();
  const member = orgsQuery.data?.find((org) => org.id === projectQuery.data?.organizationId);
  const loaded = projectQuery.isSuccess && orgsQuery.isSuccess;

  return {
    canEdit: loaded && canEditProject(member),
    canSignOff: loaded && canSignOffCompliance(member),
    canAdmin: loaded && canAdministerOrganization(member),
    loaded,
  };
}
