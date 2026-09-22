"use client";

import { useParams } from "next/navigation";
import { trpcReact } from "@/lib/trpcReact";
import TestCaseForm from "@/components/TestCaseForm";
import { useProjectPermissions } from "@/lib/use-project-permissions";

// P1-15
export default function EditTestCasePage() {
  const params = useParams<{ projectId: string; id: string }>();
  const { canEdit, loaded } = useProjectPermissions(params.projectId);
  const tcQuery = trpcReact.testCases.byId.useQuery({ id: params.id });
  const tc = tcQuery.data;

  if (tcQuery.error) return <p style={{ color: "var(--ember)" }}>{tcQuery.error.message}</p>;
  if (!loaded || !tc) return <p>Loading…</p>;
  if (!canEdit) return <p>A full-seat Editor, Admin, or Owner is required to edit test cases.</p>;

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
