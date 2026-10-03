"use client";

import { useState } from "react";
import { Modal } from "./Modal";
import {
  trpcReact,
  type RouterInputs,
  type RouterOutputs,
} from "@/lib/trpcReact";

type Preview = RouterOutputs["manualRetest"]["preview"];
type Start = RouterInputs["manualRetest"]["start"];
const link = (projectId: string, runId: string) =>
  `/projects/${encodeURIComponent(projectId)}/test-runs/manual/${encodeURIComponent(runId)}`;
const labels: Record<string, string> = {
  configuration: "Configuration / variant",
  platform: "Platform / device",
  build: "Build / revision",
  environment: "Environment",
  hardwareRevision: "Hardware revision",
  firmwareVersion: "Firmware version",
  rig: "Rig",
  batchOrLot: "Batch / lot",
  calibrationReference: "Calibration reference",
  protocolReference: "Protocol reference",
  setup: "Setup",
  safety: "Safety",
  instruments: "Instruments",
  acceptanceCriteria: "Acceptance criteria",
};

export function ManualRetestWizard({
  projectId,
  sourceRunId,
  testCaseId,
  open,
  onClose,
}: {
  projectId: string;
  sourceRunId: string;
  testCaseId: string;
  open: boolean;
  onClose: () => void;
}) {
  const utils = trpcReact.useUtils();
  const mutation = trpcReact.manualRetest.start.useMutation();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [attempt, setAttempt] = useState<Start | null>(null);
  const [receipt, setReceipt] = useState<
    RouterOutputs["manualRetest"]["start"] | null
  >(null);
  const [busy, setBusy] = useState(false),
    [approved, setApproved] = useState(false);
  const [error, setError] = useState<string | null>(null),
    [ambiguous, setAmbiguous] = useState(false),
    [rejected, setRejected] = useState(false);
  async function review() {
    if (busy || attempt || receipt) return;
    setBusy(true);
    setError(null);
    try {
      setPreview(
        await utils.manualRetest.preview.fetch(
          { projectId, sourceRunId, testCaseId },
          { staleTime: 0 },
        ),
      );
      setApproved(false);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Original evidence could not be reviewed. Nothing was started.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function start() {
    if (!preview || !approved || busy || receipt || rejected) return;
    const request = attempt ?? {
      projectId,
      sourceRunId,
      testCaseId,
      expectedReviewHash: preview.reviewHash,
      idempotencyKey: crypto.randomUUID(),
    };
    setAttempt(request);
    setBusy(true);
    setError(null);
    try {
      setReceipt(await mutation.mutateAsync(request));
      void utils.manualRetest.links.invalidate({
        projectId,
        sourceRunId,
        testCaseId,
      });
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
          : "The retest response is unknown. Retry this same request to recover its receipt.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Retest this execution"
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
          <h3>Separate retest ready</h3>
          <p role="status">
            {receipt.recovered
              ? "Recovered the existing retest"
              : "Created one new retest"}
            . Original evidence is retained. No previous Pass or result was
            copied.
          </p>
          <a className="btn-primary" href={link(projectId, receipt.testRunId)}>
            Open retest run
          </a>
          <p>
            A later Pass is a separate execution, not proof that a linked defect
            was fixed.
          </p>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </section>
      ) : !preview ? (
        <section>
          <h3>Review the original Failed or Blocked result</h3>
          <p>
            This creates a separate manual run using exactly the original frozen
            procedure, configuration and prerequisites. Current case edits are
            not substituted. Prerequisites must pass again in the new run.
          </p>
          <p>No AI credits are used. No test is executed automatically.</p>
          <button
            type="button"
            className="btn-primary"
            disabled={busy}
            onClick={() => void review()}
          >
            {busy ? "Loading original evidence…" : "Review retest"}
          </button>
        </section>
      ) : (
        <section>
          <h3>
            {preview.displayId} · Original{" "}
            {preview.sourceOutcome === "FAIL" ? "Failed" : "Blocked"} outcome
          </h3>
          <p>
            {preview.caseDefinitions.length} case
            {preview.caseDefinitions.length === 1 ? "" : "s"}, including{" "}
            {preview.prerequisiteCount} prerequisite
            {preview.prerequisiteCount === 1 ? "" : "s"}. One separate run · 0
            AI credits.
          </p>
          <a href={link(projectId, sourceRunId)}>Open original execution</a>
          <h4>Exact original configuration</h4>
          <dl>
            {Object.entries(preview.configuration)
              .filter(([, v]) => v)
              .map(([key, value]) => (
                <div key={key}>
                  <dt>{labels[key] ?? key}</dt>
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
          {!Object.values(preview.configuration).some(Boolean) && (
            <p className="text-muted">
              No configuration values were recorded. Nothing has been inferred.
            </p>
          )}
          {preview.sourceDatasetExecution && (
            <p>
              Original dataset row {preview.sourceDatasetExecution.rowIndex + 1}
              : {preview.sourceDatasetExecution.rowName}. The original resolved
              values are retained, not the current dataset.
            </p>
          )}
          <details>
            <summary>Captured original result evidence</summary>
            {preview.sourceResults.map((result) => (
              <section key={result.id}>
                <strong>
                  {
                    preview.caseDefinitions.find(
                      (c) => c.testCaseId === result.testCaseId,
                    )?.title
                  }{" "}
                  · {result.status}
                </strong>
                {result.note && (
                  <p
                    style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                  >
                    {result.note}
                  </p>
                )}
                {result.errorMessage && (
                  <p
                    style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                  >
                    {result.errorMessage}
                  </p>
                )}
                <pre
                  style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                >
                  {JSON.stringify(result.observations, null, 2)}
                </pre>
              </section>
            ))}
            <p>
              Captured when the retest is approved. Earlier whole-case
              correction history may not have been recorded.
            </p>
          </details>
          {preview.caseDefinitions.map((c) => (
            <details key={c.testCaseId} style={{ marginTop: 12 }}>
              <summary>
                {c.testCaseId === testCaseId
                  ? "Retest procedure"
                  : "Prerequisite procedure"}
                : {c.title}
              </summary>
              {c.background && (
                <p style={{ whiteSpace: "pre-wrap" }}>
                  Preconditions / setup: {c.background}
                </p>
              )}
              {(["given", "when", "then"] as const).map(
                (phase) =>
                  c[phase].length > 0 && (
                    <section key={phase}>
                      <h4>{phase[0]!.toUpperCase() + phase.slice(1)}</h4>
                      <ol>
                        {c[phase].map((text, index) => (
                          <li
                            key={index}
                            style={{
                              whiteSpace: "pre-wrap",
                              overflowWrap: "anywhere",
                            }}
                          >
                            {text}
                          </li>
                        ))}
                      </ol>
                    </section>
                  ),
              )}
              {c.steps.length > 0 && (
                <div style={{ overflowX: "auto", maxWidth: "100%" }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Step</th>
                        <th>Action</th>
                        <th>Expected data</th>
                        <th>Expected result</th>
                        <th>Expected response</th>
                      </tr>
                    </thead>
                    <tbody>
                      {c.steps.map((step, index) => (
                        <tr key={index}>
                          <td>{index + 1}</td>
                          <td>{step.action}</td>
                          <td>{step.expectedActionOrData ?? "—"}</td>
                          <td>{step.expectedResult ?? "—"}</td>
                          <td>{step.expectedResponse ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <dl>
                {Object.entries(c.verificationProfile)
                  .filter(([, v]) => v)
                  .map(([key, value]) => (
                    <div key={key}>
                      <dt>{labels[key]}</dt>
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
            </details>
          ))}
          <label
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              margin: "16px 0",
            }}
          >
            <input
              type="checkbox"
              checked={approved}
              disabled={busy || Boolean(attempt)}
              onChange={(e) => setApproved(e.target.checked)}
            />
            I approve one separate retest with these original instructions and
            configuration. Previous results stay in the original execution.
          </label>
          {ambiguous && (
            <p role="status">
              The previous response was not confirmed. Closing and reopening
              preserves this request in this page; retry it before starting
              anything else. Reloading the page does not preserve this local
              review.
            </p>
          )}
          <div
            style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}
          >
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              onClick={onClose}
            >
              Close
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={busy || ambiguous || Boolean(attempt && !rejected)}
              onClick={() => {
                setAttempt(null);
                setRejected(false);
                setPreview(null);
                setApproved(false);
                setError(null);
              }}
            >
              Refresh original evidence
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={!approved || busy || rejected}
              onClick={() => void start()}
            >
              {busy
                ? "Starting…"
                : attempt
                  ? "Retry same retest request"
                  : "Create retest run"}
            </button>
          </div>
        </section>
      )}
    </Modal>
  );
}

/** Key this component by project/run/case at mounts to prevent scope carryover. */
export function ManualRetestActions({
  projectId,
  sourceRunId,
  testCaseId,
  canRetest = true,
}: {
  projectId: string;
  sourceRunId: string;
  testCaseId: string;
  canRetest?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [anchors, setAnchors] = useState<Array<string | undefined>>([
    undefined,
  ]);
  const links = trpcReact.manualRetest.links.useQuery({
    projectId,
    sourceRunId,
    testCaseId,
    before: anchors[anchors.length - 1],
  });
  return (
    <section style={{ marginTop: 12, minWidth: 0, overflowWrap: "anywhere" }}>
      {canRetest && (
        <button
          type="button"
          className="btn-secondary"
          onClick={() => setOpen(true)}
        >
          Review separate retest
        </button>
      )}
      {links.isError ? (
        <p role="alert">
          Retest relationships could not be verified.{" "}
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void links.refetch()}
          >
            Retry links
          </button>
        </p>
      ) : links.isPending ||
        links.isFetching ||
        links.fetchStatus === "paused" ? (
        <p role="status">Checking retest relationships…</p>
      ) : (
        links.data && (
          <>
            {links.data.original && (
              <p>
                <a href={link(projectId, links.data.original.testRunId)}>
                  Original execution
                </a>{" "}
                ·{" "}
                {links.data.original.capturedOutcome === "FAIL"
                  ? "Failed"
                  : "Blocked"}{" "}
                outcome captured when this retest was created, not a
                defect-resolution claim.
              </p>
            )}
            {links.data.retests.length > 0 && (
              <details>
                <summary>
                  Linked separate retests ({links.data.retests.length} on this
                  page)
                </summary>
                <ul>
                  {links.data.retests.map((run) => (
                    <li key={run.testRunId}>
                      <a href={link(projectId, run.testRunId)}>
                        Retest started{" "}
                        {new Date(run.startedAt).toLocaleString()}
                      </a>{" "}
                      · Overall run: {run.status.toLowerCase()} (not an
                      individual case verdict)
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {anchors.length > 1 && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setAnchors((a) => a.slice(0, -1))}
                >
                  Newer retests
                </button>
              )}
              {links.data.nextCursor && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() =>
                    setAnchors((a) => [...a, links.data!.nextCursor!])
                  }
                >
                  Older retests
                </button>
              )}
            </div>
          </>
        )
      )}
      <ManualRetestWizard
        key={`${projectId}:${sourceRunId}:${testCaseId}`}
        projectId={projectId}
        sourceRunId={sourceRunId}
        testCaseId={testCaseId}
        open={open}
        onClose={() => setOpen(false)}
      />
    </section>
  );
}
