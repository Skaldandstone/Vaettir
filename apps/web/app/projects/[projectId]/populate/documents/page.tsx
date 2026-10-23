"use client";
import { useParams } from "next/navigation";
import { PopulationDocuments } from "@/components/PopulationDocuments";
import { useProjectPermissions } from "@/lib/use-project-permissions";
export default function PopulationDocumentPage() {
  const {projectId}=useParams<{projectId:string}>();
  const {canEdit,loaded}=useProjectPermissions(projectId);
  if(!loaded) return <p>Loading project access…</p>;
  if(!canEdit) return <p>A full editor seat is required to review document evidence.</p>;
  return <div><a href={`/projects/${projectId}/populate`}>Back to project setup</a><PopulationDocuments projectId={projectId}/></div>;
}
