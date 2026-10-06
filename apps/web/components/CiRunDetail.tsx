"use client";
import type { CSSProperties } from "react";
import { useCiRunDetail } from "../lib/use-ci-run-detail";
import type { CiRunDetailPage } from "../lib/ci-run-detail-reader";
import { DistributionBar } from "./MetricVisuals";

/** Exact retained strings are never used as HTML, links or provider actions. */
function CiStoredText({
  label,
  value,
}: {
  label: string;
  value: string | null;
}) {
  return (
    <div style={{ minWidth: 0 }}>
      <dt className="small muted">{label}</dt>
      <dd
        style={{
          margin: "4px 0 12px",
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
        }}
      >
        {value === null ? (
          <span className="muted">Not recorded (NULL)</span>
        ) : value === "" ? (
          <span className="muted">Recorded empty text</span>
        ) : (
          <span>
            {/^\s+$/.test(value) && (
              <span className="muted">Recorded whitespace text: </span>
            )}
            {value}
          </span>
        )}
      </dd>
    </div>
  );
}
function CiOutcomeBadge({ status }: { status: string }) {
  const color =
    status === "PASS" || status === "PASSED"
      ? "frost"
      : status === "FAIL" || status === "FAILED"
        ? "ember"
        : status === "BLOCKED" || status === "FLAKY" || status === "PARTIAL"
          ? "warning"
          : status === "RUNNING"
            ? "info"
            : "muted";
  return (
    <span
      className="run-status"
      style={{ color: `var(--${color})`, background: "transparent" }}
    >
      {status}
    </span>
  );
}
function CiResultCard({ row }: { row: CiRunDetailPage["rows"][number] }) {
  const linked = row.linkedCase;
  return (
    <article
      className="panel"
      style={{
        marginTop: 12,
        padding: 16,
        minWidth: 0,
        overflowWrap: "anywhere",
      }}
    >
      <header
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 8,
        }}
      >
        <CiOutcomeBadge status={row.status} />
        <code>
          {linked
            ? linked.displayId === ""
              ? "Recorded empty display ID"
              : (linked.displayId ?? linked.id)
            : row.id}
        </code>
        <strong>
          {linked
            ? linked.title === ""
              ? "Linked case has an empty title"
              : linked.title
            : "Unmatched result"}
        </strong>
      </header>
      <p className="small muted">
        Result <code>{row.id}</code> · Duration{" "}
        {row.durationMs === null
          ? "not recorded (NULL)"
          : `${row.durationMs} ms`}
      </p>
      <dl>
        <CiStoredText
          label="Captured external test ID"
          value={row.externalTestId}
        />
        <CiStoredText
          label="Captured external file path"
          value={row.externalFilePath}
        />
        <CiStoredText label="Stored error message" value={row.errorMessage} />
        <CiStoredText label="Stored note" value={row.note} />
      </dl>
      {linked && (
        <details>
          <summary>
            Current linked case / source metadata (not a frozen execution
            definition)
          </summary>
          <p className="small">
            Native case <code>{linked.id}</code> ·{" "}
            {linked.archived ? "Archived" : "Not archived"} · Review{" "}
            {linked.reviewStatus}
          </p>
          <dl>
            <CiStoredText
              label="Current stable display ID"
              value={linked.displayId}
            />
            <CiStoredText label="Current case title" value={linked.title} />
            {linked.source ? (
              <>
                <CiStoredText
                  label="Current source record ID"
                  value={linked.source.id}
                />
                <CiStoredText
                  label="Current source file path"
                  value={linked.source.filePath}
                />
                <CiStoredText
                  label="Current function name"
                  value={linked.source.functionName}
                />
                <CiStoredText
                  label="Current framework"
                  value={linked.source.framework}
                />
                <CiStoredText
                  label="Current framework family"
                  value={linked.source.frameworkFamily}
                />
                <CiStoredText
                  label="Current source external test ID"
                  value={linked.source.externalTestId}
                />
                <CiStoredText
                  label="Current source last-synced commit"
                  value={linked.source.lastSyncedCommitSha}
                />
                <CiStoredText
                  label="Current source last-synced UTC"
                  value={linked.source.lastSyncedAt}
                />
              </>
            ) : (
              <p className="muted">No current source metadata record (NULL).</p>
            )}
          </dl>
        </details>
      )}
      <details style={{ marginTop: 10 }}>
        <summary>
          {row.artifacts.length} artifact metadata reference
          {row.artifacts.length === 1 ? "" : "s"} on this result
        </summary>
        <p className="small muted">
          References only. Files, availability, contents and immutable versions
          have not been verified. No file is retrieved.
        </p>
        {row.artifacts.length === 0 ? (
          <p>No artifact metadata references on this result.</p>
        ) : (
          <ul>
            {row.artifacts.map((artifact) => (
              <li key={artifact.id} style={{ marginBottom: 8 }}>
                <code>{artifact.id}</code> · {artifact.type} · Captured UTC{" "}
                <time dateTime={artifact.capturedAt}>
                  {artifact.capturedAt}
                </time>{" "}
                · Duration{" "}
                {artifact.durationMs === null
                  ? "not recorded (NULL)"
                  : `${artifact.durationMs} ms`}
              </li>
            ))}
          </ul>
        )}
      </details>
      <p className="small muted">
        Current stored result, not immutable history. Captured IDs/paths and
        current case/source labels are separate; no mapping, source or case was
        changed.
      </p>
    </article>
  );
}
export function CiRunDetail({
  projectId,
  testRunId,
  organizationId,
  active = true,
}: {
  projectId: string;
  testRunId: string;
  organizationId: string | null | undefined;
  active?: boolean;
}) {
  const reader = useCiRunDetail(projectId, testRunId, organizationId, {
      active,
      limit: 20,
    }),
    page = active ? reader.fresh : null;
  const layout: CSSProperties = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 180px), 1fr))",
    gap: 12,
  };
  return (
    <section aria-label="Current native CI run detail" style={{ minWidth: 0 }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 10,
          marginBottom: 12,
        }}
      >
        <h2 style={{ margin: 0 }}>CI run results</h2>
        <button type="button" onClick={() => reader.refresh()}>
          Refresh current native access
        </button>
      </div>
      {!page ? (
        <div className="panel" role="status">
          <p>
            {reader.loading
              ? "Reading the original native project, actor and CI result page…"
              : "Current CI detail is unavailable. Cached private result text and labels are withheld."}
          </p>
          {reader.error && <p>{reader.error}</p>}
          <p className="small muted">
            Restoring an account or session does not reopen cached results.
            Explicitly refresh native access under the original project and
            actor. No stored body, count or readiness is inferred.
          </p>
        </div>
      ) : (
        <>
          <header
            className="panel"
            style={{ padding: 16, overflowWrap: "anywhere" }}
          >
            <CiOutcomeBadge status={page.header.status} />{" "}
            <code>{page.header.id}</code>
            <dl style={{ ...layout, marginBottom: 0 }}>
              <CiStoredText
                label="CI provider"
                value={page.header.ciProvider}
              />
              <CiStoredText label="Branch" value={page.header.branch} />
              <CiStoredText label="Commit" value={page.header.commitSha} />
              <CiStoredText label="Started UTC" value={page.header.startedAt} />
              <CiStoredText
                label="Finished UTC"
                value={page.header.finishedAt}
              />
            </dl>
          </header>
          <h3>Current admitted run ID window · raw ingested observations</h3>
          <p className="small muted">
            Counts cover this admitted ID window in the current read, not unique
            cases, planned work left, completion percentage, readiness or
            immutable execution history.
          </p>
          <div style={layout}>
            {(
              [
                ["Raw observations", page.summary.total],
                ["Passed", page.summary.pass],
                ["Failed", page.summary.fail],
                ["Blocked", page.summary.blocked],
                ["Skipped", page.summary.skip],
                ["Flaky", page.summary.flaky],
                ["Other", page.summary.other],
              ] as const
            ).map(([label, count]) => (
              <div key={label} className="panel" style={{ padding: 12 }}>
                <span className="small muted">{label}</span>
                <strong style={{ display: "block", fontSize: "1.4rem" }}>
                  {count}
                </strong>
              </div>
            ))}
          </div>
          <DistributionBar
            label="Raw outcomes in the admitted ID window"
            segments={[
              { label: "Passed", value: page.summary.pass, tone: "success" },
              { label: "Failed", value: page.summary.fail, tone: "danger" },
              {
                label: "Blocked",
                value: page.summary.blocked,
                tone: "warning",
              },
              { label: "Skipped", value: page.summary.skip, tone: "neutral" },
              { label: "Flaky", value: page.summary.flaky, tone: "warning" },
              { label: "Other", value: page.summary.other, tone: "neutral" },
            ]}
          />
          <p className="small">
            {page.rows.length} result{page.rows.length === 1 ? "" : "s"} on this
            page · limit {page.limit} · ordered by UTF-8/C result ID, not
            execution chronology.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button
              type="button"
              disabled={!reader.canPrevious}
              onClick={() => reader.previous()}
            >
              Previous ID page
            </button>
            <button
              type="button"
              disabled={!reader.canPrevious}
              onClick={() => reader.first()}
            >
              First anchored ID page
            </button>
            <button
              type="button"
              disabled={!reader.canNext}
              onClick={() => reader.next()}
            >
              Next ID page
            </button>
          </div>
          {page.rows.length === 0 ? (
            <p className="panel">
              No result rows on this admitted page. No whole-project zero or
              planned CI scope is inferred.
            </p>
          ) : (
            page.rows.map((row) => <CiResultCard key={row.id} row={row} />)
          )}
          <details style={{ marginTop: 16 }}>
            <summary>Read scope, provenance and limits</summary>
            <p className="small">
              ID upper bound:{" "}
              {page.throughResultId === null ? (
                "Empty admitted window (NULL)"
              ) : (
                <code>{page.throughResultId}</code>
              )}
              . Not a globally frozen cohort. Native read nonce{" "}
              <code>{page.readContext.requestId}</code>. Response received by
              browser UTC {reader.snapshot?.receivedAt}.
            </p>
            <ul>
              {page.limitations.map((limit, index) => (
                <li key={index}>{limit}</li>
              ))}
            </ul>
            <p className="small muted">
              This view does not classify, heal, open CI URLs, retrieve files,
              run AI, change links or export result bodies.
            </p>
          </details>
        </>
      )}
    </section>
  );
}
