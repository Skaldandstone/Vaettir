"use client";
import { useParams } from "next/navigation";
import { PopulationAssessment } from "@/components/PopulationAssessment";
export default function Page() {
  const { projectId } = useParams<{ projectId: string }>();
  return (
    <main>
      <a href={`/projects/${projectId}/populate`}>Back to setup</a>
      <PopulationAssessment projectId={projectId} />
    </main>
  );
}
