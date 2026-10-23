"use client";
import { useParams } from "next/navigation";
import { RecordedExecutionTrend } from "@/components/RecordedExecutionTrend";
export default function ExecutionTrendsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  return <RecordedExecutionTrend projectId={projectId} />;
}
