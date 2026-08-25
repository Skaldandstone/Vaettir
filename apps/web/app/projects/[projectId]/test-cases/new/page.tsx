"use client";

import { useParams } from "next/navigation";
import TestCaseForm from "@/components/TestCaseForm";

export default function NewTestCasePage() {
  const { projectId } = useParams<{ projectId: string }>();
  return (
    <div>
      <h1>New test case</h1>
      <TestCaseForm mode="create" projectId={projectId} />
    </div>
  );
}
