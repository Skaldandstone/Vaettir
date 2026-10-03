"use client";

import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/Modal";
import {
  trpcReact,
  type RouterInputs,
  type RouterOutputs,
} from "@/lib/trpcReact";
import {
  retainedTraceabilityReceipt,
  type TraceabilityReceipt,
} from "@/lib/traceability-receipt";

type Snapshot = RouterOutputs["sharedStepGroups"]["review"]["snapshot"];
type Write = RouterInputs["sharedStepGroups"]["update"];
const fieldStyle = {
  display: "block",
  width: "100%",
  maxWidth: "100%",
  minWidth: 0,
  boxSizing: "border-box",
  marginTop: 4,
} as const;
const labelStyle = { display: "block", marginBottom: 12, minWidth: 0 } as const;
export function SharedStepHistoryReview({
  projectId,
  groupId,
  open,
  onClose,
  onSaved,
  onPendingChanged,
}: {
  projectId: string;
  groupId: string;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  onPendingChanged?: (pending: boolean) => void;
}) {
  const [before, setBefore] = useState<number>();
  const query = trpcReact.sharedStepGroups.review.useQuery(
    { projectId, id: groupId, before },
    { enabled: open, staleTime: 0, retry: false, refetchOnMount: "always" },
  );
  const [draft, setDraft] = useState<Snapshot | null>(null);
  const [action, setAction] = useState<Write["action"] | null>(null);
  const [selected, setSelected] = useState<number>();
  const [reason, setReason] = useState("");
  const [approved, setApproved] = useState(false);
  const [pending, setPending] = useState<Write | null>(null);
  const pendingReceipt = useRef<TraceabilityReceipt<Write> | null>(null);
  const [fresh, setFresh] = useState(false);
  const [baseline, setBaseline] = useState<string | null>(null);
  const mutation = trpcReact.sharedStepGroups.update.useMutation({
    onSuccess: () => {
      pendingReceipt.current = null;
      setPending(null);
      setAction(null);
      setDraft(null);
      setApproved(false);
      setBefore(undefined);
      onSaved();
      void query.refetch();
    },
    onError: (error) => {
      if (!pendingReceipt.current) return;
      pendingReceipt.current = retainedTraceabilityReceipt(
        pendingReceipt.current,
        error,
      );
      setPending(pendingReceipt.current?.input ?? null);
      if (!pendingReceipt.current) {
        setApproved(false);
        setBaseline(null);
        void query.refetch();
      }
    },
  });
  useEffect(() => {
    onPendingChanged?.(pending !== null);
  }, [pending, onPendingChanged]);
  const { refetch } = query;
  useEffect(() => {
    let active = true;
    if (open)
      void refetch().then((result) => {
        if (active && !result.isError) setFresh(true);
      });
    return () => {
      active = false;
    };
  }, [open, projectId, groupId, refetch]); // Fresh access, including cached-data failures.
  const ready =
    fresh &&
    query.data &&
    !query.isError &&
    query.fetchStatus === "idle" &&
    query.isFetchedAfterMount;
  const data = ready ? query.data : null;
  const source = data?.revisions.find((r) => r.revision === selected);
  const reset = () => {
    mutation.reset();
    setAction(null);
    setDraft(null);
    setSelected(undefined);
    setReason("");
    setApproved(false);
    setBaseline(null);
  };
  function choose(next: Write["action"], revision?: number) {
    if (!data || pending) return;
    mutation.reset();
    setAction(next);
    setSelected(revision);
    setDraft(next === "UPDATE" ? structuredClone(data.snapshot) : null);
    setBaseline(data.revisionHash);
    setApproved(false);
    setReason("");
  }
  function submit() {
    if (
      !data?.canEdit ||
      !approved ||
      !reason.trim() ||
      !action ||
      baseline !== data.revisionHash
    )
      return;
    const request = pending ?? {
      projectId,
      id: groupId,
      action,
      expectedRevisionHash: baseline,
      requestId: crypto.randomUUID(),
      reason: reason.trim(),
      confirmed: true as const,
      ...(action === "UPDATE" && draft
        ? {
            content: {
              name: draft.name,
              description: draft.description,
              steps: draft.steps,
            },
          }
        : {}),
      ...(action === "RESTORE" ? { sourceRevision: selected } : {}),
    };
    setPending(request);
    pendingReceipt.current ??= { input: request, uncertain: false };
    mutation.mutate(request);
  }
  const close = () => {
    setFresh(false);
    onClose();
  };
  return (
    <Modal
      open={open}
      onClose={close}
      title="Step library history and recovery"
      size="wide"
    >
      {!data ? (
        <div role="status">
          <p>
            {query.isError
              ? "Current library access could not be verified. Cached content is not usable for approval."
              : "Checking current library and access…"}
          </p>
          <button
            onClick={() =>
              void query.refetch().then((result) => setFresh(!result.isError))
            }
          >
            Retry library
          </button>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 12, minWidth: 0 }}>
          <h3 style={{ margin: 0, overflowWrap: "anywhere" }}>
            {data.snapshot.name} · Revision {data.revision}
          </h3>
          <p>
            {data.usageCount} current case{data.usageCount === 1 ? "" : "s"} use
            this library. Updating or restoring changes their current resolved
            procedure. Frozen run instructions and recorded outcomes stay
            unchanged.
          </p>
          <details>
            <summary>View current saved procedure</summary>
            <LibraryProcedure snapshot={data.snapshot} />
          </details>
          {data.canEdit && !action && !pending && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {data.snapshot.archived ? (
                <button onClick={() => choose("RECOVER")}>
                  Review recovery
                </button>
              ) : (
                <>
                  <button onClick={() => choose("UPDATE")}>
                    Edit current procedure
                  </button>
                  <button
                    disabled={data.usageCount > 0}
                    onClick={() => choose("ARCHIVE")}
                  >
                    Review archive
                  </button>
                </>
              )}
            </div>
          )}
          {!action && (
            <>
              <h4>Retained revisions</h4>
              <p className="text-muted">
                Migration baselines capture the content present then, not an
                invented earlier edit history. Unknown actors remain unknown.
              </p>
              {data.revisions.map((r) => (
                <details key={r.id}>
                  <summary>
                    Revision {r.revision} ·{" "}
                    {r.kind === "MIGRATION_BASELINE"
                      ? "Current content captured at migration"
                      : r.kind === "BASELINE_CAPTURE"
                        ? "Current content captured, original actor unknown"
                        : ((
                            {
                              CREATE: "Creation",
                              UPDATE: "Update",
                              RESTORE: "Restore",
                              ARCHIVE: "Archive",
                              RECOVER: "Recovery",
                            } as Record<string, string>
                          )[r.kind] ?? r.kind)}{" "}
                    · {new Date(r.recordedAt).toLocaleString()}
                  </summary>
                  <p>
                    Actor: {r.actorName ?? "Unknown / system capture"}
                    {r.reason ? ` · ${r.reason}` : ""}
                    {r.sourceRevision
                      ? ` · Restored from revision ${r.sourceRevision}`
                      : ""}
                  </p>
                  <LibraryProcedure snapshot={r.snapshot} />
                  <p>
                    Compare with current:{" "}
                    {JSON.stringify(r.snapshot) ===
                    JSON.stringify(data.snapshot)
                      ? "Same saved content"
                      : "Content or archive state differs. Both procedures are shown in full for review."}
                  </p>
                  {data.canEdit &&
                    !data.snapshot.archived &&
                    r.revision !== data.revision &&
                    !pending && (
                      <button onClick={() => choose("RESTORE", r.revision)}>
                        Review restore revision {r.revision}
                      </button>
                    )}
                </details>
              ))}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  disabled={!before || !!pending || !!action}
                  onClick={() => setBefore(undefined)}
                >
                  Latest revisions
                </button>
                {data.nextCursor && (
                  <button
                    disabled={!!pending || !!action}
                    onClick={() => setBefore(data.nextCursor!)}
                  >
                    Older revisions
                  </button>
                )}
              </div>
            </>
          )}
          {action && (
            <section
              className="panel"
              style={{ padding: 12, minWidth: 0 }}
              aria-label="Review library change"
            >
              <h4>
                {action === "UPDATE"
                  ? "Review procedure update"
                  : action === "RESTORE"
                    ? `Restore revision ${selected} as a new revision`
                    : action === "ARCHIVE"
                      ? "Archive this unused library"
                      : "Recover this library"}
              </h4>
              {baseline !== data.revisionHash && (
                <p role="alert">
                  The library changed after you began reviewing. Go back and
                  start a fresh review. Nothing was overwritten.
                </p>
              )}
              {draft && (
                <fieldset
                  disabled={!!pending || !data.canEdit}
                  style={{ minWidth: 0, border: 0, padding: 0 }}
                >
                  <label style={labelStyle}>
                    Name
                    <input
                      style={fieldStyle}
                      value={draft.name}
                      maxLength={200}
                      onChange={(e) =>
                        setDraft({ ...draft, name: e.target.value })
                      }
                    />
                  </label>
                  <label style={labelStyle}>
                    Description
                    <textarea
                      style={fieldStyle}
                      rows={3}
                      value={draft.description ?? ""}
                      maxLength={10000}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          description: e.target.value || null,
                        })
                      }
                    />
                  </label>
                  {draft.steps.map((step, i) => (
                    <div
                      key={i}
                      className="panel"
                      style={{ padding: 8, marginTop: 8 }}
                    >
                      <strong>Step {i + 1}</strong>
                      {(
                        [
                          "action",
                          "expectedActionOrData",
                          "expectedResult",
                          "expectedResponse",
                        ] as const
                      ).map((field) => (
                        <label key={field} style={labelStyle}>
                          {field === "action"
                            ? "Action"
                            : field === "expectedActionOrData"
                              ? "Expected action / data"
                              : field === "expectedResult"
                                ? "Expected result"
                                : "Expected response"}
                          <textarea
                            style={fieldStyle}
                            rows={3}
                            value={step[field] ?? ""}
                            maxLength={10000}
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                steps: draft.steps.map((s, j) =>
                                  j === i
                                    ? {
                                        ...s,
                                        [field]:
                                          field === "action"
                                            ? e.target.value
                                            : e.target.value || null,
                                      }
                                    : s,
                                ),
                              })
                            }
                          />
                        </label>
                      ))}
                      {!!step.mediaAttachmentIds?.length && (
                        <p>
                          Retained media references:{" "}
                          {step.mediaAttachmentIds.join(", ")}
                        </p>
                      )}
                      <div
                        style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
                      >
                        <button
                          disabled={i === 0}
                          onClick={() => {
                            const next = [...draft.steps];
                            [next[i - 1], next[i]] = [next[i]!, next[i - 1]!];
                            setDraft({
                              ...draft,
                              steps: next.map((s, order) => ({ ...s, order })),
                            });
                          }}
                        >
                          Move step {i + 1} up
                        </button>
                        <button
                          disabled={i === draft.steps.length - 1}
                          onClick={() => {
                            const next = [...draft.steps];
                            [next[i + 1], next[i]] = [next[i]!, next[i + 1]!];
                            setDraft({
                              ...draft,
                              steps: next.map((s, order) => ({ ...s, order })),
                            });
                          }}
                        >
                          Move step {i + 1} down
                        </button>
                        <button
                          disabled={draft.steps.length === 1}
                          onClick={() =>
                            setDraft({
                              ...draft,
                              steps: draft.steps
                                .filter((_, j) => j !== i)
                                .map((s, order) => ({ ...s, order })),
                            })
                          }
                        >
                          Remove step {i + 1}
                        </button>
                      </div>
                    </div>
                  ))}
                  <button
                    disabled={draft.steps.length >= 500}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        steps: [
                          ...draft.steps,
                          {
                            order: draft.steps.length,
                            action: "",
                            expectedResult: null,
                            expectedResponse: null,
                            expectedActionOrData: null,
                          },
                        ],
                      })
                    }
                  >
                    Add step
                  </button>
                </fieldset>
              )}
              {source && <LibraryProcedure snapshot={source.snapshot} />}
              <p>
                A new revision will be retained. No AI credits are used. This
                does not rewrite any frozen run.
              </p>
              <label style={labelStyle}>
                Reason (required)
                <textarea
                  style={fieldStyle}
                  rows={3}
                  value={reason}
                  maxLength={1000}
                  disabled={!!pending}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <label style={{ display: "flex", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={approved}
                  disabled={!!pending}
                  onChange={(e) => setApproved(e.target.checked)}
                />
                I reviewed the procedure and impact on current cases.
              </label>
              {mutation.isError && (
                <p role="alert">
                  {mutation.error.message}{" "}
                  {pending
                    ? "The outcome may be unconfirmed; retry the exact approved request to recover its durable receipt."
                    : "This request was rejected. Go back and review the current library before trying again."}
                </p>
              )}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button disabled={!!pending} onClick={reset}>
                  Back
                </button>
                <button
                  className="btn-primary"
                  disabled={
                    !data.canEdit ||
                    mutation.isPending ||
                    (!pending &&
                      (!approved ||
                        !reason.trim() ||
                        baseline !== data.revisionHash ||
                        !!draft?.steps.some((s) => !s.action?.trim()) ||
                        (!draft?.name.trim() && action === "UPDATE")))
                  }
                  onClick={() =>
                    pending ? mutation.mutate(pending) : submit()
                  }
                >
                  {mutation.isPending
                    ? "Saving reviewed revision…"
                    : pending
                      ? "Retry exact approved change"
                      : "Approve and save new revision"}
                </button>
              </div>
            </section>
          )}
          <button onClick={close}>Close</button>
        </div>
      )}
    </Modal>
  );
}

export function LibraryProcedure({ snapshot }: { snapshot: Snapshot }) {
  return (
    <div style={{ minWidth: 0, overflowWrap: "anywhere" }}>
      <p>{snapshot.description}</p>
      <p>{snapshot.archived ? "Archived" : "Active"}</p>
      <ol style={{ paddingLeft: 22 }}>
        {snapshot.steps.map((s, i) => (
          <li key={i} style={{ marginBottom: 10 }}>
            <strong>{s.action}</strong>
            {s.expectedActionOrData != null && (
              <p>Expected action / data: {s.expectedActionOrData}</p>
            )}
            {s.expectedResult != null && (
              <p>Expected result: {s.expectedResult}</p>
            )}
            {s.expectedResponse != null && (
              <p>Expected response: {s.expectedResponse}</p>
            )}
            {!!s.mediaAttachmentIds?.length && (
              <p>Media references: {s.mediaAttachmentIds.join(", ")}</p>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
