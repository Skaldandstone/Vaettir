"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  trpcReact,
  type RouterInputs,
  type RouterOutputs,
} from "@/lib/trpcReact";
import {
  retainedTraceabilityReceipt,
  type TraceabilityReceipt,
} from "@/lib/traceability-receipt";
import { Modal } from "./Modal";
import { inspectorLabel } from "@/lib/case-inspector";
import { readComparedProcedureSteps } from "@/lib/compared-procedure-steps";
type Preview = RouterOutputs["caseProcedureReimport"]["preview"];
type Request = RouterInputs["caseProcedureReimport"]["approve"];
function accessRejection(error: unknown) {
  const code = (error as { data?: { code?: string } } | null)?.data?.code;
  return ["FORBIDDEN", "UNAUTHORIZED", "NOT_FOUND"].includes(code ?? "");
}
function ProcedureValue({ label, value }: { label: string; value: string }) {
  if (["given", "when", "then", "tags"].includes(label)) {
    let rows: unknown;
    try {
      rows = JSON.parse(value);
    } catch {
      /* The complete server comparison remains readable below. */
    }
    if (Array.isArray(rows) && rows.every((row) => typeof row === "string"))
      return rows.length ? (
        <ol>
          {rows.map((row, i) => (
            <li
              key={i}
              style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
            >
              {row}
            </li>
          ))}
        </ol>
      ) : (
        <p>None</p>
      );
  }
  if (label === "authoredSteps") {
    const rows = readComparedProcedureSteps(value);
    if (rows !== null)
      return rows.length ? (
        <div
          role="region"
          aria-label="Complete ordered procedure comparison"
          tabIndex={0}
          style={{ maxWidth: "100%", overflowX: "auto" }}
        >
          <table>
            <caption>
              Stored step order is preserved, not renumbered. Empty strings and
              absent expected values remain distinct. Media IDs are references,
              not fetched or verified files.
            </caption>
            <thead>
              <tr>
                <th>Step</th>
                <th>Action</th>
                <th>Expected data</th>
                <th>Expected result</th>
                <th>Response</th>
                <th>Media IDs</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  <td>{String(row.order)}</td>
                  {(
                    [
                      "action",
                      "expectedActionOrData",
                      "expectedResult",
                      "expectedResponse",
                    ] as const
                  ).map((key) => (
                    <td
                      key={key}
                      style={{
                        whiteSpace: "pre-wrap",
                        overflowWrap: "anywhere",
                      }}
                    >
                      {row[key] === null ? (
                        "Not supplied"
                      ) : row[key] === "" ? (
                        <em>Empty string</em>
                      ) : (
                        row[key]
                      )}
                    </td>
                  ))}
                  <td>
                    {row.mediaAttachmentIds.length ? (
                      <ul>
                        {row.mediaAttachmentIds.map((id) => (
                          <li key={id} style={{ overflowWrap: "anywhere" }}>
                            {id}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      "None"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>No ordered steps.</p>
      );
  }
  return (
    <>
      {label === "authoredSteps" && (
        <p role="note">
          The complete value cannot be shown as a supported ordered table. No
          rows or fields were omitted; review the full raw comparison below.
        </p>
      )}
      <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
        {value}
      </pre>
    </>
  );
}
export function TestCaseProcedureReimport({
  projectId,
}: {
  projectId: string;
}) {
  return <ProcedureWorkflow key={projectId} projectId={projectId} />;
}
function ProcedureWorkflow({ projectId }: { projectId: string }) {
  const utils = trpcReact.useUtils();
  const { isLoaded, isSignedIn, userId } = useAuth();
  const [origin, setOrigin] = useState<{
    organizationId: string;
    clerkActorId: string;
  } | null>(null);
  const project = trpcReact.project.byId.useQuery(
    { id: projectId },
    { staleTime: 0 },
  );
  const organizations = trpcReact.organization.mine.useQuery(undefined, {
    staleTime: 0,
  });
  const actorReady = isLoaded && isSignedIn && !!userId;
  const projectReady =
    !project.error &&
    !project.isFetching &&
    !project.isPaused &&
    project.data?.id === projectId;
  const memberReady =
    !organizations.error &&
    !organizations.isFetching &&
    !organizations.isPaused &&
    Array.isArray(organizations.data);
  const membership = memberReady
    ? organizations.data?.find(
        (row) =>
          row.id === project.data?.organizationId &&
          ["OWNER", "ADMIN", "EDITOR", "VIEWER", "COMPLIANCE_AUDITOR"].includes(
            row.role,
          ) &&
          ["FULL", "READ_ONLY"].includes(row.seatType),
      )
    : undefined;
  useEffect(() => {
    if (!origin && actorReady && projectReady && membership)
      setOrigin({
        organizationId: project.data!.organizationId,
        clerkActorId: userId!,
      });
  }, [origin, actorReady, projectReady, membership, project.data, userId]);
  const accessReady =
    !!origin &&
    actorReady &&
    projectReady &&
    !!membership &&
    origin.organizationId === project.data?.organizationId &&
    origin.clerkActorId === userId;
  const editorReady =
    accessReady &&
    membership?.seatType === "FULL" &&
    ["OWNER", "ADMIN", "EDITOR"].includes(membership.role);
  const previewMutation = trpcReact.caseProcedureReimport.preview.useMutation();
  const approveMutation = trpcReact.caseProcedureReimport.approve.useMutation();
  const [open, setOpen] = useState(false),
    [serialized, setSerialized] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null),
    [notice, setNotice] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({}),
    [selected, setSelected] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState(false),
    [page, setPage] = useState(0);
  const [accessRejected, setAccessRejected] = useState(false);
  const [reviewInvalid, setReviewInvalid] = useState(false);
  const [pending, setPending] = useState<TraceabilityReceipt<Request> | null>(
    null,
  );
  const [result, setResult] = useState<
    RouterOutputs["caseProcedureReimport"]["approve"] | null
  >(null);
  const fileGeneration = useRef(0);
  const currentOrganizationId = project.data?.organizationId;
  const scopeKey = JSON.stringify([open, accessReady, editorReady, userId, currentOrganizationId]);
  const [scopeState, setScopeState] = useState({ key: scopeKey, generation: 0 });
  const scopeGeneration = scopeState.key === scopeKey ? scopeState.generation : scopeState.generation + 1;
  if (scopeState.key !== scopeKey) setScopeState({ key: scopeKey, generation: scopeGeneration });
  const scopeNow = useRef<{ open: boolean; accessReady: boolean; editorReady: boolean; userId: typeof userId; organizationId: string | undefined; generation: number }>({ open: false, accessReady: false, editorReady: false, userId: null, organizationId: undefined, generation: -1 });
  useLayoutEffect(() => {
    scopeNow.current = { open, accessReady, editorReady, userId, organizationId: currentOrganizationId, generation: scopeGeneration };
    return () => { scopeNow.current = { open: false, accessReady: false, editorReady: false, userId: null, organizationId: undefined, generation: -1 }; };
  }, [open, accessReady, editorReady, userId, currentOrganizationId, scopeGeneration]);
  const paused =
    project.isPaused ||
    organizations.isPaused ||
    previewMutation.isPaused ||
    approveMutation.isPaused;
  // The preview endpoint requires a full editor, so a demoted/read-only seat
  // must not reveal retained editor-only procedure comparisons either.
  const privateReady = editorReady && !paused && !accessRejected;
  const previewReady =
    privateReady &&
    !!preview &&
    preview.projectId === projectId &&
    preview.organizationId === origin?.organizationId &&
    preview.actorClerkUserId === userId;
  const resultReady =
    privateReady &&
    !!result &&
    result.projectId === projectId &&
    result.organizationId === origin?.organizationId &&
    result.actorClerkUserId === userId;
  const busy = previewMutation.isPending || approveMutation.isPending;
  async function chooseFile(file?: File) {
    if (pending || busy) return;
    if (!open || !privateReady) return;
    const generation = ++fileGeneration.current;
    const scopeAtLaunch = scopeNow.current.generation;
    setSerialized("");
    setPreview(null);
    setSelected([]);
    setReasons({});
    setConfirmed(false);
    setResult(null);
    setNotice(null);
    setPage(0);
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setNotice("Choose procedure JSON no larger than 2 MiB.");
      return;
    }
    try {
      const text = await file.text();
      if (generation === fileGeneration.current && scopeNow.current.generation === scopeAtLaunch && scopeNow.current.open && scopeNow.current.editorReady) setSerialized(text);
    } catch {
      if (generation === fileGeneration.current && scopeNow.current.generation === scopeAtLaunch && scopeNow.current.open && scopeNow.current.editorReady)
        setNotice("The file could not be read. Choose it again.");
    }
  }
  async function review() {
    if (busy || pending || !serialized) return;
    if (!open || !privateReady || !origin) return;
    setPreview(null);
    setNotice(null);
    setSelected([]);
    setReasons({});
    setConfirmed(false);
    const generation = fileGeneration.current;
    const scopeAtLaunch = scopeNow.current.generation;
    try {
      const value = await previewMutation.mutateAsync({
        projectId,
        serialized,
        expectedScope: { ...origin },
      });
      if (
        generation === fileGeneration.current &&
        scopeNow.current.generation === scopeAtLaunch &&
        value.projectId === projectId &&
        value.organizationId === origin.organizationId &&
        value.actorClerkUserId === origin.clerkActorId &&
        scopeNow.current.open &&
        scopeNow.current.editorReady &&
        scopeNow.current.userId === origin.clerkActorId &&
        scopeNow.current.organizationId === origin.organizationId
      ) {
        setPreview(value);
        setReviewInvalid(false);
        setPage(0);
      }
    } catch (error) {
      if (accessRejection(error)) setAccessRejected(true);
      setNotice(
        error instanceof Error
          ? error.message
          : "Review failed. Retry; no cases were restored.",
      );
    }
  }
  async function approve() {
    if (
      busy ||
      !open ||
      !privateReady ||
      (!pending && (!previewReady || reviewInvalid))
    )
      return;
    if (
      !pending &&
      (!confirmed ||
        !selected.length ||
        selected.some((id) => !reasons[id]?.trim()))
    )
      return;
    const attempt = pending ?? {
      input: {
        projectId,
        serialized,
        expectedReviewHash: preview!.expectedReviewHash,
        actorId: preview!.actorId,
        expectedScope: { ...origin! },
        selections: selected.map((caseId) => ({
          caseId,
          reason: reasons[caseId]!.trim(),
          overwriteConfirmed: true as const,
        })),
        confirmed: true as const,
        requestId: crypto.randomUUID(),
      },
      uncertain: false,
    };
    setPending(attempt);
    setNotice(null);
    let output: RouterOutputs["caseProcedureReimport"]["approve"];
    try {
      output = await approveMutation.mutateAsync(attempt.input);
      const expected = attempt.input.expectedScope ?? origin!;
      if (
        output.requestId !== attempt.input.requestId ||
        output.projectId !== attempt.input.projectId ||
        output.organizationId !== expected.organizationId ||
        output.actorClerkUserId !== expected.clerkActorId
      )
        throw Error(
          "The restoration receipt did not match the exact original approval. Retry that unchanged request.",
        );
    } catch (error) {
      const retained = retainedTraceabilityReceipt(attempt, error);
      setPending(retained);
      if (accessRejection(error)) setAccessRejected(true);
      if (!retained) {
        setReviewInvalid(true);
        setConfirmed(false);
      }
      setNotice(
        error instanceof Error
          ? error.message
          : "Restoration could not be confirmed. Retry the exact request.",
      );
      return;
    }
    // Acknowledgement is final even if a later read fails or the active actor
    // changes. Retained private results are gated separately, never resubmitted.
    setPending(null);
    setResult(output);
    setNotice(null);
    void Promise.resolve()
      .then(() =>
        Promise.all([
          utils.testCases.list.invalidate({ projectId }),
          utils.testCaseStructure.list.invalidate({ projectId }),
          ...output.restored.flatMap((restored) => [
            utils.testCases.byId.invalidate({ id: restored.caseId }),
            utils.caseVersionReview.list.invalidate({
              projectId,
              testCaseId: restored.caseId,
            }),
          ]),
        ]),
      )
      .catch(() =>
        setNotice(
          "Restoration is confirmed. Refreshing case lists or history failed; recheck current access and refresh those views. Do not submit this accepted approval again.",
        ),
      );
  }
  function restart() {
    if (pending || busy) return;
    fileGeneration.current++;
    setSerialized("");
    setPreview(null);
    setResult(null);
    setNotice(null);
    setSelected([]);
    setReasons({});
    setConfirmed(false);
    setPage(0);
  }
  async function recheckAccess() {
    try {
      const [freshProject, freshOrganizations] = await Promise.all([
        project.refetch(),
        organizations.refetch(),
      ]);
      if (
        !origin ||
        !scopeNow.current.open ||
        !scopeNow.current.editorReady ||
        scopeNow.current.userId !== origin.clerkActorId ||
        freshProject.error ||
        freshProject.isFetching ||
        freshProject.isPaused ||
        freshProject.data?.id !== projectId ||
        freshProject.data.organizationId !== origin.organizationId ||
        freshOrganizations.error ||
        freshOrganizations.isFetching ||
        freshOrganizations.isPaused ||
        !freshOrganizations.data?.some(
          (row) =>
            row.id === origin.organizationId &&
            row.seatType === "FULL" &&
            ["OWNER", "ADMIN", "EDITOR"].includes(row.role),
        )
      )
        return;
      setAccessRejected(false);
    } catch {
      /* Retain the refusal and exact unknown request. */
    }
  }
  return (
    <>
      <button
        type="button"
        className="btn-secondary"
        onClick={() => setOpen(true)}
      >
        Restore procedures from JSON
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Restore reviewed case procedures"
        size="wide"
        dismissible={!busy}
      >
        <p>
          Same-project version 1 snapshots only. Existing IDs stay stable. This
          does not create missing cases or restore a full backup.
        </p>
        {!privateReady ? (
          <div role="alert">
            <p>
              {paused
                ? "Waiting for a connection to verify current access."
                : "Current actor, membership and original project organization must be verified before showing retained procedure fields."}{" "}
              File contents, review choices and any exact unconfirmed request
              remain retained without rebasing.
            </p>
            {accessReady && !editorReady && (
              <p>
                Your current seat is read-only. A full editor is required to
                reveal or restore this reviewed procedure comparison.
              </p>
            )}
            <button
              type="button"
              className="btn-secondary"
              onClick={() => void recheckAccess()}
            >
              Recheck restoration access
            </button>
          </div>
        ) : (
          <>
            {!editorReady && (
              <p>
                Read-only for your current seat. A current full editor is
                required to compare or restore procedures.
              </p>
            )}
            {notice && <p role="alert">{notice}</p>}
            {resultReady && result ? (
              <div role="status">
                <p>
                  Confirmed {result.restored.length} restored cases
                  {result.replayed ? " from the prior request" : ""}.
                </p>
                <ul>
                  {result.restored.map((r) => (
                    <li key={r.caseId}>{r.displayId}</li>
                  ))}
                </ul>
                <p>{result.freshnessNotice}</p>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={restart}
                >
                  Review another snapshot
                </button>
              </div>
            ) : (
              <>
                {!previewReady && (
                  <>
                    <label>
                      Procedure JSON file
                      <input
                        type="file"
                        accept="application/json,.json"
                        disabled={!editorReady || busy || Boolean(pending)}
                        onChange={(event) =>
                          void chooseFile(event.target.files?.[0])
                        }
                      />
                    </label>
                    <p className="text-muted">
                      Up to 50 cases, 2 MiB, 500 steps/BDD lines per case and
                      500 media/prerequisite references. No attachment files are
                      fetched.
                    </p>
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={!editorReady || busy || !serialized}
                      onClick={() => void review()}
                    >
                      {previewMutation.isPending
                        ? "Comparing…"
                        : "Compare with current cases"}
                    </button>
                  </>
                )}
                {previewReady && preview && (
                  <>
                    <div role="status">
                      {
                        preview.entries.filter((e) => e.status === "CONFLICT")
                          .length
                      }{" "}
                      conflicts ·{" "}
                      {
                        preview.entries.filter((e) => e.status === "UNCHANGED")
                          .length
                      }{" "}
                      unchanged ·{" "}
                      {
                        preview.entries.filter(
                          (e) =>
                            e.status === "UNAVAILABLE" ||
                            e.status === "NEW_UNAVAILABLE",
                        ).length
                      }{" "}
                      unavailable
                    </div>
                    <details>
                      <summary>What is preserved</summary>
                      {preview.warnings.map((text) => (
                        <p key={text}>{text}</p>
                      ))}
                    </details>
                    {preview.entries
                      .slice(page * 10, page * 10 + 10)
                      .map((entry) => (
                        <section
                          key={entry.caseId}
                          style={{
                            marginBlock: 16,
                            borderTop: "1px solid var(--border)",
                            paddingTop: 12,
                          }}
                        >
                          <h3 style={{ overflowWrap: "anywhere" }}>
                            {entry.displayId}: {entry.title}
                          </h3>
                          <p>
                            {entry.status === "NEW_UNAVAILABLE"
                              ? "Original identity unavailable; not recreated"
                              : entry.status === "CONFLICT"
                                ? "Conflicting snapshot and current content"
                                : entry.status === "UNCHANGED"
                                  ? "Unchanged; no write needed"
                                  : "Unavailable; no write allowed"}
                          </p>
                          {entry.warnings.map((text) => (
                            <p key={text} className="text-muted">
                              {text}
                            </p>
                          ))}
                          {entry.missingRelationships.map((text) => (
                            <p key={text} role="status">
                              {text}
                            </p>
                          ))}
                          {entry.fields.length > 0 && (
                            <details>
                              <summary>
                                Compare {entry.fields.length} supported field
                                changes
                              </summary>
                              {entry.fields.map((field) => (
                                <div
                                  key={field.label}
                                  style={{ marginBlock: 12 }}
                                >
                                  <h4>
                                    {inspectorLabel(
                                      field.label.replace(/([A-Z])/g, " $1"),
                                    )}
                                  </h4>
                                  <div
                                    style={{
                                      display: "grid",
                                      gridTemplateColumns:
                                        "repeat(auto-fit, minmax(min(260px, 100%), 1fr))",
                                      gap: 12,
                                    }}
                                  >
                                    <div style={{ minWidth: 0 }}>
                                      <strong>Current</strong>
                                      <ProcedureValue
                                        label={field.label}
                                        value={field.current}
                                      />
                                    </div>
                                    <div style={{ minWidth: 0 }}>
                                      <strong>Snapshot</strong>
                                      <ProcedureValue
                                        label={field.label}
                                        value={field.incoming}
                                      />
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </details>
                          )}
                          {entry.status === "CONFLICT" && (
                            <>
                              <label>
                                <input
                                  type="checkbox"
                                  disabled={busy || Boolean(pending)}
                                  checked={selected.includes(entry.caseId)}
                                  onChange={(event) => {
                                    setConfirmed(false);
                                    setSelected((ids) =>
                                      event.target.checked
                                        ? [...ids, entry.caseId]
                                        : ids.filter(
                                            (id) => id !== entry.caseId,
                                          ),
                                    );
                                  }}
                                />{" "}
                                Replace this case&apos;s supported procedure
                                fields after my review
                              </label>
                              {selected.includes(entry.caseId) && (
                                <label
                                  style={{ display: "block", marginTop: 8 }}
                                >
                                  Reason for replacing current content
                                  (required)
                                  <textarea
                                    style={{
                                      display: "block",
                                      width: "100%",
                                      minWidth: 0,
                                      boxSizing: "border-box",
                                    }}
                                    disabled={busy || Boolean(pending)}
                                    value={reasons[entry.caseId] ?? ""}
                                    maxLength={1000}
                                    onChange={(event) => {
                                      setConfirmed(false);
                                      setReasons((r) => ({
                                        ...r,
                                        [entry.caseId]: event.target.value,
                                      }));
                                    }}
                                  />
                                </label>
                              )}
                            </>
                          )}
                        </section>
                      ))}
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      <button
                        type="button"
                        className="btn-secondary"
                        disabled={page === 0}
                        onClick={() => setPage((p) => p - 1)}
                      >
                        Previous
                      </button>
                      <span>
                        Page {page + 1} of{" "}
                        {Math.ceil(preview.entries.length / 10)}
                      </span>
                      <button
                        type="button"
                        className="btn-secondary"
                        disabled={(page + 1) * 10 >= preview.entries.length}
                        onClick={() => setPage((p) => p + 1)}
                      >
                        Next
                      </button>
                    </div>
                    <p>
                      {selected.length} cases selected. All current records
                      absent from this file stay untouched.
                    </p>
                    {!pending && (
                      <label style={{ display: "block", marginBlock: 12 }}>
                        <input
                          type="checkbox"
                          checked={confirmed}
                          disabled={busy}
                          onChange={(event) =>
                            setConfirmed(event.target.checked)
                          }
                        />{" "}
                        I reviewed the selected conflicts and approve replacing
                        only their supported procedure fields. Prior approvals
                        and derived outputs are not recertified.
                      </label>
                    )}
                    {pending?.uncertain && (
                      <p role="status">
                        The last response is uncertain. Request{" "}
                        {pending.input.requestId} is retained; retry confirms
                        that exact approval without duplicates. Closing this
                        dialog does not discard it.
                      </p>
                    )}
                    {reviewInvalid && !pending && (
                      <p role="alert">
                        That approval was not accepted. Refresh comparison and
                        explicitly review the current conflicts before a new
                        approval.
                      </p>
                    )}
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      <button
                        type="button"
                        className="btn-secondary"
                        disabled={busy || Boolean(pending)}
                        onClick={() => void review()}
                      >
                        Refresh comparison
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        disabled={busy || Boolean(pending)}
                        onClick={restart}
                      >
                        Back to file
                      </button>
                      <button
                        type="button"
                        className="btn-primary"
                        disabled={
                          !editorReady ||
                          busy ||
                          (!pending && reviewInvalid) ||
                          (!pending &&
                            (!confirmed ||
                              !selected.length ||
                              selected.some((id) => !reasons[id]?.trim())))
                        }
                        onClick={() => void approve()}
                      >
                        {approveMutation.isPending
                          ? "Confirming…"
                          : pending
                            ? "Retry exact approval"
                            : `Restore ${selected.length} reviewed cases`}
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
            {pending && !previewReady && (
              <div role="status">
                <p>
                  An unconfirmed approval is retained with its original actor,
                  organization, reviewed content and UUID.
                </p>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={!editorReady || busy}
                  onClick={() => void approve()}
                >
                  Retry exact approval
                </button>
              </div>
            )}
          </>
        )}
      </Modal>
    </>
  );
}
