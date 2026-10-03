"use client";

import { useState } from "react";
import Link from "next/link";
import type { CaseExecutionHistoryItem } from "@vaettir/core";
import { trpcReact } from "@/lib/trpcReact";
import { ManualRetestActions } from "./ManualRetestWizard";

const outcomes = {
  PASS: "Passed",
  FAIL: "Failed",
  BLOCKED: "Blocked",
  SKIP: "Skipped",
  FLAKY: "Flaky",
  NOT_RECORDED: "No result",
  MIXED: "Mixed results",
};
const runStatuses = {
  RUNNING: "In progress",
  PASSED: "Passed",
  FAILED: "Failed",
  PARTIAL: "Partial",
};

function ExecutionEntry({
  item,
  projectId,
}: {
  item: CaseExecutionHistoryItem;
  projectId: string;
}) {
  return (
    <article
      style={{
        border: "1px solid var(--line)",
        borderRadius: 8,
        padding: 12,
        minWidth: 0,
        overflowWrap: "anywhere",
      }}
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <strong>
          Case outcome:{" "}
          {item.outcomeMode === "PARTIAL_STEPS"
            ? "No confirmed result"
            : outcomes[item.outcome]}
        </strong>
        <time dateTime={item.startedAt}>
          {new Date(item.startedAt).toLocaleString()}
        </time>
      </header>
      <dl
        style={{
          display: "grid",
          gridTemplateColumns:
            "repeat(auto-fit, minmax(min(100%, 160px), 1fr))",
          gap: 12,
          margin: "12px 0",
        }}
      >
        <div>
          <dt className="muted">Overall run</dt>
          <dd style={{ margin: 0 }}>{runStatuses[item.runStatus]}</dd>
        </div>
        <div>
          <dt className="muted">Platform / build</dt>
          <dd style={{ margin: 0 }}>
            {item.platform || "Platform not recorded"}
            <br />
            {item.build || "Build not recorded"}
          </dd>
        </div>
        <div>
          <dt className="muted">Run starter (current profile)</dt>
          <dd style={{ margin: 0 }}>{item.starter?.label || "Not recorded"}</dd>
        </div>
      </dl>
      {item.outcomeMode === "PARTIAL_STEPS" && (
        <p role="note">Partial step observations, not a completed test case.</p>
      )}
      {item.outcome === "NOT_RECORDED" &&
        item.outcomeMode !== "PARTIAL_STEPS" && (
          <p>
            {item.planned
              ? "Included in this run, but no case outcome has been recorded."
              : "No case outcome recorded."}
          </p>
        )}
      {item.steps.correctionCount > 0 && (
        <p>
          {item.steps.correctionCount} step observation{" "}
          {item.steps.correctionCount === 1 ? "correction" : "corrections"}{" "}
          within this same execution.
        </p>
      )}
      <details>
        <summary>Review execution evidence</summary>
        <dl style={{ marginTop: 12 }}>
          <dt className="muted">Execution identity</dt>
          <dd style={{ margin: "0 0 10px" }}>{item.runId}</dd>
          <dt className="muted">Reported by</dt>
          <dd style={{ margin: "0 0 10px" }}>
            {item.source === "MANUAL" ? "Manual execution" : item.provider}
          </dd>
          <dt className="muted">Saved case definition</dt>
          <dd style={{ margin: "0 0 10px" }}>
            {item.definition.titleAtRun ||
              (item.definition.source === "UNSUPPORTED_METADATA"
                ? "Unsupported or incomplete saved metadata"
                : "Not recorded for this execution")}
          </dd>
          <dt className="muted">Recorded steps</dt>
          <dd style={{ margin: "0 0 10px" }}>
            {item.steps.recordedCount} /{" "}
            {item.definition.stepCount ?? "unknown"}
          </dd>
          <dt className="muted">Result evidence</dt>
          <dd style={{ margin: "0 0 10px" }}>
            {item.outcomeCounts.length
              ? item.outcomeCounts
                  .map((c) => `${c.count} ${outcomes[c.status].toLowerCase()}`)
                  .join(", ")
              : "No case result"}
            ; {item.artifactCount} artifact references
          </dd>
          {item.environment && (
            <>
              <dt className="muted">Recorded environment</dt>
              <dd style={{ margin: "0 0 10px" }}>{item.environment}</dd>
            </>
          )}
          {item.reportedCommit && (
            <>
              <dt className="muted">
                Reported source commit, not deployed release proof
              </dt>
              <dd style={{ margin: "0 0 10px" }}>{item.reportedCommit}</dd>
            </>
          )}
          {item.steps.lastObservation && (
            <>
              <dt className="muted">
                Last step observer (name recorded at observation)
              </dt>
              <dd style={{ margin: "0 0 10px" }}>
                {item.steps.lastObservation.recordedActorName} ·{" "}
                <time dateTime={item.steps.lastObservation.recordedAt}>
                  {new Date(
                    item.steps.lastObservation.recordedAt,
                  ).toLocaleString()}
                </time>
              </dd>
            </>
          )}
        </dl>
        <ul>
          {item.limitations.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
        {item.source === "MANUAL" && (
          <Link
            className="btn-secondary"
            style={{ display: "inline-block" }}
            href={`/projects/${encodeURIComponent(projectId)}/test-runs/manual/${encodeURIComponent(item.runId)}`}
          >
            Open run procedure and step history
          </Link>
        )}
      </details>
      {item.source === "MANUAL" && <ManualRetestActions key={`${projectId}:${item.runId}:${item.definition.originalCaseId}`} projectId={projectId} sourceRunId={item.runId} testCaseId={item.definition.originalCaseId} canRetest={item.outcome === "FAIL" || item.outcome === "BLOCKED"} />}
    </article>
  );
}

export function TestCaseExecutionHistory({
  projectId,
  testCaseId,
  active = true,
}: {
  projectId: string;
  testCaseId: string;
  active?: boolean;
}) {
  const [anchors, setAnchors] = useState<Array<{ runId: string } | undefined>>([
    undefined,
  ]);
  const history = trpcReact.caseExecutionHistory.list.useQuery(
    { projectId, testCaseId, limit: 10, before: anchors[anchors.length - 1] },
    { enabled: active, retry: false },
  );
  const page = history.data;
  return (
    <section aria-label="Case executions" style={{ marginBottom: 24 }}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <h3>Executions</h3>
        <button
          className="btn-secondary"
          type="button"
          disabled={history.isFetching}
          onClick={() =>
            anchors.length > 1
              ? setAnchors([undefined])
              : void history.refetch()
          }
        >
          Refresh latest
        </button>
      </header>
      <p className="muted">
        One entry per run. Step corrections stay within that run; a later
        execution does not by itself verify a defect fix or a linked retest.
      </p>
      {history.isFetching && <p role="status">Loading executions…</p>}
      {history.error ? (
        <div role="alert">
          <p>Execution history could not be loaded. {history.error.message}</p>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void history.refetch()}
          >
            Retry history
          </button>
        </div>
      ) : (
        page && (
          <>
            <p>
              <strong>{page.testCase.displayId}</strong> ·{" "}
              {page.testCase.archived ? "Archived case" : "Test case"} · Page{" "}
              {anchors.length}
            </p>
            {!page.items.length ? (
              <p>
                No linked or planned executions have been recorded for this
                case.
              </p>
            ) : (
              <div style={{ display: "grid", gap: 12 }}>
                {page.items.map((item) => (
                  <ExecutionEntry
                    key={item.runId}
                    item={item}
                    projectId={projectId}
                  />
                ))}
              </div>
            )}
            <nav
              aria-label="Execution history pages"
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                marginTop: 12,
              }}
            >
              {anchors.length > 1 && (
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={history.isFetching}
                  onClick={() => setAnchors((current) => current.slice(0, -1))}
                >
                  Newer executions
                </button>
              )}
              {page.nextCursor && (
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={history.isFetching}
                  onClick={() =>
                    setAnchors((current) => [...current, page.nextCursor!])
                  }
                >
                  Older executions
                </button>
              )}
            </nav>
          </>
        )
      )}
    </section>
  );
}
