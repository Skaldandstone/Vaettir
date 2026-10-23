"use client";

import { useState } from "react";
import Link from "next/link";
import { trpcReact } from "../lib/trpcReact";
import { Modal } from "./Modal";

export function ProjectDeletionWizard({
  projectId,
  onClose,
  onDeleted,
}: {
  projectId: string;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const preview = trpcReact.project.deletionPreview.useQuery(
    { id: projectId },
    { refetchOnMount: "always", refetchOnWindowFocus: false },
  );
  const [reviewedFingerprint, setReviewedFingerprint] = useState<string | null>(
    null,
  );
  const [confirmation, setConfirmation] = useState("");
  const [includeContents, setIncludeContents] = useState(false);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const deletion = trpcReact.project.deleteReviewed.useMutation({
    onSuccess: onDeleted,
  });
  const data = !preview.isError ? preview.data : undefined;
  const confirming = !!data && reviewedFingerprint === data.fingerprint;
  const busy = deletion.isPending;
  const ready =
    !!data &&
    !preview.isFetching &&
    !data.blocked &&
    confirming &&
    confirmation === data.name &&
    (!data.hasContents || includeContents);
  function reviewAgain() {
    setReviewedFingerprint(null);
    setConfirmation("");
    setIncludeContents(false);
    setRequestId(crypto.randomUUID());
    deletion.reset();
    void preview.refetch();
  }
  return (
    <Modal
      open
      title={
        confirming
          ? `Confirm deletion of ${data.name}`
          : "Review project deletion"
      }
      onClose={onClose}
      dismissible={!busy}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!ready || busy || !data) return;
          deletion.mutate({
            id: data.id,
            organizationId: data.organizationId,
            expectedName: data.name,
            previewFingerprint: data.fingerprint,
            includeContents,
            requestId,
          });
        }}
      >
        <p className="eyebrow">
          {confirming ? "Step 2 of 2: Confirm" : "Step 1 of 2: Review contents"}
        </p>
        {preview.isFetching && (
          <p role="status">Checking the project’s current contents…</p>
        )}
        {preview.isError && (
          <p className="text-error" role="alert">
            {preview.error.message}{" "}
            <button
              className="btn-secondary"
              type="button"
              onClick={reviewAgain}
            >
              Retry review
            </button>
          </p>
        )}
        {data && (
          <>
            <p>
              <strong>{data.name}</strong>
            </p>
            {data.rows.length > 0 ? (
              <ul aria-label="Project contents">
                {data.rows.map((row) => (
                  <li key={row.key}>
                    {row.count.toLocaleString()} {row.label}
                    {row.blocksDeletion ? " — separate review required" : ""}
                  </li>
                ))}
              </ul>
            ) : (
              <p>This project has no content to remove.</p>
            )}
            <p>
              Deleting removes this project and the included contents from
              Vaettir.
            </p>
            {data.rows.some((row) => row.key === "testCases") && (
              <p>
                Case deletion includes editable steps, attachments, datasets,
                sources and version snapshots.
              </p>
            )}
            {data.rows.some((row) => row.key === "testPlans") && (
              <p>Plan deletion includes versions and acceptance criteria.</p>
            )}
            <p>
              Workspace audit history, case-key reservations and the deletion
              receipt are kept. External repositories and tickets are unchanged.
            </p>
            {data.blocked ? (
              <div role="status">
                <p>
                  This project needs a separate removal review for the
                  highlighted records. Recorded evidence and approval history
                  cannot be erased through this flow. No records have been
                  deleted.
                </p>
                <p>
                  <Link href={`/projects/${data.id}`} onClick={onClose}>
                    Open project to review these records
                  </Link>
                </p>
              </div>
            ) : confirming ? (
              <>
                <p>
                  <strong>
                    This deletion is permanent and cannot be undone.
                  </strong>
                </p>
                {data.hasContents && (
                  <label className="project-deletion-consent">
                    <input
                      type="checkbox"
                      checked={includeContents}
                      disabled={busy}
                      onChange={(event) =>
                        setIncludeContents(event.target.checked)
                      }
                    />
                    <span>
                      Yes, also permanently remove the project contents listed
                      above.
                    </span>
                  </label>
                )}
                <label className="confirmation-label">
                  Type the project name to confirm<strong>{data.name}</strong>
                  <input
                    aria-label="Project name confirmation"
                    value={confirmation}
                    disabled={busy}
                    onChange={(event) => setConfirmation(event.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>
              </>
            ) : (
              <p>
                Continue to confirm the project name and whether to remove its
                contents.
              </p>
            )}
          </>
        )}
        {deletion.error && (
          <div role="alert" className="text-error">
            <p>{deletion.error.message}</p>
            <p>
              Retrying keeps the same request ID, so a completed deletion will
              not run twice.
            </p>
            <button
              className="btn-secondary"
              type="button"
              disabled={busy}
              onClick={reviewAgain}
            >
              Refresh contents and start a new review
            </button>
          </div>
        )}
        <div className="review-actions">
          <button
            data-dialog-initial-focus
            type="button"
            className="btn-secondary"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          {confirming && (
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              onClick={() => {
                setReviewedFingerprint(null);
                setConfirmation("");
                setIncludeContents(false);
              }}
            >
              Back
            </button>
          )}
          {confirming ? (
            <button
              type="submit"
              className="btn-danger"
              disabled={!ready || busy}
            >
              {busy
                ? "Deleting…"
                : deletion.error
                  ? "Retry deletion"
                  : data?.hasContents
                    ? "Delete project and contents"
                    : "Delete project"}
            </button>
          ) : (
            <button
              type="button"
              className="btn-primary"
              disabled={!data || data.blocked || preview.isFetching}
              onClick={() => {
                if (data) setReviewedFingerprint(data.fingerprint);
              }}
            >
              Continue to confirmation
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}
