"use client";
import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/Modal";
import { trpcReact, type RouterInputs } from "@/lib/trpcReact";
import { useFolderActionScope } from "@/lib/use-folder-action-scope";
import {
  retainedTraceabilityReceipt,
  type TraceabilityReceipt,
} from "@/lib/traceability-receipt";

type Write = RouterInputs["caseFolders"]["recoveryWrite"];
export function TestCaseFolderRecovery({
  projectId,
  onSaved,
}: {
  projectId: string;
  onSaved: (path: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [selected, setSelected] = useState(""),
    [reviewId, setReviewId] = useState("");
  const [fresh, setFresh] = useState(false),
    [reason, setReason] = useState(""),
    [approved, setApproved] = useState(false),
    [pending, setPending] = useState<Write | null>(null);
  const [optionsGeneration, setOptionsGeneration] = useState(-1),
    [reviewGeneration, setReviewGeneration] = useState(-1),
    [draftStarted, setDraftStarted] = useState(false),
    [approvedHash, setApprovedHash] = useState<string | null>(null),
    [message, setMessage] = useState("");
  const scope = useFolderActionScope(projectId, open || !!message);
  const receipt = useRef<TraceabilityReceipt<Write> | null>(null);
  const options = trpcReact.caseFolders.recoveryCatalog.useQuery(
    { projectId },
    {
      enabled: scope.ready && open,
      retry: false,
      staleTime: 0,
      refetchOnMount: "always",
    },
  );
  const review = trpcReact.caseFolders.recoveryPreview.useQuery(
    { projectId, originalReceiptId: reviewId || "placeholder" },
    {
      enabled: scope.ready && open && !!reviewId,
      retry: false,
      staleTime: 0,
      refetchOnMount: "always",
    },
  );
  const [optionsFresh, setOptionsFresh] = useState(false);
  const mutation = trpcReact.caseFolders.recoveryWrite.useMutation({
    onSuccess: (result) => {
      const input = receipt.current?.input;
      const acknowledgedScope = input?.expectedScope ?? scope.origin;
      if (
        !input ||
        !acknowledgedScope ||
        (!input.expectedScope && scope.origin?.projectId !== input.projectId) ||
        result.requestId !== input.requestId ||
        result.projectId !== input.projectId ||
        result.organizationId !== acknowledgedScope.organizationId ||
        result.clerkActorId !== acknowledgedScope.clerkActorId ||
        result.originalReceiptId !== input.originalReceiptId
      ) {
        if (receipt.current)
          receipt.current = { ...receipt.current, uncertain: true };
        setPending(receipt.current?.input ?? null);
        setMessage(
          "The recovery receipt could not be verified. Its exact approved request is retained.",
        );
        return;
      }
      receipt.current = null;
      setPending(null);
      setOpen(false);
      setReviewId("");
      setApproved(false);
      setApprovedHash(null);
      setDraftStarted(false);
      const acknowledgement =
        "Placement recovery accepted as a new operation. The original procedure and evidence remain; this acknowledgement is separate from refreshing current access.";
      setMessage(acknowledgement);
      const live = scope.live.current;
      if (
        live.ready &&
        live.origin?.organizationId === result.organizationId &&
        live.origin.clerkActorId === result.clerkActorId
      ) {
        try {
          onSaved(result.destinationPath);
        } catch {
          setMessage(
            `${acknowledgement} The current table could not be refreshed; the accepted recovery was not retried.`,
          );
        }
        void options
          .refetch({ throwOnError: true })
          .catch(() =>
            setMessage(
              `${acknowledgement} Current receipts could not be refreshed; the accepted recovery was not retried.`,
            ),
          );
      }
    },
    onError: (error) => {
      if (!receipt.current) return;
      receipt.current = retainedTraceabilityReceipt(receipt.current, error);
      setPending(receipt.current?.input ?? null);
      if (!receipt.current) {
        setApproved(false);
        setFresh(false);
        setApprovedHash(null);
      }
    },
  });
  const { refetch: refetchOptions } = options;
  useEffect(() => {
    let active = true;
    const before = options.dataUpdatedAt;
    if (scope.ready && open)
      void refetchOptions().then((result) => {
        if (
          active &&
          !result.isError &&
          result.fetchStatus === "idle" &&
          result.dataUpdatedAt > before &&
          scope.matches(result.data) &&
          scope.live.current.generation === scope.generation
        ) {
          setOptionsFresh(true);
          setOptionsGeneration(scope.generation);
        }
      });
    return () => {
      active = false;
    };
  }, [open, scope.ready, scope.generation, refetchOptions]);
  const { refetch: refetchReview } = review;
  useEffect(() => {
    let active = true;
    const before = review.dataUpdatedAt;
    if (scope.ready && open && reviewId)
      void refetchReview().then((result) => {
        if (
          active &&
          !result.isError &&
          result.fetchStatus === "idle" &&
          result.dataUpdatedAt > before &&
          scope.matches(result.data) &&
          scope.live.current.generation === scope.generation
        ) {
          setFresh(true);
          setReviewGeneration(scope.generation);
        }
      });
    return () => {
      active = false;
    };
  }, [open, reviewId, scope.ready, scope.generation, refetchReview]);
  const currentOptions =
    scope.ready &&
    optionsFresh &&
    optionsGeneration === scope.generation &&
    !options.isError &&
    options.isFetchedAfterMount &&
    options.fetchStatus === "idle" &&
    scope.matches(options.data)
      ? options.data
      : null;
  const reviewed =
    !!currentOptions &&
    fresh &&
    reviewGeneration === scope.generation &&
    !!reviewId &&
    !review.isError &&
    review.isFetchedAfterMount &&
    review.fetchStatus === "idle" &&
    scope.matches(review.data) &&
    review.data?.originalReceiptId === reviewId
      ? review.data
      : null;
  function close() {
    setOpen(false);
    setFresh(false);
    setOptionsFresh(false);
  }
  async function refreshOptions() {
    setOptionsFresh(false);
    await scope.refresh();
    if (!scope.live.current.ready) return;
    const before = options.dataUpdatedAt;
    const result = await options.refetch();
    if (
      !result.isError &&
      result.fetchStatus === "idle" &&
      result.dataUpdatedAt > before &&
      scope.matches(result.data) &&
      scope.live.current.generation === scope.generation
    ) {
      setOptionsFresh(true);
      setOptionsGeneration(scope.generation);
    }
  }
  return (
    <>
      <button
        onClick={() => {
          setFresh(false);
          setOptionsFresh(false);
          if (!pending && !draftStarted) {
            setDraftStarted(true);
            setSelected("");
            setReviewId("");
            setReason("");
            setApproved(false);
            mutation.reset();
          }
          setApproved(false);
          setApprovedHash(null);
          setOpen(true);
        }}
      >
        Recover a folder move
      </button>
      {scope.ready && message && <p role="status">{message}</p>}
      <Modal
        open={open}
        onClose={close}
        title="Review folder recovery"
        size="wide"
      >
        {pending && (
          <p role="alert">
            An exact approved recovery request is retained. Verify its original
            account and workspace before recovering the outcome.
          </p>
        )}
        {scope.changed || scope.signedOut ? (
          <p role="alert">
            Receipt paths, recovery impact and draft controls are hidden after
            an account or workspace change. The original draft and request
            remain retained.
          </p>
        ) : !currentOptions ? (
          <div role={options.isError ? "alert" : "status"}>
            <p>
              {options.isError
                ? options.error.message
                : "Checking current full editor access…"}
            </p>
            <button
              disabled={!scope.actorReady}
              onClick={() => void refreshOptions()}
            >
              Retry access and receipts
            </button>
          </div>
        ) : !reviewId ? (
          <div style={{ display: "grid", gap: 12, minWidth: 0 }}>
            <p>
              Choose a recent rename or move (latest 25 receipts). Recovery
              restores placement only, as a new reviewed operation. It never
              replaces test steps, deletes history or changes existing runs.
            </p>
            <label>
              Folder operation
              <select
                value={selected}
                style={{
                  display: "block",
                  width: "100%",
                  boxSizing: "border-box",
                  marginTop: 4,
                }}
                onChange={(e) => setSelected(e.target.value)}
              >
                <option value="">Choose an operation…</option>
                {selected &&
                  !currentOptions.items.some((row) => row.id === selected) && (
                    <option value={selected}>
                      Selected operation (verify its current recovery impact)
                    </option>
                  )}
                {currentOptions.items.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.action === "MOVE" ? "Move" : "Rename"}:{" "}
                    {row.fromPath.split("/").join(" › ")} →{" "}
                    {row.toPath.split("/").join(" › ")} (
                    {new Date(row.createdAt).toLocaleString()})
                  </option>
                ))}
              </select>
            </label>
            {!currentOptions.items.length && (
              <p>
                No supported rename/move receipts are available. Missing
                historical baselines are not reconstructed.
              </p>
            )}
            <button
              className="btn-primary"
              disabled={!selected}
              onClick={() => {
                setFresh(false);
                setReviewId(selected);
                setApproved(false);
                setReason("");
              }}
            >
              Review recovery
            </button>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 12, minWidth: 0 }}>
            {review.isError ? (
              <div role="alert">
                <p>{review.error.message}</p>
                <button
                  onClick={() => {
                    setFresh(false);
                    setApproved(false);
                    setApprovedHash(null);
                    const before = review.dataUpdatedAt;
                    void review.refetch().then((r) => {
                      if (
                        !r.isError &&
                        r.fetchStatus === "idle" &&
                        r.dataUpdatedAt > before &&
                        scope.matches(r.data) &&
                        scope.live.current.generation === scope.generation
                      ) {
                        setApproved(false);
                        setApprovedHash(null);
                        setFresh(true);
                        setReviewGeneration(scope.generation);
                      }
                    });
                  }}
                >
                  Retry current review
                </button>
              </div>
            ) : !reviewed ? (
              <p role="status">
                Checking every retained placement and current case version…
              </p>
            ) : (
              <>
                <p style={{ overflowWrap: "anywhere" }}>
                  Current folder:{" "}
                  <strong>{reviewed.fromPath.split("/").join(" › ")}</strong>
                  <br />
                  Restore to:{" "}
                  <strong>{reviewed.toPath.split("/").join(" › ")}</strong>
                </p>
                <p>
                  {reviewed.caseCount} cases ({reviewed.archivedCaseCount}{" "}
                  archived). All placements change together or none do. Case
                  IDs, order, current procedures, earlier versions and frozen
                  run evidence remain intact. No AI credits are used.
                </p>
                <p>
                  Newer case edits, added cases, destination collisions or later
                  folder operations block this recovery. There is no blind
                  rollback or automatic merge.
                </p>
                {!!reviewed.caseCount && (
                  <details>
                    <summary>
                      Review all case placements ({reviewed.caseCount})
                    </summary>
                    <div style={{ maxHeight: 260, overflow: "auto" }}>
                      {reviewed.cases.map((c) => (
                        <p key={c.id} style={{ overflowWrap: "anywhere" }}>
                          <strong>{c.displayId}</strong>: {c.currentPath} →{" "}
                          {c.restoredEffectivePath}
                          {c.restoredSuitePath === null
                            ? " (original source-derived location)"
                            : ""}
                        </p>
                      ))}
                    </div>
                  </details>
                )}
                <label>
                  Reason (required)
                  <textarea
                    rows={3}
                    value={reason}
                    disabled={!!pending}
                    maxLength={1000}
                    onChange={(e) => setReason(e.target.value)}
                    style={{
                      display: "block",
                      width: "100%",
                      boxSizing: "border-box",
                      marginTop: 4,
                    }}
                  />
                </label>
                <label style={{ display: "flex", gap: 8 }}>
                  <input
                    type="checkbox"
                    disabled={!!pending}
                    checked={approved}
                    onChange={(e) => {
                      setApproved(e.target.checked);
                      setApprovedHash(
                        e.target.checked ? reviewed.expectedHash : null,
                      );
                    }}
                  />
                  I reviewed the complete recovery impact.
                </label>
              </>
            )}
            {mutation.isError && (
              <p role="alert">
                {mutation.error.message}{" "}
                {pending
                  ? "An earlier attempt may have committed. Keep this request and retry exactly; do not start a new recovery."
                  : "This operation was refused. Review current folders before trying again."}
              </p>
            )}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                disabled={!!pending}
                onClick={() => {
                  setReviewId("");
                  setFresh(false);
                  setApproved(false);
                  mutation.reset();
                }}
              >
                Back
              </button>
              <button
                className="btn-primary"
                disabled={
                  mutation.isPending ||
                  !currentOptions ||
                  (!pending &&
                    (!reviewed ||
                      !approved ||
                      approvedHash !== reviewed.expectedHash ||
                      !reason.trim()))
                }
                onClick={() => {
                  if (
                    mutation.isPending ||
                    !scope.live.current.ready ||
                    !currentOptions
                  )
                    return;
                  if (pending) {
                    mutation.mutate(pending);
                    return;
                  }
                  if (
                    !reviewed ||
                    !approved ||
                    approvedHash !== reviewed.expectedHash ||
                    !reason.trim()
                  )
                    return;
                  const input: Write = {
                    projectId,
                    originalReceiptId: reviewId,
                    expectedHash: reviewed.expectedHash,
                    requestId: crypto.randomUUID(),
                    confirmed: true,
                    reason,
                    expectedScope: {
                      organizationId: scope.origin!.organizationId,
                      clerkActorId: scope.origin!.clerkActorId,
                    },
                  };
                  receipt.current = { input, uncertain: false };
                  setPending(input);
                  mutation.mutate(input);
                }}
              >
                {mutation.isPending
                  ? "Saving…"
                  : pending
                    ? "Retry exact approved recovery"
                    : "Approve placement recovery"}
              </button>
            </div>
          </div>
        )}
        <button onClick={close} style={{ marginTop: 12 }}>
          Close
        </button>
      </Modal>
    </>
  );
}
