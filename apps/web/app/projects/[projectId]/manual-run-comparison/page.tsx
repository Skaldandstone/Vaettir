"use client";
import { useParams } from "next/navigation";
import { ManualRunComparison } from "@/components/ManualRunComparison";
export default function ManualRunComparisonPage() {
  const { projectId } = useParams<{ projectId: string }>();
  return <ManualRunComparison projectId={projectId} />;
}
