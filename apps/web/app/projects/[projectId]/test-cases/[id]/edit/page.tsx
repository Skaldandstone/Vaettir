"use client";

import { useParams } from "next/navigation";
import { trpcReact } from "@/lib/trpcReact";
import TestCaseForm from "@/components/TestCaseForm";

// P1-15
export default function EditTestCasePage() {
  const params = useParams<{ projectId: string; id: string }>();
  const tcQuery = trpcReact.testCases.byId.useQuery({ id: params.id });
  const tc = tcQuery.data;

  if (tcQuery.error) return <p style={{ color: "var(--ember)" }}>{tcQuery.error.message}</p>;
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
