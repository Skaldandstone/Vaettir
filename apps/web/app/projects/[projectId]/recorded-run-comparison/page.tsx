"use client";
import { useParams } from "next/navigation";
import { RecordedRunComparison } from "@/components/RecordedRunComparison";
export default function RecordedRunComparisonPage() {
  const { projectId } = useParams<{ projectId: string }>();
  return <RecordedRunComparison projectId={projectId} />;
}
