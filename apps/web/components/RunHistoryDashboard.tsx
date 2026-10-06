"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useRunHistory } from "@/lib/use-run-history";
import { downloadFile } from "@/lib/download";
import {
  reviewRunHistoryPage,
  matchesRunHistoryPageReview,
  downloadReviewedRunHistoryPage,
  type RunHistoryPageReview,
} from "@/lib/run-history-page-export";
import {
  runHistoryPageFingerprint,
  type RunHistoryReadSnapshot,
  type RunHistoryPageData,
} from "@/lib/run-history-reader";
import { DistributionBar } from "./MetricVisuals";
import { Modal } from "./Modal";

type Run = RunHistoryPageData["rows"][number];
type ExportState = {
  review: RunHistoryPageReview;
  open: boolean;
  notice: string | null;
};
class RunHistoryExportOwner {
  private review: RunHistoryPageReview | null = null;
  private opened = false;
  private consumed = new WeakSet<RunHistoryPageReview>();
  activate(review: RunHistoryPageReview) {
    this.review = review;
    this.opened = true;
  }
  owns(review: RunHistoryPageReview) {
    return this.review === review;
  }
  close(review: RunHistoryPageReview) {
    if (!this.owns(review)) return false;
    this.opened = false;
    return true;
  }
  reopen(review: RunHistoryPageReview) {
    if (!this.owns(review)) return false;
    this.opened = true;
    return true;
  }
  wasConsumed(review: RunHistoryPageReview) {
    return this.consumed.has(review);
  }
  canDownload(review: RunHistoryPageReview) {
    return this.owns(review) && this.opened && !this.wasConsumed(review);
  }
  consume(review: RunHistoryPageReview) {
    if (!this.canDownload(review)) return false;
    this.consumed.add(review);
    return true;
  }
}
function sameRenderedPage(
  rendered: RunHistoryReadSnapshot | null,
  current: RunHistoryReadSnapshot | null,
) {
  return (
    !!rendered &&
    !!current &&
    runHistoryPageFingerprint(rendered) === runHistoryPageFingerprint(current)
  );
}
function runTone(status: string) {
  return status === "RUNNING"
    ? "var(--info)"
    : status === "FAILED"
      ? "var(--ember)"
      : status === "PASSED"
        ? "var(--frost)"
        : status === "PARTIAL"
          ? "var(--warning)"
          : "var(--muted)";
}
export function RunHistoryCard({
  run,
  onView,
}: {
  run: Run;
  onView: (id: string) => void;
}) {
  const manual = run.ciProvider === "manual",
    progress = run.progress;
  return (
    <article
      className="panel run-card"
      style={{ minWidth: 0, overflowWrap: "anywhere" }}
    >
      <header>
        <h3>{manual ? "Manual test run" : `${run.ciProvider} run`}</h3>
        <span
          className="run-status"
          style={{
            padding: "4px 10px",
            borderRadius: 20,
            color: runTone(run.status),
            background: "transparent",
          }}
        >
          {run.status}
        </span>
      </header>
      <p className="text-muted">
        Run <code>{run.id}</code>
      </p>
      {!manual && (
        <p className="text-muted">
          Branch {run.branch} · Commit <code>{run.commitSha}</code>
        </p>
      )}
      {progress ? (
        <>
          <div className="run-card-progress">
            <strong>
              {manual
                ? `${progress.percentComplete}% recorded`
                : `${progress.recorded} ingested observations`}
            </strong>
            <span>
              {manual
                ? `${progress.remaining} left to test`
                : "Planned CI completion unavailable"}
            </span>
          </div>
          {manual && (
            <progress
              aria-label={`Run ${run.id} recorded manual completion`}
              value={progress.recorded}
              max={progress.total || 1}
            />
          )}
          <p>
            {manual
              ? `${progress.recorded} of ${progress.total} planned identities recorded`
              : `${progress.total} ingested result observations; not the planned CI scope`}
          </p>
          <DistributionBar
            label={`Run ${run.id} ${manual ? "current planned identity verdicts" : "ingested observations"}`}
            segments={[
              { label: "Passed", value: progress.pass, tone: "success" },
              { label: "Failed", value: progress.fail, tone: "danger" },
              { label: "Blocked", value: progress.blocked, tone: "warning" },
              { label: "Skipped", value: progress.skip, tone: "neutral" },
              { label: "Flaky", value: progress.flaky, tone: "info" },
              { label: "Other", value: progress.other, tone: "neutral" },
              ...(manual
                ? [
                    {
                      label: "Untested",
                      value: progress.remaining,
                      tone: "neutral" as const,
                    },
                  ]
                : []),
            ]}
          />
        </>
      ) : (
        <p role="status">
          <strong>Progress unavailable.</strong> {run.progressUnavailableReason}{" "}
          No zero or completion percentage is inferred.
        </p>
      )}
      <dl>
        <dt>Started UTC</dt>
        <dd>
          <time dateTime={run.startedAt}>{run.startedAt}</time>
        </dd>
        <dt>Finished UTC</dt>
        <dd>
          {run.finishedAt ? (
            <time dateTime={run.finishedAt}>{run.finishedAt}</time>
          ) : (
            "Not recorded"
          )}
        </dd>
      </dl>
      <p className="text-muted">
        {manual
          ? "Recorded completion is not pass rate, trusted frozen readiness or release approval."
          : "Ingested outcomes do not establish planned CI coverage or release readiness."}
      </p>
      <footer>
        <button
          className={manual ? "btn-primary" : "btn-secondary"}
          type="button"
          onClick={() => onView(run.id)}
        >
          {manual
            ? run.status === "RUNNING"
              ? "Resume execution"
              : "Open execution record"
            : "View recorded results"}
        </button>
      </footer>
    </article>
  );
}

