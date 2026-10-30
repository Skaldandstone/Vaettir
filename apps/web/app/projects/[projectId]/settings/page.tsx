"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ProjectCaseKey } from "@/components/ProjectCaseKey";
import { useProjectPermissions } from "@/lib/use-project-permissions";

export default function ProjectSettingsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { canEdit, loaded } = useProjectPermissions(projectId);
  return <div style={{ maxWidth: 900 }}>
    <h1>Project settings</h1>
    {loaded && <section className="panel"><h2>Project key</h2><ProjectCaseKey key={projectId} projectId={projectId} canEdit={canEdit} /></section>}
    <section className="panel"><h2>Integrations</h2><Link href={`/projects/${encodeURIComponent(projectId)}/settings/integrations`}>Manage integrations</Link></section>
  </div>;
}
