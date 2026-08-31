"use client";

import { useEffect, useState } from "react";
import { trpc, type RouterOutputs } from "./trpc";
import { canEditProject, canSignOffCompliance, canAdministerOrganization } from "./membership";

export function useProjectPermissions(projectId: string) {
  const [state, setState] = useState<{ projectId: string; member: RouterOutputs["organization"]["mine"][number] | undefined }>();
  useEffect(() => {
    let active = true;
    Promise.all([trpc.project.byId.query({ id: projectId }), trpc.organization.mine.query()])
      .then(([project, orgs]) => {
        if (active) setState({ projectId, member: orgs.find((org) => org.id === project.organizationId) });
      })
      .catch(() => { if (active) setState({ projectId, member: undefined }); });
    return () => { active = false; };
  }, [projectId]);
  const member = state?.projectId === projectId ? state.member : undefined;
  return { canEdit: canEditProject(member), canSignOff: canSignOffCompliance(member), canAdmin: canAdministerOrganization(member), loaded: state?.projectId === projectId };
}
