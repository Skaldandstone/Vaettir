"use client";

import { ActionHelp } from "@/components/ui/ActionHelp";
import { ActionButton } from "@/components/ui/ActionButton";
import { trpcReact } from "@/lib/trpcReact";
import { useCaseFieldAccess } from "@/lib/use-case-field-access";

/** Same saved project membership as the connected workflows; counts are
 * registered references, never verified credentials or deployments. */
export function ProjectRepositorySummary({ projectId }: { projectId: string }) {
  const access = useCaseFieldAccess(projectId);
  const query = trpcReact.project.repositories.useQuery({ projectId }, { enabled: access.readable, staleTime: 0, retry: false });
  const ready = access.readable && query.isSuccess && !query.error && !query.isFetching && !query.isPaused;
  return <section id="project-repositories" aria-label="Project repository summary" style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBlock: 16 }}>
    <strong>{ready ? query.data.length + " registered repositories" : "Repository count unavailable"}</strong>
    <ActionHelp tooltip={<>Manage project integrations</>}><a className="btn-secondary" href={"/projects/" + encodeURIComponent(projectId) + "/settings/integrations"}>Integrations</a></ActionHelp>
    {query.error ? <><span role="alert">Project repositories could not be refreshed; no empty count is inferred.</span><ActionButton type="button" disabled={!access.readable || query.isFetching} onClick={() => { if (access.origin && access.owns(access.origin)) void query.refetch(); }} tooltip={<> Retry repository count </>}> Retry </ActionButton></>
      : !ready ? <span role="status">Checking saved project repositories…</span> : null}
  </section>;
}
