"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import TestCaseForm from "@/components/TestCaseForm";
import { useManualCasePermissions } from "@/lib/use-manual-case-permissions";

export default function NewTestCasePage() {
  const { projectId } = useParams<{ projectId: string }>();
  return <NewCaseSession key={projectId} projectId={projectId} />;
}

function NewCaseSession({ projectId }: { projectId: string }) {
  const { canEdit, loaded, accessError, retryAccess } =
    useManualCasePermissions(projectId);
  const [opened, setOpened] = useState(false);
  if (!opened && loaded && canEdit) setOpened(true);
  if (!opened && accessError)
    return (
      <div role="alert">
        <p>{accessError}</p>
        <button onClick={retryAccess}>Retry project access</button>
      </div>
    );
  if (!opened && !loaded) return <p>Checking project access…</p>;
  if (!opened && !canEdit)
    return (
      <p>
        Case-author access and a full seat are required to create test cases.
      </p>
    );
  const locked = !loaded || !canEdit;
  return (
    <div>
      <h1>New test case</h1>
      {locked && (
        <div role="alert">
          <p>
            {accessError ??
              (loaded
                ? "Create access is no longer available."
                : "Checking project access…")}{" "}
            Your unsaved draft is retained. Editing and saving are paused until
            access is verified.
          </p>
          <button onClick={retryAccess}>Retry project access</button>
        </div>
      )}
      <TestCaseForm mode="create" projectId={projectId} locked={locked} />
    </div>
  );
}
