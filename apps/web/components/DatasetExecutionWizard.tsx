"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Modal } from "./Modal";
import {
  trpcReact,
  type RouterInputs,
  type RouterOutputs,
} from "@/lib/trpcReact";

type Preview = RouterOutputs["manualExecution"]["previewDatasetExecution"];
type Start = RouterInputs["manualExecution"]["startDatasetExecution"];
type Receipt = RouterOutputs["manualExecution"]["startDatasetExecution"];
const blankContext = () => ({
  configuration: "",
  platform: "",
  build: "",
  hardwareRevision: "",
  firmwareVersion: "",
  rig: "",
  batchOrLot: "",
  environment: "",
  calibrationReference: "",
  protocolReference: "",
});
const labels = {
  configuration: "Configuration / variant",
  platform: "Platform / device",
  build: "Build / revision",
  environment: "Environment",
  hardwareRevision: "Hardware revision",
  firmwareVersion: "Firmware version",
  rig: "Rig / simulator",
  batchOrLot: "Batch / lot",
  calibrationReference: "Calibration reference",
  protocolReference: "Protocol / method reference",
};
const procedureLabels: Record<string, string> = {
  setup: "Setup",
  safety: "Safety",
  instruments: "Instruments",
  acceptanceCriteria: "Acceptance criteria",
};

