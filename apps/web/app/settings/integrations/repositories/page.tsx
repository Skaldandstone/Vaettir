"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { trpcReact } from "@/lib/trpcReact";
import { RepositoryOAuthApplicationSetup } from "@/components/RepositoryOAuthApplicationSetup";

function RepositoryApplicationSettings() {
  const search = useSearchParams();
  const [projectId, setProjectId] = useState(search.get("projectId") ?? "");
  const [providerId, setProviderId] = useState<"github" | "gitlab">(search.get("provider") === "github" ? "github" : "gitlab");
  const organizations = trpcReact.organization.mine.useQuery();
  const [selectedOrg, setSelectedOrg] = useState("");
  const orgId = organizations.isSuccess ? selectedOrg || organizations.data[0]?.id || "" : "";
  const projects = trpcReact.project.list.useQuery({ organizationId: orgId }, { enabled: Boolean(orgId) && !projectId });
  return <main style={{ maxWidth: 720, minWidth: 0 }}>
    <h1>Repository application administration</h1>
    <p><Link href="/settings/integrations">Back to integrations</Link>{projectId && <> · <Link href={`/projects/${encodeURIComponent(projectId)}`}>Back to project</Link></>}</p>
    {!projectId ? <section style={{ display: "grid", gap: 12 }}>
      <h2>Choose a workspace project</h2>
      {organizations.error && <p role="alert">Workspace access could not be refreshed.</p>}
      {!organizations.isSuccess && !organizations.error && <p role="status">Checking workspace access…</p>}
      {organizations.isSuccess && !organizations.data.length && <p role="status">Join or create a workspace first.</p>}
      {organizations.isSuccess && organizations.data.length > 1 && <label>Workspace<select value={orgId} onChange={e => setSelectedOrg(e.target.value)}>{organizations.data.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}</select></label>}
      {projects.error && <><p role="alert">Projects could not be refreshed.</p><button type="button" onClick={() => void projects.refetch()}>Retry project list</button></>}
      {orgId && projects.isPending && <p role="status">Loading accessible projects…</p>}
      {projects.isSuccess && !projects.data.length && <p role="status">Create a project in this workspace first.</p>}
      {projects.isSuccess && projects.data.map(project => <button type="button" className="btn-secondary" key={project.id} onClick={() => setProjectId(project.id)}>{project.name}</button>)}
    </section> : <>
      <div role="group" aria-label="Application provider" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        {(["gitlab", "github"] as const).map(id => <button type="button" key={id} className="btn-secondary" aria-pressed={id === providerId} onClick={() => setProviderId(id)}>{id === "gitlab" ? "GitLab" : "GitHub"}</button>)}
        <button type="button" className="btn-secondary" onClick={() => setProjectId("")}>Choose another project</button>
      </div>
      <RepositoryOAuthApplicationSetup key={`${projectId}:${providerId}`} projectId={projectId} providerId={providerId}/>
    </>}
  </main>;
}

export default function RepositoryApplicationSettingsPage() {
  return <Suspense fallback={<p role="status">Loading repository administration…</p>}><RepositoryApplicationSettings/></Suspense>;
}
