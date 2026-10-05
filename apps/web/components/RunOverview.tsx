"use client";
import { useState } from "react";
import { DistributionBar } from "./MetricVisuals";
import { downloadFile } from "@/lib/download";
import { renderBoundedSpreadsheetCsv } from "@vaettir/core";
import type { RouterOutputs } from "@/lib/trpcReact";
type Run = RouterOutputs["testRuns"]["list"][number];

export function RunOverview({
  runs,
  projectId,
  onView,
}: {
  runs: Run[];
  projectId: string;
  onView: (id: string) => void;
}) {
  const [exportError, setExportError] = useState<string | null>(null);
  const unavailable = runs.filter((run) => !run.progress).length;
  const total = runs.reduce((sum, run) => sum + (run.progress?.total ?? 0), 0);
  const remaining = runs.reduce(
    (sum, run) => sum + (run.progress?.remaining ?? 0),
    0,
  );
  function exportOverview() {
    setExportError(null);
    try {
      downloadFile(
        "vaettir-visible-runs.csv",
        renderBoundedSpreadsheetCsv(
          [
            "Run ID",
            "Source",
            "Status",
            "Started UTC",
            "Finished UTC",
            "Planned / ingested",
            "Recorded",
            "Remaining",
            "Recorded % (manual only)",
            "Pass",
            "Fail",
            "Blocked",
            "Skip",
            "Flaky",
            "Scope / progress note",
          ],
          runs.map((run) => [
            run.id,
            run.ciProvider,
            run.status,
            new Date(run.startedAt).toISOString(),
            run.finishedAt
              ? new Date(run.finishedAt).toISOString()
              : "In progress",
            run.progress?.total ?? "Unavailable",
            run.progress?.recorded ?? "Unavailable",
            run.ciProvider === "manual"
              ? (run.progress?.remaining ?? "Unavailable")
              : "Planned CI scope unavailable",
            run.ciProvider === "manual"
              ? (run.progress?.percentComplete ?? "Unavailable")
              : "Planned CI scope unavailable",
            run.progress?.pass ?? "Unavailable",
            run.progress?.fail ?? "Unavailable",
            run.progress?.blocked ?? "Unavailable",
            run.progress?.skip ?? "Unavailable",
            run.progress?.flaky ?? "Unavailable",
            run.progressUnavailableReason ??
              (run.ciProvider === "manual"
                ? "Unique planned case identities"
                : "Ingested result cohort, not planned CI coverage"),
          ]),
        ),
        "text/csv",
      );
    } catch (cause) {
      setExportError(
        cause instanceof Error
          ? cause.message
          : "The displayed run summary could not be exported.",
      );
    }
  }
  return (
    <section aria-label="Run dashboard">
      <div className="run-dashboard-summary">
        <div>
          <strong>{runs.length}</strong>
          <span>Runs on this page</span>
        </div>
        <div>
          <strong>
            {runs.filter((run) => run.status === "RUNNING").length}
          </strong>
          <span>In progress</span>
        </div>
        <div>
          <strong>
            {total - remaining}/{total}
          </strong>
          <span>Recorded on this page</span>
        </div>
        <div>
          <strong>{remaining}</strong>
          <span>Left to test</span>
        </div>
        <button
          type="button"
          className="btn-secondary"
          onClick={exportOverview}
        >
          Export displayed runs · CSV
        </button>
        <a className="btn-secondary" href={`/projects/${projectId}/reports`}>
          Project reports
        </a>
      </div>
      <p className="text-muted">
        This dashboard covers the displayed run-history page, not hidden pages.
        Completion measures recorded outcomes, not pass rate. CI totals cover
        ingested results only.
      </p>
      {unavailable > 0 && (
        <p role="status">
          {unavailable} displayed run(s) have unavailable progress and are
          excluded from aggregate progress counts.
        </p>
      )}
      {exportError && (
        <p role="alert">{exportError} Nothing was silently truncated.</p>
      )}
      <div className="run-card-grid">
        {runs.map((run) => (
          <article className="panel run-card" key={run.id} id={`run-${run.id}`}>
            <header>
              <h2>
                {run.ciProvider === "manual"
                  ? "Manual test run"
                  : `${run.ciProvider} run`}
              </h2>
              <span
                className={`run-status run-status-${run.status.toLowerCase()}`}
              >
                {run.status.toLowerCase()}
              </span>
            </header>
            <p className="text-muted">
              {run.ciProvider === "manual"
                ? (run.startedByEmail ?? "Tester not recorded")
                : `${run.branch} · ${run.commitSha.slice(0, 12)}`}
            </p>
            {run.progress ? (
              <>
                <div className="run-card-progress">
                  <strong>
                    {run.ciProvider === "manual"
                      ? `${run.progress.percentComplete}% recorded`
                      : `${run.progress.recorded} ingested outcomes`}
                  </strong>
                  <span>
                    {run.ciProvider === "manual"
                      ? `${run.progress.remaining} left to test`
                      : "Planned CI total unavailable"}
                  </span>
                </div>
                <progress
                  aria-label={`Run ${run.id} recorded progress`}
                  value={run.progress.recorded}
                  max={run.progress.total || 1}
                />
                <DistributionBar
                  label={`Run ${run.id} outcomes`}
                  segments={[
                    {
                      label: "Passed",
                      value: run.progress.pass,
                      tone: "success",
                    },
                    {
                      label: "Failed",
                      value: run.progress.fail,
                      tone: "danger",
                    },
                    {
                      label: "Blocked",
                      value: run.progress.blocked,
                      tone: "warning",
                    },
                    {
                      label: "Skipped",
                      value: run.progress.skip,
                      tone: "neutral",
                    },
                    { label: "Flaky", value: run.progress.flaky, tone: "info" },
                    {
                      label: "Other",
                      value: run.progress.other,
                      tone: "neutral",
                    },
                    {
                      label: "Untested",
                      value: run.progress.remaining,
                      tone: "neutral",
                    },
                  ]}
                />
              </>
            ) : (
              <p role="status">
                {run.progressUnavailableReason ??
                  "Progress is unavailable from this API version."}
              </p>
            )}
            <dl>
              <dt>Started</dt>
              <dd>
                <time dateTime={new Date(run.startedAt).toISOString()}>
                  {new Date(run.startedAt).toLocaleString()}
                </time>
              </dd>
              <dt>Finished</dt>
              <dd>
                {run.finishedAt
                  ? new Date(run.finishedAt).toLocaleString()
                  : "Not finished"}
              </dd>
            </dl>
            <footer>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => onView(run.id)}
              >
                View results
              </button>
              {run.ciProvider === "manual" && (
                <a
                  className="btn-primary"
                  href={`/projects/${projectId}/test-runs/manual/${run.id}`}
                >
                  {run.status === "RUNNING"
                    ? "Resume execution"
                    : "Open execution record"}
                </a>
              )}
            </footer>
          </article>
        ))}
      </div>
    </section>
  );
}
