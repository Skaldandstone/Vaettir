"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { trpcReact, type RouterOutputs } from "@/lib/trpcReact";
import TestCaseForm from "@/components/TestCaseForm";
import { useProjectPermissions } from "@/lib/use-project-permissions";

// P1-15
export default function EditTestCasePage() {
  const params = useParams<{ projectId: string; id: string }>();
  return (
    <EditCaseSession key={`${params.projectId}:${params.id}`} params={params} />
  );
}

function EditCaseSession({
  params,
}: {
  params: { projectId: string; id: string };
}) {
  const { canEdit, loaded, accessError, retryAccess } = useProjectPermissions(
    params.projectId,
  );
  const tcQuery = trpcReact.testCases.byId.useQuery({ id: params.id });
  const [tc, setBaseline] = useState<RouterOutputs["testCases"]["byId"] | null>(null);
  if (
    !tc &&
    loaded &&
    canEdit &&
    !tcQuery.error &&
    tcQuery.data?.id === params.id
  )
    setBaseline(tcQuery.data);
  const pageError = accessError ?? tcQuery.error?.message;
  const locked = !loaded || !canEdit || !!pageError;

  if (!tc && pageError)
    return (
      <div role="alert">
        <p>{pageError}</p>
        <button
          onClick={() => {
            retryAccess();
            void tcQuery.refetch();
          }}
        >
          Retry access and case
        </button>
      </div>
    );
  if (!tc && !loaded) return <p>Checking project access…</p>;
  if (!tc && !canEdit)
    return (
      <p>A full-seat Editor, Admin, or Owner is required to edit test cases.</p>
    );
  if (!tc && tcQuery.data && tcQuery.data.id !== params.id)
    return <p role="alert">The returned case does not match this editor.</p>;
  if (!tc) return <p>Loading test case…</p>;
  const savedChanged =
    tcQuery.data &&
    (tcQuery.data.stepRevision !== tc.stepRevision ||
      tcQuery.data.priority !== tc.priority ||
      tcQuery.data.suitePath !== tc.suitePath);

  return (
    <div>
      <h1>Edit test case</h1>
      {locked && (
        <div role="alert">
          <p>
            {pageError ??
              (loaded
                ? "Edit access is no longer available."
                : "Checking project access…")}{" "}
            Your unsaved draft is retained. Editing and saving are paused until
            access is verified.
          </p>
          <button
            onClick={() => {
              retryAccess();
              void tcQuery.refetch();
            }}
          >
            Retry access and case
          </button>
        </div>
      )}
      {savedChanged && (
        <p role="status">
          The saved case changed while you were editing. Your draft and original
          comparison baseline are retained; saving will check for conflicts.{" "}
          <a
            href={`/projects/${params.projectId}/test-cases/${params.id}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            View current saved case
          </a>
        </p>
      )}
      <TestCaseForm
        locked={locked}
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
          validationDomain: tc.validationDomain,
          verificationProfile: tc.verificationProfile,
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
                mediaAttachmentIds: s.mediaAttachmentIds,
              })),
          stepRevision: tc.stepRevision,
          sharedStepGroupId: tc.sharedStepGroupId ?? "",
        }}
      />
    </div>
  );
}
