"use client";
import {
  reportMetricRows,
  REPORT_SECTIONS,
  readableMetric,
  renderFrozenReportHtml,
  type FrozenReportPayload,
} from "@/lib/frozen-report";

export function FrozenReport({
  report,
  allowExport = false,
}: {
  report: FrozenReportPayload;
  allowExport?: boolean;
}) {
  const rows = reportMetricRows(report);
  function download() {
    const url = URL.createObjectURL(
      new Blob([renderFrozenReportHtml(report)], {
        type: "text/html;charset=utf-8",
      }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `vaettir-report-${report.asOf.slice(0, 10)}.html`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function print() {
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
        <p className="text-muted">
          {report.projectName} · Captured{" "}
          {new Date(report.asOf).toLocaleString()}
        </p>
        <p className="text-muted">
          Project-wide scope. Execution:{" "}
          {new Date(report.windowStart).toLocaleDateString()} to{" "}
          {new Date(report.asOf).toLocaleDateString()}.
        </p>
        {allowExport && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button className="btn-secondary" type="button" onClick={download}>
              Download HTML
            </button>
            <button className="btn-secondary" type="button" onClick={print}>
              Print / save PDF
            </button>
          </div>
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
