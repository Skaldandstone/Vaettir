"use client";
import { useState } from "react";
import {
  reportMetricRows,
  REPORT_SECTIONS,
  readableMetric,
  renderFrozenReportHtml,
  reportScopeSummary,
  type FrozenReportPayload,
} from "@/lib/frozen-report";
import { ReportSnapshotEvidence } from "./ReportSnapshotEvidence";
import { REPORT_TEMPLATES } from "@/lib/report-templates";
import { ReportOutcomeChart } from "./ReportOutcomeChart";
import { renderFrozenReportCsv } from "@/lib/report-csv";

export function FrozenReport({
  report,
  allowExport = false,
  projectId,
  snapshotId,
}: {
  report: FrozenReportPayload;
  allowExport?: boolean;
  projectId?: string;
  snapshotId?: string;
}) {
  const rows = reportMetricRows(report);
  const [review, setReview] = useState<{
    report: FrozenReportPayload;
    projectId?: string;
    snapshotId?: string;
  } | null>(null);
  const [exportMessage, setExportMessage] = useState("");
  const reviewed =
    review?.report === report &&
    review.projectId === projectId &&
    review.snapshotId === snapshotId;
  const exportAllowed = allowExport && report.state === "approved";
  function download(format: "html" | "csv") {
    if (!exportAllowed || !reviewed) return;
    let content: string;
    try {
      content =
        format === "csv"
          ? renderFrozenReportCsv(report)
          : renderFrozenReportHtml(report);
    } catch {
      setExportMessage(
        "This retained report exceeds the supported export format or contains unsupported values. No partial CSV was downloaded. Review the snapshot or use another approved format.",
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
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `vaettir-report-${report.asOf.slice(0, 10)}.${format}`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function print() {
    if (!exportAllowed || !reviewed) return;
    // Print only the portable snapshot, not the surrounding workspace/sidebar.
    const frame = document.createElement("iframe");
    frame.title = "Printable frozen report";
    frame.setAttribute("sandbox", "allow-same-origin allow-modals");
    frame.style.cssText =
      "position:fixed;width:1px;height:1px;bottom:0;left:0;border:0";
    const cleanup = () => frame.remove();
    frame.onload = () => {
      frame.contentWindow?.addEventListener("afterprint", cleanup, {
        once: true,
      });
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    };
    frame.srcdoc = renderFrozenReportHtml(report);
    document.body.append(frame);
    window.setTimeout(cleanup, 60000);
  }
  return (
    <article aria-label="Frozen report preview">
      <header>
        <p className="eyebrow">
          {readableMetric(report.definition.audience)} · {report.state}
        </p>
        <h2>{report.title}</h2>
        {report.definition.templateId && (
          <p className="text-muted">
            Started from: {REPORT_TEMPLATES[report.definition.templateId].title}
            . Metric sections and author notes are captured below.
          </p>
        )}
        <p className="text-muted">
          {report.projectName} · Captured{" "}
          {new Date(report.asOf).toLocaleString()}
        </p>
        <p className="text-muted">
          {reportScopeSummary(report)}. Execution (UTC):{" "}
          {report.windowStart.slice(0, 10)} to{" "}
          {(report.windowEnd ?? report.asOf).slice(0, 10)}.
        </p>
        {report.scope && (
          <p className="text-muted">{report.scope.cohortBasis}</p>
        )}
        {projectId && snapshotId ? (
          <ReportSnapshotEvidence
            projectId={projectId}
            snapshotId={snapshotId}
          />
        ) : (
          report.scope && (
            <details>
              <summary>
                Contributing recorded runs (
                {report.scope.contributingRunIds.length})
              </summary>
              <p className="text-muted">
                Stable run references captured with this snapshot. Later run
                observations do not change this report. First 50 references
                shown.
              </p>
              <ul>
                {report.scope.contributingRunIds.slice(0, 50).map((id) => (
                  <li key={id} style={{ overflowWrap: "anywhere" }}>
                    {id}
                  </li>
                ))}
              </ul>
              {!report.scope.contributingRunIds.length && (
                <p>No matching recorded runs. This is not a passing result.</p>
              )}
            </details>
          )
        )}
        {exportAllowed && (
          <section aria-label="Reviewed portable report export">
            <p className="text-muted">
              HTML and print retain authored commentary. Aggregate CSV includes
              selected metrics, exact captured scope/windows and evidence
              boundaries, but no summary, risks or next-action commentary or raw
              entity identities. Captured titles and scope labels are still
              internal text. CSV is not a full-fidelity backup.
            </p>
            <label
              style={{
                display: "flex",
                gap: 8,
                alignItems: "start",
                marginBlock: 12,
              }}
            >
              <input
                type="checkbox"
                checked={reviewed}
                onChange={(event) => {
                  setReview(
                    event.target.checked
                      ? { report, projectId, snapshotId }
                      : null,
                  );
                  setExportMessage("");
                }}
              />
              I reviewed this frozen report, its missing evidence and captured
              text, and will check recipients before downloading or printing.
            </label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <button
                className="btn-secondary"
                type="button"
                disabled={!reviewed}
                onClick={() => download("html")}
              >
                Download HTML
              </button>
              <button
                className="btn-secondary"
                type="button"
                disabled={!reviewed}
                onClick={() => download("csv")}
              >
                Download aggregate CSV
              </button>
              <button
                className="btn-secondary"
                type="button"
                disabled={!reviewed}
                onClick={print}
              >
                Print / save PDF
              </button>
            </div>
            {exportMessage && <p role="alert">{exportMessage}</p>}
          </section>
        )}
      </header>
      {(
        [
          ["Summary", report.definition.summary],
          ["Risks and impediments", report.definition.risks],
          ["Next actions", report.definition.nextActions],
        ] as const
      ).map(([title, text]) => (
        <section key={title}>
          <h3>{title}</h3>
          <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
            {text || "Not provided by report author"}
          </p>
        </section>
      ))}
      {REPORT_SECTIONS.filter((section) =>
        report.definition.sections.includes(section),
      ).map((section) => (
        <section key={section} style={{ marginBlock: 20 }}>
          <h3>{readableMetric(section)}</h3>
          {section === "execution" && <ReportOutcomeChart report={report} />}
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
                    style={{ width: "68%", whiteSpace: "normal" }}
                  >
                    Metric
                  </th>
                  <th
                    scope="col"
                    style={{ width: "32%", whiteSpace: "normal" }}
                  >
                    Recorded value
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows
                  .filter((row) => row.section === section)
                  .map((row) => (
                    <tr key={row.label}>
                      <th scope="row" style={{ whiteSpace: "normal" }}>
                        {row.label}
                        {row.note && (
                          <small
                            className="text-muted"
                            style={{ display: "block", fontWeight: 400 }}
                          >
                            {row.note}
                          </small>
                        )}
                      </th>
                      <td
                        style={{
                          fontVariantNumeric: "tabular-nums",
                          whiteSpace: "normal",
                        }}
                      >
                        {row.value}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      <details>
        <summary>Evidence boundaries and missing data</summary>
        <ul>
          {report.limitations.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
        <p>
          This snapshot never updates itself. Downloaded files contain internal
          project metrics; review recipients before sharing.
        </p>
      </details>
    </article>
  );
}