/** Current-page visuals only. The separate applied all-pages dashboard owns
 * project aggregates; neither UI may infer hidden-page coverage from these rows. */
export function RunHistoryDashboard({
  projectId,
  organizationId,
  active = true,
  onView,
}: {
  projectId: string;
  organizationId: string | null | undefined;
  active?: boolean;
  onView: (id: string) => void;
}) {
  const router = useRouter();
  const reader = useRunHistory(projectId, organizationId, {
      active,
      limit: 20,
    }),
    rendered = reader.snapshot;
  const [exportState, setExportState] = useState<ExportState | null>(null),
    [exportOwner] = useState(() => new RunHistoryExportOwner());
  const page = rendered?.page ?? null,
    rows = page?.rows ?? [],
    manual = rows.filter((run) => run.ciProvider === "manual"),
    supportedManual = manual.filter((run) => run.progress !== null),
    ci = rows.filter((run) => run.ciProvider !== "manual"),
    supportedCI = ci.filter((run) => run.progress !== null);
  const planned = supportedManual.reduce(
      (sum, run) => sum + run.progress!.total,
      0,
    ),
    recorded = supportedManual.reduce(
      (sum, run) => sum + run.progress!.recorded,
      0,
    ),
    remaining = supportedManual.reduce(
      (sum, run) => sum + run.progress!.remaining,
      0,
    ),
    ingested = supportedCI.reduce(
      (sum, run) => sum + run.progress!.recorded,
      0,
    ),
    unavailable = rows.filter((run) => run.progress === null).length;
  const exportReadable = matchesRunHistoryPageReview(
    exportState?.review ?? null,
    rendered,
  );
  function reviewPage() {
    const current = reader.current();
    if (!sameRenderedPage(rendered, current)) return;
    const review = reviewRunHistoryPage(current!);
    exportOwner.activate(review);
    setExportState({
      review,
      open: true,
      notice: null,
    });
  }
  function closeReview() {
    const captured = exportState;
    if (!captured || !exportOwner.close(captured.review)) return;
    setExportState((previous) =>
      previous === captured && previous
        ? { ...previous, open: false }
        : previous,
    );
  }
  function reopenReview() {
    const captured = exportState;
    if (
      !captured ||
      !matchesRunHistoryPageReview(captured.review, reader.current()) ||
      !exportOwner.reopen(captured.review)
    )
      return;
    setExportState((previous) =>
      previous === captured ? { ...captured, open: true } : previous,
    );
  }
  function downloadReview() {
    const captured = exportState;
    if (
      !captured ||
      !exportOwner.canDownload(captured.review) ||
      !sameRenderedPage(rendered, reader.current())
    )
      return;
    let notice =
      "The reviewed current-page CSV was handed to your browser. No hidden page or private case body is included.";
    try {
      const sent = downloadReviewedRunHistoryPage(
        captured.review,
        reader.current,
        (filename, content, mime) => {
          if (!exportOwner.consume(captured.review)) return;
          downloadFile(filename, content, mime);
        },
      );
      if (!sent) return;
    } catch {
      notice =
        "The current-page CSV could not be handed off. No content was truncated. If the browser may have received it, check downloads before explicitly preparing another review.";
    }
    if (
      !exportOwner.owns(captured.review) ||
      !matchesRunHistoryPageReview(captured.review, reader.current())
    )
      return;
    setExportState((previous) =>
      previous === captured ? { ...captured, notice } : previous,
    );
  }
  function viewRun(id: string) {
    const current = reader.current();
    if (
      !sameRenderedPage(rendered, current) ||
      !current!.page.rows.some((run) => run.id === id)
    )
      return;
    const run = current!.page.rows.find((run) => run.id === id)!;
    if (run.ciProvider === "manual") {
      router.push(
        `/projects/${encodeURIComponent(current!.origin.projectId)}/test-runs/manual/${encodeURIComponent(id)}`,
      );
      return;
    }
    onView(id);
  }
  return (
    <section
      aria-label="Current-page run history dashboard"
      style={{ minWidth: 0 }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <h2>Run history</h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button
            className="btn-secondary"
            type="button"
            disabled={!active}
            onClick={() => reader.refresh()}
          >
            Refresh current native access
          </button>
          <button
            className="btn-secondary"
            type="button"
            disabled={!page}
            onClick={reviewPage}
          >
            Review current page CSV
          </button>
        </div>
      </div>
      <p className="text-muted">
        This history page is not a whole-project dashboard. Manual completion
        counts recorded planned run-case instances, not pass rate. CI counts
        ingested observations, not planned completion. Each page is a fresh
        current read inside a run-start anchor, not a globally frozen snapshot.
      </p>
      {!page ? (
        <p role="status">
          {reader.loading
            ? "Verifying current native run-history access…"
            : (reader.error ??
              "Current native run history is unavailable. Cached rows and export review are withheld; explicitly refresh access under the original reader.")}
        </p>
      ) : (
        <>
          <p className="text-muted">
            Run-start anchor UTC:{" "}
            <time dateTime={page.readContext.asOf}>
              {page.readContext.asOf}
            </time>
            . Up to {page.limit} runs per page.{" "}
            {page.hasMore
              ? "Older history exists outside this page."
              : "No older run was returned by this read's bounded lookahead."}
          </p>
          <details>
            <summary>Current native read boundaries</summary>
            <ul>
              {page.limitations.map((limit, index) => (
                <li key={index}>{limit}</li>
              ))}
            </ul>
          </details>
          <div className="run-dashboard-summary">
            <div>
              <strong>{rows.length}</strong>
              <span>Runs on this page</span>
            </div>
            <div>
              <strong>
                {rows.filter((run) => run.status === "RUNNING").length}
              </strong>
              <span>Marked running on this page</span>
            </div>
            <div>
              <strong>
                {supportedManual.length
                  ? `${recorded} / ${planned}`
                  : manual.length
                    ? "Unavailable"
                    : "No manual runs on this page"}
              </strong>
              <span>
                Recorded manual run-case instances · {supportedManual.length} of{" "}
                {manual.length} manual runs supported
              </span>
            </div>
            <div>
              <strong>
                {supportedManual.length
                  ? remaining
                  : manual.length
                    ? "Unavailable"
                    : "No manual runs on this page"}
              </strong>
              <span>
                Remaining manual run-case instances · supported page runs only
              </span>
            </div>
            <div>
              <strong>
                {supportedCI.length
                  ? ingested
                  : ci.length
                    ? "Unavailable"
                    : "No CI runs on this page"}
              </strong>
              <span>
                CI ingested observations · {supportedCI.length} of {ci.length}{" "}
                CI runs supported
              </span>
            </div>
          </div>
          {unavailable > 0 && (
            <p role="status">
              {unavailable} displayed run(s) have unavailable progress. Their
              planned, recorded and remaining counts are excluded, not treated
              as zero.
            </p>
          )}
          {rows.length === 0 ? (
            <p>
              No runs were returned for this current anchored page. No
              whole-project zero is inferred.
            </p>
          ) : (
            <div className="run-card-grid">
              {rows.map((run) => (
                <RunHistoryCard key={run.id} run={run} onView={viewRun} />
              ))}
            </div>
          )}
          <nav
            aria-label="Current run-history page"
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              marginBlock: 16,
            }}
          >
            <button
              className="btn-secondary"
              type="button"
              onClick={() => reader.first()}
            >
              First anchored page
            </button>
            <button
              className="btn-secondary"
              type="button"
              disabled={!reader.canNewer}
              onClick={() => reader.newer()}
            >
              Newer page
            </button>
            <button
              className="btn-secondary"
              type="button"
              disabled={!reader.canOlder}
              onClick={() => reader.older()}
            >
              Older page
            </button>
          </nav>
        </>
      )}
      {exportState && !exportReadable && (
        <p role="status">
          A previous CSV review is retained privately but is no longer current.
          Refresh and explicitly review the current page; no stale export is
          enabled.
        </p>
      )}
      {exportState && exportReadable && !exportState.open && (
        <button className="btn-secondary" type="button" onClick={reopenReview}>
          Reopen reviewed current-page CSV
        </button>
      )}
      <Modal
        keepMounted
        open={!!exportState?.open && exportReadable}
        onClose={closeReview}
        title="Review current-page CSV"
      >
        {exportState && exportReadable ? (
          <>
            <p>
              Export exactly {exportState.review.snapshot.page.rows.length} run
              row(s) from this reviewed current page plus one scope-metadata
              row. Other pages and lookahead are excluded.
            </p>
            <dl>
              <dt>Reviewed run-start anchor UTC</dt>
              <dd>{exportState.review.snapshot.page.readContext.asOf}</dd>
              <dt>Response received UTC (client clock)</dt>
              <dd>{exportState.review.snapshot.receivedAt}</dd>
              <dt>Reviewed page limit</dt>
              <dd>{exportState.review.snapshot.page.limit}</dd>
            </dl>
            <p>
              Includes run ID, source, status, stored UTC start/finish times,
              supported progress/outcomes, native run-start anchor, page limit
              and client response-received time. Excludes private email, CI URL,
              branch/commit, notes, procedures, media and histories. This is a
              spreadsheet summary, not a full backup or approval.
            </p>
            <p>
              Manual recorded percentage is not pass rate. CI planned completion
              is unavailable; unsupported progress stays explicitly unavailable.
            </p>
            <button
              className="btn-primary"
              type="button"
              disabled={exportOwner.wasConsumed(exportState.review)}
              onClick={downloadReview}
            >
              Download reviewed current page CSV
            </button>
            <button
              className="btn-secondary"
              type="button"
              onClick={closeReview}
            >
              Keep review and close
            </button>
            {exportState.notice && <p role="status">{exportState.notice}</p>}
          </>
        ) : (
          <p>
            Private export contents are withheld until a new current-page
            review.
          </p>
        )}
      </Modal>
    </section>
  );
}
