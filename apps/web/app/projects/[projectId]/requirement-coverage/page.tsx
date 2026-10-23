"use client";
import { useParams } from "next/navigation";
import { RequirementCoverageMatrix } from "@/components/RequirementCoverageMatrix";
export default function RequirementCoveragePage() {
  const { projectId } = useParams<{ projectId: string }>();
  return <RequirementCoverageMatrix projectId={projectId} />;
}
