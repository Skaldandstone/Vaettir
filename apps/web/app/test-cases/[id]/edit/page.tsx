"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { trpc, type RouterOutputs } from "../../../../lib/trpc";
import TestCaseForm from "../../../../components/TestCaseForm";

export default function EditTestCasePage() {
  const params = useParams<{ id: string }>();
  const [tc, setTc] = useState<RouterOutputs["testCases"]["byId"] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    trpc.testCases.byId
      .query({ id: params.id })
      .then(setTc)
      .catch((e) => setError(String(e)));
  }, [params.id]);

  if (error) return <p style={{ color: "crimson" }}>{error}</p>;
  if (!tc) return <p>Loading…</p>;

  return (
    <div>
      <h1>Edit test case</h1>
      <TestCaseForm
        mode="edit"
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
          given: tc.given,
          when: tc.when,
          then: tc.then,
          steps: tc.steps.map((s) => ({
            action: s.action,
            expectedActionOrData: s.expectedActionOrData ?? "",
            expectedResult: s.expectedResult ?? "",
            expectedResponse: s.expectedResponse ?? "",
          })),
        }}
      />
    </div>
  );
}
