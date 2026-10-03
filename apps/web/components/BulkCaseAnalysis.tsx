"use client";
import { DurableCaseAnalysis } from "./DurableCaseAnalysis";
export function BulkCaseAnalysis({
  projectId,
  selectedIds,
  onCompleted,
}: {
  projectId: string;
  organizationId: string;
  selectedIds: string[];
  onCompleted: () => void;
}) {
  return (
    <DurableCaseAnalysis
      projectId={projectId}
      selectedIds={selectedIds}
      onCompleted={onCompleted}
    />
  );
}
