"use client";
import { useParams } from "next/navigation";
import { trpcReact } from "@/lib/trpcReact";
import { useCaseFieldAccess } from "@/lib/use-case-field-access";
import { AtlassianQualitySettings } from "@/components/AtlassianQualitySettings";
import { ProjectRepositories } from "@/components/ProjectRepositories";
import { repositoryDisplayName } from "@/lib/repository-display";
import { AiDisclosureSettings } from "@/components/AiDisclosureSettings";

export default function ProjectIntegrationsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const query = trpcReact.project.byId.useQuery({ id: projectId });
  const access = useCaseFieldAccess(projectId);
  const ready = access.readable && query.isSuccess && !query.error && !query.isFetching && !query.isPaused && query.data.id === projectId && query.data.organizationId === access.origin?.organizationId;
  return <div style={{ minWidth: 0 }}>
    <nav aria-label="Project settings" style={{ marginBottom: 12 }}>
      <a href={"/projects/" + encodeURIComponent(projectId)}>Project overview</a>{" / Settings / "}
      <span aria-current="page">Integrations</span>
    </nav>
    <h1>Project integrations</h1>
    <p className="text-muted">Manage this project’s saved repository connections.</p>
    <details style={{marginBottom:16}}><summary>Connection and source access</summary><p>Account authorization and saved repository membership are separate. Source reads and AI processing still require their own approval.</p></details>
    {!ready && <p role={query.error || access.query.error ? "alert" : "status"}>
      Project access could not yet be verified. Existing connection drafts remain mounted but withheld.
      <button type="button" className="btn-secondary" disabled={!access.authReady || access.query.isFetching || query.isFetching} onClick={() => { void access.query.refetch(); void query.refetch(); }}>Retry project access</button>
    </p>}
    {/* Never unmount credential/UNKNOWN controllers during an access refresh. */}
    <fieldset disabled={!ready} hidden={!ready} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <ProjectRepositories key={projectId} projectId={projectId} canEdit={ready && access.canEdit} />
      {access.origin && <AtlassianQualitySettings key={`${projectId}:${access.origin.clerkActorId}`} projectId={projectId} organizationId={access.origin.organizationId} canConfigure={ready && access.canConfigure} />}
      {access.origin && <AiDisclosureSettings projectId={projectId} organizationId={access.origin.organizationId} canConfigure={ready && access.canConfigure} />}
      {ready && query.data.repoUrl && <section className="panel" aria-label="Legacy primary repository reference">
        <h2>Legacy primary reference</h2>
        <p><code>{repositoryDisplayName(query.data.repoUrl)}</code>{" · branch "}{query.data.defaultBranch}</p>
        <p className="text-muted">Retained legacy metadata, not verified provider access and not a registered multi-repository selection.</p>
        <a href={"/projects/" + encodeURIComponent(projectId) + "/reverse-engineer"}>Review legacy source scope</a>
      </section>}
    </fieldset>
  </div>;
}
