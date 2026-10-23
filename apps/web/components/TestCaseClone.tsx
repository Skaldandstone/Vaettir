"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  trpcReact,
  type RouterInputs,
  type RouterOutputs,
} from "@/lib/trpcReact";
import {
  retainedTraceabilityReceipt,
  type TraceabilityReceipt,
} from "@/lib/traceability-receipt";
import { inspectorLabel } from "@/lib/case-inspector";
import { Modal } from "./Modal";
import { CaseProcedureColumns } from "./CaseProcedureColumns";
import { useFolderActionScope } from "@/lib/use-folder-action-scope";
import { verifiedIndependentCloneAck } from "@/lib/case-clone-dataset-ack";
type Preview = RouterOutputs["caseClone"]["preview"];
type Request = RouterInputs["caseClone"]["create"];
type CloneProps = { projectId: string; caseId: string; onChanged?: () => void };
export function TestCaseClone(props: CloneProps) {
  return (
    <CaseCloneWorkflow key={`${props.projectId}:${props.caseId}`} {...props} />
  );
}
function CaseCloneWorkflow({ projectId, caseId, onChanged }: CloneProps) {
  const utils = trpcReact.useUtils();
  const [open, setOpen] = useState(false),
    [baseline, setBaseline] = useState<Preview | null>(null);
  const [title, setTitle] = useState(""),
    [suite, setSuite] = useState(""),
    [reason, setReason] = useState(""),
    [confirmed, setConfirmed] = useState(false);
  const [copyParameterDataset, setCopyParameterDataset] = useState(false),
    [draftSeeded, setDraftSeeded] = useState(false),
    [accessFresh, setAccessFresh] = useState(false),
    [accessGeneration, setAccessGeneration] = useState(-1);
  const [pending, setPending] = useState<TraceabilityReceipt<Request> | null>(
    null,
  );
  const [created, setCreated] = useState<
      RouterOutputs["caseClone"]["create"] | null
    >(null),
    [notice, setNotice] = useState<string | null>(null);
  const scope = useFolderActionScope(projectId, open || !!pending || !!created);
  const scopeRefresh = useRef(scope.refresh);
  useLayoutEffect(() => {
    scopeRefresh.current = scope.refresh;
    return () => { scopeRefresh.current = () => Promise.resolve(); };
  }, [scope.refresh]);
  const exactAttempt = useRef<TraceabilityReceipt<Request> | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    setAccessFresh(false);
    if (open && scope.actorReady && !scope.changed)
      void scopeRefresh.current().then(() => {
        if (
          active &&
          scope.live.current.ready &&
          scope.live.current.generation === scope.generation
        ) {
          setAccessFresh(true);
          setAccessGeneration(scope.generation);
        }
      });
    return () => {
      active = false;
    };
  }, [open, scope.actorReady, scope.changed, scope.generation]);
  const membership = trpcReact.organization.mine.useQuery(undefined, {
    enabled: open && scope.actorReady,
    staleTime: 0,
    retry: false,
  });
  const currentMember =
    !membership.error && !membership.isFetching && !membership.isPaused
      ? membership.data?.find((org) => org.id === scope.origin?.organizationId)
      : undefined;
  const editorSeat =
    currentMember?.seatType === "FULL" &&
    ["OWNER", "ADMIN", "EDITOR"].includes(currentMember.role);
  const currentAccess =
    scope.ready &&
    accessFresh &&
    accessGeneration === scope.generation &&
    editorSeat;
  const preview = trpcReact.caseClone.preview.useQuery(
    {
      projectId,
      caseId,
      ...(scope.origin
        ? {
            expectedScope: {
              organizationId: scope.origin.organizationId,
              clerkActorId: scope.origin.clerkActorId,
            },
          }
        : {}),
      ...(copyParameterDataset ? { copyParameterDataset: true as const } : {}),
    },
    {
      enabled: open && !baseline && !pending && !created && currentAccess,
      retry: false,
      staleTime: 0,
      refetchOnWindowFocus: false,
    },
  );
  const create = trpcReact.caseClone.create.useMutation();
  const previewScope = preview.data
    ? {
        projectId: preview.data.projectId ?? "",
        organizationId: preview.data.organizationId ?? "",
        clerkActorId: preview.data.clerkActorId ?? "",
      }
    : null;
  const fresh =
    !preview.error &&
    !preview.isFetching &&
    !preview.isPaused &&
    preview.data?.sourceId === caseId &&
    currentAccess &&
    scope.matches(previewScope) &&
    preview.data.copyParameterDataset === copyParameterDataset
      ? preview.data
      : null;
  useEffect(() => {
    if (open && !baseline && !pending && !created && fresh) {
      setBaseline(fresh);
      if (!draftSeeded) {
        setTitle(fresh.suggestedTitle);
        setSuite(fresh.suitePath ?? "");
        setDraftSeeded(true);
      }
    }
  }, [open, baseline, pending, created, fresh, draftSeeded]);
  function show() {
    if (!pending && !created) {
      setBaseline(null);
      setConfirmed(false);
      setNotice(null);
    }
    setAccessFresh(false);
    setOpen(true);
  }
  async function duplicate() {
    if (
      create.isPending ||
      (exactAttempt.current && !pending) ||
      !baseline ||
      !currentAccess ||
      !scope.origin
    )
      return;
    if (!pending && (!confirmed || !title.trim() || !reason.trim())) return;
    const attempt = pending ?? {
      input: {
        projectId,
        caseId,
        expectedSourceRevision: baseline.expectedSourceRevision,
        title: title.trim(),
        suitePath: suite.trim() || null,
        reason: reason.trim(),
        confirmed: true as const,
        requestId: crypto.randomUUID(),
        expectedScope: {
          organizationId: scope.origin.organizationId,
          clerkActorId: scope.origin.clerkActorId,
        },
        ...(copyParameterDataset
          ? {
              copyParameterDataset: true as const,
              expectedDatasetHash: baseline.datasetReviewHash,
              expectedDataset: baseline.datasetSource,
            }
          : {}),
      },
      uncertain: false,
    };
    // An uncertain request is immutable, including actor/org and dataset mode.
    if (
      attempt.input.expectedScope &&
      (attempt.input.expectedScope.organizationId !==
        scope.origin.organizationId ||
        attempt.input.expectedScope.clerkActorId !== scope.origin.clerkActorId)
    )
      return;
    exactAttempt.current = attempt;
    setPending(attempt);
    setNotice(null);
    try {
      const result = await create.mutateAsync(attempt.input);
      if (!mounted.current || exactAttempt.current?.input !== attempt.input)
        return;
      const verified = await verifiedIndependentCloneAck(attempt.input, result);
      if (!mounted.current) return;
      if (!verified || exactAttempt.current?.input !== attempt.input) {
        const uncertain = { ...attempt, uncertain: true };
        exactAttempt.current = uncertain;
        setPending(uncertain);
        setNotice(
          "The duplicate receipt could not be verified. The exact reviewed request is retained; do not create another duplicate.",
        );
        return;
      }
      exactAttempt.current = null;
      setPending(null);
      setCreated(result);
      setNotice(
        `Created ${result.displayId}${result.replayed ? " (confirmed prior request)" : ""}. The new case needs its own review; the original is unchanged.`,
      );
      const live = scope.live.current;
      if (
        live.ready &&
        live.origin &&
        attempt.input.expectedScope &&
        live.origin.organizationId ===
          attempt.input.expectedScope.organizationId &&
        live.origin.clerkActorId === attempt.input.expectedScope.clerkActorId
      ) {
        try {
          onChanged?.();
        } catch {
          setNotice(
            `Created ${result.displayId}. The current inspector could not refresh; the accepted duplicate was not retried.`,
          );
        }
        void Promise.resolve()
          .then(() =>
            Promise.all([
              utils.testCases.list.invalidate({ projectId }),
              utils.testCaseStructure.list.invalidate({ projectId }),
            ]),
          )
          .catch(() => {
            if (mounted.current)
              setNotice(
                `Created ${result.displayId}. Current lists could not refresh; the accepted duplicate was not retried.`,
              );
          });
      }
    } catch (error) {
      if (!mounted.current || exactAttempt.current?.input !== attempt.input)
        return;
      const retained = retainedTraceabilityReceipt(attempt, error);
      exactAttempt.current = retained;
      setPending(retained);
      setNotice(
        retained
          ? "The response is uncertain. Retry this exact reviewed request to confirm the duplicate, not to create another copy."
          : "No duplicate was confirmed. Refresh the preview if the source changed, then review again.",
      );
    }
  }
  return (
    <>
      <button type="button" className="btn-secondary" onClick={show}>
        Duplicate case
      </button>
      <Modal
        size="wide"
        open={open}
        onClose={() => setOpen(false)}
        title="Duplicate case"
        dismissible={!create.isPending}
      >
        {currentAccess && notice && <p role="status">{notice}</p>}
        {!currentAccess ? (
          <div role={scope.changed || scope.signedOut ? "alert" : "status"}>
            <p>
              {scope.changed || scope.signedOut
                ? "Original case data, draft controls and results are hidden after an account or workspace change. The exact request and human draft remain retained."
                : currentMember && !editorSeat
                  ? "A current full Editor seat is required. Human input and exact pending requests are preserved."
                  : "Checking current project access. Cached or offline data cannot authorize duplication."}
            </p>
            <button
              type="button"
              disabled={!scope.actorReady || scope.changed}
              onClick={() => {
                setAccessFresh(false);
                void scope.refresh().then(() => {
                  if (scope.live.current.ready) {
                    setAccessFresh(true);
                    setAccessGeneration(scope.live.current.generation);
                  }
                });
              }}
            >
              Retry current access
            </button>
          </div>
        ) : created ? (
          <>
            <p>Approvals, results and paid drafts were not copied.</p>
            {created.copiedDataset && (
              <section aria-label="Historical copied dataset mapping">
                <p>
                  Fresh dataset {created.copiedDataset.datasetId}; rows are
                  identified by this dataset ID plus zero-based row index. This
                  historical receipt does not certify later values or
                  executions.
                </p>
                <ol>
                  {created.copiedDataset.rows.map((r) => (
                    <li key={r.rowIndex}>
                      {r.name} (index {r.rowIndex})
                    </li>
                  ))}
                </ol>
              </section>
            )}
            <a
              className="btn-primary"
              href={`/projects/${projectId}/test-cases/${created.caseId}`}
            >
              Open {created.displayId}
            </a>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setOpen(false)}
            >
              Close
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setCreated(null);
                setBaseline(null);
                setReason("");
                setConfirmed(false);
                setNotice(null);
                setDraftSeeded(false);
                setCopyParameterDataset(false);
              }}
            >
              Review another duplicate
            </button>
          </>
        ) : (
          <>
            <label style={{ display: "flex", gap: 8 }}>
              <input
                type="checkbox"
                checked={copyParameterDataset}
                disabled={create.isPending || !!pending}
                onChange={(event) => {
                  setCopyParameterDataset(event.target.checked);
                  setBaseline(null);
                  setConfirmed(false);
                  setNotice(null);
                }}
              />
              Include parameter dataset (optional). Review every supported
              parameter and row; prerequisite relationships, libraries or media
              block this independent dataset copy rather than being dropped.
            </label>
            {!baseline && preview.isFetching && (
              <p role="status">Loading duplicate preview…</p>
            )}
            {!baseline && preview.isPaused && (
              <p role="status">
                Waiting for a connection. A current preview is required before
                duplication.
              </p>
            )}
            {!baseline && preview.error && (
              <div role="alert">
                <p>
                  Duplicate preview could not be loaded. {preview.error.message}
                </p>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => void preview.refetch()}
                >
                  Retry preview
                </button>
              </div>
            )}
            {baseline && (
              <>
                <p>
                  Copy <strong>{baseline.sourceDisplayId}</strong> into a new
                  case in this project. No credits are used.
                </p>
                {baseline.datasetAvailable === false && (
                  <p>No saved parameter dataset is present on this case.</p>
                )}
                {baseline.copyParameterDataset && baseline.dataset && (
                  <section aria-label="Complete independent dataset review">
                    <h3>Parameter dataset</h3>
                    <p>
                      Exact names, ordered rows and concrete string values are
                      copied. Fresh row identity is (new dataset ID, row index),
                      not a separate persistent row ID. Empty strings and unused
                      declared values remain unchanged; no execution evidence is
                      copied.
                    </p>
                    <div style={{ maxHeight: 360, overflow: "auto" }}>
                      <table>
                        <thead>
                          <tr>
                            <th scope="col">Row</th>
                            {baseline.dataset.parameterNames.map((name) => (
                              <th scope="col" key={name}>
                                {name}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {baseline.dataset.rows.map((row, index) => (
                            <tr key={index}>
                              <th scope="row">
                                {index + 1}. {row.name}
                              </th>
                              {baseline.dataset!.parameterNames.map((name) => (
                                <td
                                  key={name}
                                  style={{
                                    whiteSpace: "pre-wrap",
                                    overflowWrap: "anywhere",
                                  }}
                                >
                                  {row.values[name] === "" ? (
                                    <em>Empty string</em>
                                  ) : (
                                    row.values[name]
                                  )}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}
                <dl style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                  <div>
                    <dt>Type</dt>
                    <dd>{inspectorLabel(baseline.definition.testType)}</dd>
                  </div>
                  <div>
                    <dt>Domain</dt>
                    <dd>
                      {inspectorLabel(baseline.definition.validationDomain)}
                    </dd>
                  </div>
                  <div>
                    <dt>Priority</dt>
                    <dd>{inspectorLabel(baseline.definition.priority)}</dd>
                  </div>
                </dl>
                <details>
                  <summary>Verification context and tags</summary>
                  <p>
                    Tags:{" "}
                    {baseline.definition.tags.length
                      ? baseline.definition.tags.join(", ")
                      : "None"}
                  </p>
                  {baseline.definition.verificationProfile &&
                    typeof baseline.definition.verificationProfile ===
                      "object" &&
                    !Array.isArray(baseline.definition.verificationProfile) && (
                      <dl>
                        {Object.entries(
                          baseline.definition.verificationProfile,
                        ).map(([key, value]) => (
                          <div key={key}>
                            <dt>
                              {inspectorLabel(
                                key.replace(/([a-z])([A-Z])/g, "$1 $2"),
                              )}
                            </dt>
                            <dd
                              style={{
                                whiteSpace: "pre-wrap",
                                overflowWrap: "anywhere",
                              }}
                            >
                              {String(value) || "Not recorded"}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    )}
                </details>
                <details>
                  <summary>Review the procedure being copied</summary>
                  {baseline.definition.background && (
                    <p
                      style={{
                        whiteSpace: "pre-wrap",
                        overflowWrap: "anywhere",
                      }}
                    >
                      {baseline.definition.background}
                    </p>
                  )}
                  {(["given", "when", "then"] as const).map((phase) => (
                    <section key={phase}>
                      <h4>{inspectorLabel(phase)}</h4>
                      <ol>
                        {baseline.definition[phase].map((line, i) => (
                          <li
                            key={i}
                            style={{
                              whiteSpace: "pre-wrap",
                              overflowWrap: "anywhere",
                            }}
                          >
                            {line}
                          </li>
                        ))}
                      </ol>
                    </section>
                  ))}
                  <CaseProcedureColumns steps={baseline.definition.steps} />
                </details>
                <div role="note">
                  <ul>
                    {baseline.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </div>
                <fieldset
                  disabled={create.isPending || Boolean(pending)}
                  style={{
                    border: 0,
                    padding: 0,
                    minWidth: 0,
                    display: "grid",
                    gap: 12,
                  }}
                >
                  <legend>Review the new case</legend>
                  <label style={{ display: "grid", gap: 6 }}>
                    New title (required)
                    <input
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                      maxLength={10000}
                    />
                  </label>
                  <label style={{ display: "grid", gap: 6 }}>
                    Suite (optional)
                    <input
                      value={suite}
                      onChange={(event) => setSuite(event.target.value)}
                      maxLength={240}
                      placeholder="Unassigned"
                    />
                  </label>
                  <label style={{ display: "grid", gap: 6 }}>
                    Reason (required)
                    <textarea
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      maxLength={1000}
                      rows={2}
                    />
                  </label>
                  <label
                    style={{ display: "flex", gap: 8, alignItems: "start" }}
                  >
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={(event) => setConfirmed(event.target.checked)}
                    />
                    I reviewed the copied definition, every included dataset
                    parameter and row, and excluded records. Create a new case
                    that needs its own review.
                  </label>
                </fieldset>
                {create.error && <p role="alert">{create.error.message}</p>}
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    flexWrap: "wrap",
                    marginTop: 12,
                  }}
                >
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={create.isPending || Boolean(pending)}
                    onClick={() => {
                      setBaseline(null);
                      setConfirmed(false);
                      setNotice(null);
                      void preview.refetch();
                    }}
                  >
                    Refresh preview
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={
                      create.isPending ||
                      !currentAccess ||
                      (!pending &&
                        (!confirmed || !title.trim() || !reason.trim()))
                    }
                    onClick={() => void duplicate()}
                  >
                    {create.isPending
                      ? "Duplicating…"
                      : pending
                        ? "Retry reviewed duplicate"
                        : "Create duplicate"}
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </Modal>
    </>
  );
}
