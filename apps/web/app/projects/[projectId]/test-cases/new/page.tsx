"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import TestCaseForm from "@/components/TestCaseForm";
import { useProjectPermissions } from "@/lib/use-project-permissions";

export default function NewTestCasePage() {
  const { projectId } = useParams<{ projectId: string }>();
  return <NewCaseSession key={projectId} projectId={projectId} />;
}

function NewCaseSession({ projectId }: { projectId: string }) {
  const { canEdit, loaded, accessError, retryAccess } =
    useProjectPermissions(projectId);
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
        A full-seat Editor, Admin, or Owner is required to create test cases.
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
