"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import TestCaseForm from "@/components/TestCaseForm";
import { useProjectPermissions } from "@/lib/use-project-permissions";

export default function EditTestCasePage() {
  const params = useParams<{ projectId: string; id: string }>();
  const { canEdit, loaded } = useProjectPermissions(params.projectId);
  const [tc, setTc] = useState<RouterOutputs["testCases"]["byId"] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    trpc.testCases.byId
      .query({ id: params.id })
      .then(setTc)
      .catch((e) => setError(String(e)));
  }, [params.id]);

  if (error) return <p style={{ color: "var(--ember)" }}>{error}</p>;
  if (!loaded) return <p>Checking project access…</p>;
  if (!canEdit) return <p>A full-seat editor, admin or owner is required to edit test cases.</p>;
  if (!tc) return <p>Loading…</p>;

  return (
    <div>
      <h1>Edit test case</h1>
      <TestCaseForm
        mode="edit"
        projectId={params.projectId}
        testCaseId={tc.id}
        stepFieldLabels={
          tc.stepFieldLabels as {
            action: string;
            expectedActionOrData: string;
            expectedResult: string;
            expectedResponse: string;
          }
        }
        initial={{
          title: tc.title,
          background: tc.background ?? "",
          testType: tc.testType,
          priority: tc.priority,
          tags: tc.tags.join(", "),
          suitePath: tc.suitePath ?? "",
          given: tc.given,
          when: tc.when,
          then: tc.then,
          steps: tc.sharedStepGroupId
            ? []
            : tc.steps.map((s) => ({
                action: s.action,
                expectedActionOrData: s.expectedActionOrData ?? "",
                expectedResult: s.expectedResult ?? "",
                expectedResponse: s.expectedResponse ?? "",
              })),
          sharedStepGroupId: tc.sharedStepGroupId ?? "",
        }}
      />
    </div>
  );
}
