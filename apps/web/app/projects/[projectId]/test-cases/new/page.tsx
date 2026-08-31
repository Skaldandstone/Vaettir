"use client";

import { useParams } from "next/navigation";
import TestCaseForm from "@/components/TestCaseForm";
import { useProjectPermissions } from "@/lib/use-project-permissions";

export default function NewTestCasePage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { canEdit, loaded } = useProjectPermissions(projectId);
  if (!loaded) return <p>Checking project access…</p>;
  if (!canEdit) return <p>A full-seat editor, admin or owner is required to create test cases.</p>;
  return (
    <div>
      <h1>New test case</h1>
      <TestCaseForm mode="create" projectId={projectId} />
    </div>
  );
}
