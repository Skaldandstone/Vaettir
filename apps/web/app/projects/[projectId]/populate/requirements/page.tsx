"use client";
import { useParams } from "next/navigation";
import { PopulationRequirements } from "@/components/PopulationRequirements";
import { useProjectPermissions } from "@/lib/use-project-permissions";
export default function Page() {
  const { projectId } = useParams<{ projectId: string }>();
  const { loaded, canEdit } = useProjectPermissions(projectId);
  if (!loaded) return <p>Loading project access…</p>;
  if (!canEdit)
    return <p>A full editor seat is required to approve suggestions.</p>;
  return (
    <div>
      <a href={`/projects/${projectId}/populate`}>Back to project setup</a>
      <PopulationRequirements projectId={projectId} />
    </div>
  );
}
