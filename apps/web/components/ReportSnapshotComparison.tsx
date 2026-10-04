"use client";
import { useState } from "react";
import Link from "next/link";
import { Modal } from "./Modal";
import { trpcReact } from "@/lib/trpcReact";
import { renderReportComparisonHtml } from "@/lib/report-comparison";
import { renderReportComparisonCsv } from "@/lib/report-csv";
import type { RouterOutputs } from "@/lib/trpcReact";
import { readableMetric } from "@/lib/frozen-report";

export type SelectedReportSnapshot = {
  id: string;
  title: string;
  asOf: Date | string;
};
export function ReportSnapshotComparison({
  projectId,
  selected,
  onClose,
}: {
  projectId: string;
  selected: SelectedReportSnapshot[];
  onClose: () => void;
}) {
  const ordered = [...selected].sort(
    (a, b) => new Date(a.asOf).getTime() - new Date(b.asOf).getTime(),
  );
  const baselineId = ordered[0]?.id ?? "",
    targetId = ordered[1]?.id ?? "";
  const [reviewedData, setReviewedData] = useState<
    RouterOutputs["reportSnapshots"]["compare"] | null
  >(null);
  const [exportMessage, setExportMessage] = useState("");
  const query = trpcReact.reportSnapshots.compare.useQuery(
    { projectId, baselineId, targetId },
    {
      enabled: ordered.length === 2,
      staleTime: 0,
    },
  );
  const data =
    !query.error &&
    !query.isFetching &&
    !query.isPaused &&
    query.data?.projectId === projectId &&
    query.data.baseline.id === baselineId &&
    query.data.target.id === targetId
      ? query.data
      : null;
  const reviewed = !!data && reviewedData === data;
  function download(format: "html" | "csv") {
    if (!data || !reviewed) return;
    let content: string;
    try {
      content =
        format === "csv"
          ? renderReportComparisonCsv(data)
          : renderReportComparisonHtml(data);
    } catch {
      setExportMessage(
        "Unsupported retained values or export size prevented this download. No partial CSV was substituted.",
      );
      return;
    }
    setExportMessage("");
    const url = URL.createObjectURL(
      new Blob([content], {
        type:
          format === "csv"
            ? "text/csv;charset=utf-8"
            : "text/html;charset=utf-8",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `reviewed-snapshot-comparison.${format}`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <Modal
      open
      onClose={onClose}
      title="Compare approved snapshots"
      size="wide"
    >
      {query.error ? (
        <div role="alert">
          <p>{query.error.message}</p>
          <p>No cached comparison has been substituted.</p>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setReviewedData(null);
              setExportMessage("");
              void query.refetch();
            }}
          >
            Retry comparison
          </button>
        </div>
      ) : !data ? (
        <p role="status">
          {query.isPaused
            ? "Waiting to verify access to both reports…"
            : "Checking the two approved captures…"}
        </p>
      ) : (
        <>
          <p>
            Count changes are neutral observations, not automatically
            improvements or regressions.
          </p>
          <p>{data.scopeDescription}</p>
          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(auto-fit,minmax(min(100%,240px),1fr))",
              gap: 12,
            }}
          >
            {(
              [
                ["Earlier baseline", data.baseline],
                ["Later capture", data.target],
              ] as const
            ).map(([label, row]) => (
              <section
                key={label}
                className="card"
                style={{ minWidth: 0, padding: 12, overflowWrap: "anywhere" }}
              >
                <h3>{label}</h3>
                <Link
                  href={`/projects/${encodeURIComponent(projectId)}/reports/snapshots/${encodeURIComponent(row.id)}`}
                >
                  {row.title}
                </Link>
                <p>Captured {new Date(row.asOf).toLocaleString()}</p>
                <small>
                  Execution (UTC): {row.windowStart} through {row.windowEnd}{" "}
                  (inclusive recorded run-start bounds).
                </small>
              </section>
            ))}
          </div>
          <p role="status">
            {data.sameExecutionWindow
              ? "Same original execution window."
              : "Different original execution windows: do not interpret counts as directly equivalent."}
          </p>
          <p>
            Active case identities: {data.cohort.common} in both;{" "}
            {data.cohort.added} added; {data.cohort.removed} no longer active in
            the later cohort.
          </p>
          {data.sections.map((section) => (
            <details
              key={section}
              open={data.sections.length === 1}
              style={{ marginBlock: 12 }}
            >
              <summary>{readableMetric(section)} · recorded comparison</summary>
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
                      <th
                        scope="col"
                        style={{ width: "49%", whiteSpace: "normal" }}
                      >
                        Metric
                      </th>
                      <th scope="col" style={{ whiteSpace: "normal" }}>
                        Baseline
                      </th>
                      <th scope="col" style={{ whiteSpace: "normal" }}>
                        Later
                      </th>
                      <th scope="col" style={{ whiteSpace: "normal" }}>
                        Count change
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows
                      .filter((row) => row.section === section)
                      .map((row) => (
                        <tr key={row.label}>
                          <th scope="row" style={{ whiteSpace: "normal" }}>
                            {row.label}
                            <small
                              className="text-muted"
                              style={{ display: "block", fontWeight: 400 }}
                            >
                              {row.note}
                            </small>
                          </th>
                          <td style={{ whiteSpace: "normal" }}>
                            {row.baseline ?? "Unavailable"}
                          </td>
                          <td style={{ whiteSpace: "normal" }}>
                            {row.target ?? "Unavailable"}
                          </td>
                          <td style={{ whiteSpace: "normal" }}>
                            {row.delta === null
                              ? "Unavailable"
                              : `${row.delta > 0 ? "+" : ""}${row.delta}`}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </details>
          ))}
          <details>
            <summary>Evidence boundaries and export review</summary>
            <ul>
              {data.limitations.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </details>
          {(
            [
              ["Earlier baseline", data.sourceLimitations.baseline],
              ["Later capture", data.sourceLimitations.target],
            ] as const
          ).map(([title, notes]) => (
            <details key={title}>
              <summary>{title} original evidence boundaries</summary>
              <ul>
                {notes.map((note, index) => (
                  <li key={index}>{note}</li>
                ))}
              </ul>
            </details>
          ))}
          <label
            style={{
              display: "flex",
              gap: 8,
              alignItems: "start",
              marginBlock: 16,
            }}
          >
            <input
              type="checkbox"
              checked={reviewed}
              onChange={(event) => {
                setReviewedData(event.target.checked ? data : null);
                setExportMessage("");
              }}
            />
            I reviewed both execution windows, changing cohorts and missing
            evidence. I will check recipients before sharing this internal
            comparison.
          </label>
          <button
            type="button"
            className="btn-secondary"
            disabled={!reviewed}
            onClick={() => download("html")}
          >
            Download reviewed comparison
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={!reviewed}
            onClick={() => download("csv")}
          >
            Download comparison CSV
          </button>
          <p className="text-muted">
            CSV retains exact metric counts, unavailable values, both original
            windows and evidence boundaries. It is not a backup, new approval or
            external access grant. Spreadsheet re-save/import settings may
            remove text formula protections.
          </p>
          {exportMessage && <p role="alert">{exportMessage}</p>}
        </>
      )}
    </Modal>
  );
}
