"use client";
import { useState } from "react";
import Link from "next/link";
import { trpcReact } from "@/lib/trpcReact";
import { readableMetric } from "@/lib/frozen-report";

export function ReportSnapshotEvidence(props: {
  projectId: string;
  snapshotId: string;
}) {
  return (
    <SnapshotEvidence
      key={`${props.projectId}:${props.snapshotId}`}
      {...props}
    />
  );
}
function SnapshotEvidence({
  projectId,
  snapshotId,
}: {
  projectId: string;
  snapshotId: string;
}) {
  const [open, setOpen] = useState(false),
    [kind, setKind] = useState<"cases" | "runs">("cases"),
    [page, setPage] = useState(0);
  const query = trpcReact.reportSnapshots.evidence.useQuery(
    { projectId, id: snapshotId, kind, page },
    { enabled: open, staleTime: 0 },
  );
  const evidence =
    open &&
    !query.error &&
    !query.isFetching &&
    !query.isPaused &&
    query.data?.kind === kind &&
    query.data.page === page
      ? query.data
      : null;
  const outcomes = (rows: Array<{ key: string; count: number }> | null) =>
    rows === null
      ? "Not captured"
      : rows.length
        ? rows.map((r) => `${readableMetric(r.key)}: ${r.count}`).join(" · ")
        : "No recorded result";
  return (
    <details
      onToggle={(event) => setOpen(event.currentTarget.open)}
      style={{ marginBlock: 16 }}
    >
      <summary>Explore captured cases and runs</summary>
      <p className="text-muted">
        These are the identities and counts saved at capture, not a new live
        report. Native links open current records, which may have changed.
        Missing records stay in captured denominators.
      </p>
      <label>
        Captured evidence
        <select
          value={kind}
          onChange={(event) => {
            setKind(event.target.value as "cases" | "runs");
            setPage(0);
          }}
        >
          <option value="cases">Active case denominator</option>
          <option value="runs">Contributing runs</option>
        </select>
      </label>
      {query.error ? (
        <div role="alert">
          <p>
            Captured evidence could not be verified. No counts or links have
            been substituted.
          </p>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void query.refetch()}
          >
            Retry captured evidence
          </button>
        </div>
      ) : !evidence ? (
        <p role="status">
          {query.isPaused
            ? "Waiting for a connection to verify workspace access…"
            : "Verifying captured evidence…"}
        </p>
      ) : (
        <>
          <p>
            {evidence.total} captured {kind} · Page {page + 1} ·{" "}
            {new Date(evidence.asOf).toLocaleString()}
          </p>
          {!evidence.complete && (
            <p role="status">
              This older snapshot did not capture per-entity execution facts.
              Only saved identities and available automation labels are shown.
              Historical counts, priority and timestamps cannot be reconstructed
              safely.
            </p>
          )}
          {!evidence.items.length ? (
            <p>
              No {kind} were captured in this snapshot. This is not a passing
              result.
            </p>
          ) : (
            <div className="table-scroll">
              <table
                className="workspace-table"
                style={{
                  width: "100%",
                  minWidth: 0,
                  tableLayout: "fixed",
                  overflowWrap: "anywhere",
                }}
              >
                <thead>
                  <tr>
                    <th scope="col">Captured record</th>
                    <th scope="col">Recorded at capture</th>
                    <th scope="col">Outcomes / missing results</th>
                  </tr>
                </thead>
                <tbody>
                  {evidence.kind === "cases"
                    ? evidence.items.map((row) => (
                        <tr key={row.referenceIndex}>
                          <th scope="row" style={{ whiteSpace: "normal" }}>
                            {row.id ? (
                              <Link
                                href={`/projects/${encodeURIComponent(projectId)}/test-cases/${encodeURIComponent(row.id)}`}
                              >
                                {row.displayId ||
                                  `Captured case ${row.referenceIndex}`}
                              </Link>
                            ) : (
                              <>
                                {row.displayId ||
                                  `Captured case ${row.referenceIndex}`}
                                <small style={{ display: "block" }}>
                                  Current record unavailable
                                </small>
                              </>
                            )}
                          </th>
                          <td style={{ whiteSpace: "normal" }}>
                            Priority:{" "}
                            {row.priority
                              ? readableMetric(row.priority)
                              : "Not captured"}
                            <br />
                            Automation: {readableMetric(row.automationStatus)}
                          </td>
                          <td style={{ whiteSpace: "normal" }}>
                            {outcomes(row.outcomes)}
                            <br />
                            Planned runs: {row.plannedRuns ?? "Not captured"}
                            <br />
                            Without result:{" "}
                            {row.notRecordedRuns ?? "Not captured"}
                          </td>
                        </tr>
                      ))
                    : evidence.items.map((row) => (
                        <tr key={row.referenceIndex}>
                          <th scope="row" style={{ whiteSpace: "normal" }}>
                            {row.id ? (
                              <Link
                                href={`/projects/${encodeURIComponent(projectId)}/test-runs#run-${encodeURIComponent(row.id)}`}
                              >
                                Captured run {row.referenceIndex}
                              </Link>
                            ) : (
                              <>
                                Captured run {row.referenceIndex}
                                <small style={{ display: "block" }}>
                                  Current record unavailable
                                </small>
                              </>
                            )}
                          </th>
                          <td style={{ whiteSpace: "normal" }}>
                            {row.startedAt
                              ? new Date(row.startedAt).toLocaleString()
                              : "Time not captured"}
                            <br />
                            {row.provider
                              ? readableMetric(row.provider)
                              : "Provider not captured"}
                          </td>
                          <td style={{ whiteSpace: "normal" }}>
                            {outcomes(row.outcomes)}
                            <br />
                            Planned cases: {row.plannedCases ?? "Not captured"}
                            <br />
                            Without result:{" "}
                            {row.notRecordedCases ?? "Not captured"}
                          </td>
                        </tr>
                      ))}
                </tbody>
              </table>
            </div>
          )}
          <div
            style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}
          >
            <button
              type="button"
              className="btn-secondary"
              disabled={!page}
              onClick={() => setPage(page - 1)}
            >
              Previous evidence page
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={(page + 1) * 50 >= evidence.total}
              onClick={() => setPage(page + 1)}
            >
              Next evidence page
            </button>
          </div>
          <p className="text-muted">
            PASS, FAIL and FLAKY are executed outcomes; SKIP and BLOCKED are not
            executed. No recorded result is not a passing outcome. Captured
            outcome totals include repeat observations, not one final verdict
            per case.
          </p>
        </>
      )}
    </details>
  );
}
