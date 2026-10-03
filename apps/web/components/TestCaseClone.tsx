"use client";
import { useEffect, useState } from "react";
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
  const [pending, setPending] = useState<TraceabilityReceipt<Request> | null>(
    null,
  );
  const [created, setCreated] = useState<
      RouterOutputs["caseClone"]["create"] | null
    >(null),
    [notice, setNotice] = useState<string | null>(null);
  const preview = trpcReact.caseClone.preview.useQuery(
    { projectId, caseId },
    {
      enabled: open && !baseline && !pending && !created,
      retry: false,
      staleTime: 0,
      refetchOnWindowFocus: false,
    },
  );
  const create = trpcReact.caseClone.create.useMutation();
  const fresh =
    !preview.error &&
    !preview.isFetching &&
    !preview.isPaused &&
    preview.data?.sourceId === caseId
      ? preview.data
      : null;
  useEffect(() => {
    if (open && !baseline && !pending && !created && fresh) {
      setBaseline(fresh);
      setTitle(fresh.suggestedTitle);
      setSuite(fresh.suitePath ?? "");
    }
  }, [open, baseline, pending, created, fresh]);
  function show() {
    if (!pending && !created) {
      setBaseline(null);
      setReason("");
      setConfirmed(false);
      setNotice(null);
    }
    setOpen(true);
  }
  async function duplicate() {
    if (create.isPending || !baseline) return;
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
      },
      uncertain: false,
    };
    setPending(attempt);
    setNotice(null);
    try {
      const result = await create.mutateAsync(attempt.input);
      setPending(null);
      setCreated(result);
      setNotice(
        `Created ${result.displayId}${result.replayed ? " (confirmed prior request)" : ""}. The new case needs its own review; the original is unchanged.`,
      );
      void utils.testCases.list.invalidate({ projectId });
      void utils.testCaseStructure.list.invalidate({ projectId });
      onChanged?.();
    } catch (error) {
      const retained = retainedTraceabilityReceipt(attempt, error);
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
        {notice && <p role="status">{notice}</p>}
        {created ? (
          <>
            <p>Approvals, results and paid drafts were not copied.</p>
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
              }}
            >
              Review another duplicate
            </button>
          </>
        ) : (
          <>
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
                  <ol>
                    {baseline.definition.steps.map((step) => (
                      <li
                        key={step.order}
                        style={{ overflowWrap: "anywhere", marginBottom: 10 }}
                      >
                        <strong>Action</strong>
                        <p style={{ whiteSpace: "pre-wrap" }}>{step.action}</p>
                        <dl>
                          {(
                            [
                              "expectedActionOrData",
                              "expectedResult",
                              "expectedResponse",
                            ] as const
                          ).map((key) => (
                            <div key={key}>
                              <dt>
                                {key === "expectedActionOrData"
                                  ? "Expected action / data"
                                  : key === "expectedResult"
                                    ? "Expected result"
                                    : "Expected response"}
                              </dt>
                              <dd style={{ whiteSpace: "pre-wrap" }}>
                                {step[key] ?? "Not recorded"}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </li>
                    ))}
                  </ol>
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
                    I reviewed the copied definition and excluded records.
                    Create a new case that needs its own review.
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