/** Closing keeps the reviewed baseline and ambiguous retry key in this mount. */
export function DatasetExecutionWizard({
  open,
  onClose,
  projectId,
  testCaseId,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  testCaseId: string;
}) {
  const utils = trpcReact.useUtils();
  const mutation =
    trpcReact.manualExecution.startDatasetExecution.useMutation();
  const [context, setContext] = useState(blankContext);
  const [screen, setScreen] = useState<"context" | "preview" | "review">(
    "context",
  );
  const [preview, setPreview] = useState<Preview | null>(null);
  const [attempt, setAttempt] = useState<Start | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approved, setApproved] = useState(false);
  const [ambiguous, setAmbiguous] = useState(false);
  const [rejected, setRejected] = useState(false);
  const prefix = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (open) heading.current?.focus();
  }, [open, screen, receipt]);
  const locked = busy || Boolean(attempt) || Boolean(receipt);
  async function loadPreview() {
    if (locked) return;
    setBusy(true);
    setError(null);
    try {
      const next = await utils.manualExecution.previewDatasetExecution.fetch(
        {
          projectId,
          testCaseId,
          executionContext: { ...context },
        },
        { staleTime: 0 },
      );
      setPreview(next);
      setApproved(false);
      setScreen("preview");
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Expansion could not be loaded. No run was started.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function start() {
    if (!preview || !approved || busy || receipt || rejected) return;
    const request = attempt ?? {
      projectId,
      testCaseId,
      executionContext: preview.configuration,
      expectedExpansionHash: preview.expansionHash,
      idempotencyKey: crypto.randomUUID(),
    };
    setAttempt(request);
    setBusy(true);
    setError(null);
    try {
      setReceipt(await mutation.mutateAsync(request));
    } catch (e) {
      const code = (e as { data?: { code?: string } }).data?.code;
      const definitive = [
        "BAD_REQUEST",
        "CONFLICT",
        "FORBIDDEN",
        "NOT_FOUND",
        "UNAUTHORIZED",
      ].includes(code ?? "");
      if (definitive && !ambiguous) setRejected(true);
      else setAmbiguous(true);
      setError(
        e instanceof Error
          ? e.message
          : "The batch-start response could not be confirmed. Retry the same request to recover its receipt.",
      );
    } finally {
      setBusy(false);
    }
  }
  function reviewAgain() {
    if (busy || receipt || ambiguous) return;
    setAttempt(null);
    setRejected(false);
    setPreview(null);
    setApproved(false);
    setError(null);
    setScreen("context");
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Run dataset rows"
      size="wide"
      dismissible={!busy}
    >
      {error && (
        <p
          role="alert"
          style={{ color: "var(--ember)", overflowWrap: "anywhere" }}
        >
          {error}
        </p>
      )}
      {receipt ? (
        <section>
          <h3 ref={heading} tabIndex={-1}>
            Row runs ready
          </h3>
          <p role="status">
            {receipt.runs.length} separate manual runs{" "}
            {receipt.recovered ? "recovered" : "created"}. Each retains its
            resolved procedure and independent results.
          </p>
          <ul>
            {receipt.runs.map((row) => (
              <li key={row.testRunId}>
                <a
                  href={`/projects/${projectId}/test-runs/manual/${row.testRunId}`}
                >
                  Open row {row.rowIndex + 1}: {row.rowName}
                </a>
              </li>
            ))}
          </ul>
          <p>
            Changing the dataset does not change these runs. Prerequisites must
            pass again within each row run.
          </p>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setReceipt(null);
              setAttempt(null);
              setPreview(null);
              setApproved(false);
              setAmbiguous(false);
              setRejected(false);
              setScreen("context");
            }}
          >
            Review another batch
          </button>
        </section>
      ) : (
        <>
          <p className="text-muted">
            Step {screen === "context" ? 1 : screen === "preview" ? 2 : 3} of 3
            ·{" "}
            {screen === "context"
              ? "Execution context"
              : screen === "preview"
                ? "Resolved procedures"
                : "Review and start"}
          </p>
          {screen === "context" && (
            <section>
              <h3 ref={heading} tabIndex={-1}>
                What configuration are you testing?
              </h3>
              <p>
                All saved dataset rows use this configuration. You will review
                concrete steps before any runs are created.
              </p>
              {(
                ["configuration", "platform", "build", "environment"] as const
              ).map((key) => (
                <label
                  key={key}
                  htmlFor={`${prefix}-${key}`}
                  style={{ display: "block", marginBottom: 12 }}
                >
                  {labels[key]} <span className="text-muted">(optional)</span>
                  <input
                    id={`${prefix}-${key}`}
                    value={context[key]}
                    maxLength={
                      key === "configuration" || key === "environment"
                        ? 2000
                        : 300
                    }
                    onChange={(event) =>
                      setContext((current) => ({
                        ...current,
                        [key]: event.target.value,
                      }))
                    }
                    style={{ display: "block", width: "100%" }}
                  />
                </label>
              ))}
              <details>
                <summary>Hardware, laboratory and protocol references</summary>
                {(
                  [
                    "hardwareRevision",
                    "firmwareVersion",
                    "rig",
                    "batchOrLot",
                    "calibrationReference",
                    "protocolReference",
                  ] as const
                ).map((key) => (
                  <label
                    key={key}
                    htmlFor={`${prefix}-${key}`}
                    style={{ display: "block", marginBottom: 12 }}
                  >
                    {labels[key]}
                    <input
                      id={`${prefix}-${key}`}
                      value={context[key]}
                      maxLength={300}
                      onChange={(event) =>
                        setContext((current) => ({
                          ...current,
                          [key]: event.target.value,
                        }))
                      }
                      style={{ display: "block", width: "100%" }}
                    />
                  </label>
                ))}
              </details>
              <p className="text-muted">
                Up to 50 rows and 500 planned case instances per batch.
                References are context, not a safety or regulatory
                certification.
              </p>
            </section>
          )}
          {screen === "preview" && preview && (
            <section>
              <h3 ref={heading} tabIndex={-1}>
                Review {preview.displayId}: {preview.rowCount} resolved rows
              </h3>
              <p>
                {preview.prerequisiteCount} prerequisite{" "}
                {preview.prerequisiteCount === 1 ? "case" : "cases"} included in
                every row run. {preview.plannedCaseInstances} planned case
                instances total.
              </p>
              {preview.rows.map((row) => (
                <details
                  key={row.rowIndex}
                  style={{
                    border: "1px solid var(--line)",
                    padding: 12,
                    marginBottom: 8,
                  }}
                >
                  <summary>
                    Row {row.rowIndex + 1}: {row.rowName}
                  </summary>
                  <dl>
                    {Object.entries(row.values).map(([key, value]) => (
                      <div key={key} style={{ overflowWrap: "anywhere" }}>
                        <dt>{key}</dt>
                        <dd style={{ marginLeft: 0, whiteSpace: "pre-wrap" }}>
                          {value || "(empty text)"}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  {row.caseDefinitions.map((definition) => (
                    <section
                      key={definition.testCaseId}
                      style={{ marginBottom: 16 }}
                    >
                      <h4>
                        {definition.title}
                        {definition.testCaseId === testCaseId
                          ? ""
                          : " · prerequisite"}
                      </h4>
                      {definition.background && (
                        <p style={{ whiteSpace: "pre-wrap" }}>
                          Preconditions / setup: {definition.background}
                        </p>
                      )}
                      {(["given", "when", "then"] as const).map((phase) =>
                        definition[phase].length ? (
                          <div key={phase}>
                            <strong>
                              {phase[0]!.toUpperCase() + phase.slice(1)}
                            </strong>
                            <ol>
                              {definition[phase].map((line, index) => (
                                <li
                                  key={index}
                                  style={{
                                    whiteSpace: "pre-wrap",
                                    overflowWrap: "anywhere",
                                  }}
                                >
                                  {line}
                                </li>
                              ))}
                            </ol>
                          </div>
                        ) : null,
                      )}
                      {definition.steps.length > 0 && (
                        <div style={{ overflowX: "auto" }}>
                          <table style={{ width: "100%" }}>
                            <thead>
                              <tr>
                                <th>Step</th>
                                <th>Action</th>
                                <th>Input / data</th>
                                <th>Expected result</th>
                                <th>Expected response</th>
                              </tr>
                            </thead>
                            <tbody>
                              {definition.steps.map((step, index) => (
                                <tr key={index}>
                                  <td>{index + 1}</td>
                                  {[
                                    step.action,
                                    step.expectedActionOrData,
                                    step.expectedResult,
                                    step.expectedResponse,
                                  ].map((text, column) => (
                                    <td
                                      key={column}
                                      style={{
                                        whiteSpace: "pre-wrap",
                                        overflowWrap: "anywhere",
                                      }}
                                    >
                                      {text ?? "—"}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                      {Object.entries(definition.verificationProfile)
                        .filter(([, text]) => text)
                        .map(([key, text]) => (
                          <p key={key} style={{ whiteSpace: "pre-wrap" }}>
                            <strong>{procedureLabels[key] ?? key}: </strong>
                            {text}
                          </p>
                        ))}
                    </section>
                  ))}
                </details>
              ))}
            </section>
          )}
          {screen === "review" && preview && (
            <section>
              <h3 ref={heading} tabIndex={-1}>
                Create {preview.rowCount} independent row runs?
              </h3>
              <p>
                {preview.displayId} · {preview.plannedCaseInstances} planned
                case instances, including prerequisites.
              </p>
              <dl>
                {Object.entries(preview.configuration)
                  .filter(([, value]) => value)
                  .map(([key, value]) => (
                    <div key={key}>
                      <dt>{labels[key as keyof typeof labels]}</dt>
                      <dd
                        style={{
                          marginLeft: 0,
                          whiteSpace: "pre-wrap",
                          overflowWrap: "anywhere",
                        }}
                      >
                        {value}
                      </dd>
                    </div>
                  ))}
              </dl>
              <p>
                Cost: <strong>0 AI credits</strong>. No AI, source fetch,
                imported-code execution or automatic test execution is used.
                This creates manual run records only.
              </p>
              <p>
                Each row is a separate run, not multiple instances inside one
                legacy run. A prerequisite pass in another row or configuration
                never unlocks this row. Procedures and parameter values are
                saved at start.
              </p>
              <label
                style={{ display: "flex", gap: 8, alignItems: "flex-start" }}
              >
                <input
                  type="checkbox"
                  checked={approved}
                  disabled={locked}
                  onChange={(event) => setApproved(event.target.checked)}
                />{" "}
                I reviewed the resolved procedures and approve creating these
                row runs.
              </label>
              {ambiguous && (
                <p role="status">
                  The previous response is unconfirmed. Retry uses the same
                  durable key and does not intentionally create another batch.
                </p>
              )}
              {rejected && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={reviewAgain}
                >
                  Refresh and review again
                </button>
              )}
            </section>
          )}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              justifyContent: "space-between",
              marginTop: 20,
            }}
          >
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              onClick={onClose}
            >
              Close
            </button>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {screen !== "context" && (
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={locked}
                  onClick={() =>
                    setScreen(screen === "review" ? "preview" : "context")
                  }
                >
                  Back
                </button>
              )}
              {screen === "context" && (
                <button
                  type="button"
                  className="btn-primary"
                  disabled={busy}
                  onClick={() => void loadPreview()}
                >
                  {busy ? "Resolving rows…" : "Preview rows"}
                </button>
              )}
              {screen === "preview" && (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => setScreen("review")}
                >
                  Continue to review
                </button>
              )}
              {screen === "review" && (
                <button
                  type="button"
                  className="btn-primary"
                  disabled={!approved || busy || rejected}
                  onClick={() => void start()}
                >
                  {busy
                    ? "Confirming batch…"
                    : attempt
                      ? "Retry same batch"
                      : "Create row runs"}
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}
