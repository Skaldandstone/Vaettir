"use client";
import { useParams, useRouter } from "next/navigation";
import { ProjectPopulationModal } from "@/components/ProjectPopulationModal";
export default function Page() {
  const { projectId } = useParams<{ projectId: string }>();
  const router = useRouter();
  return <ProjectPopulationModal projectId={projectId} onClose={() => router.push(`/projects/${projectId}`)} />;
}
