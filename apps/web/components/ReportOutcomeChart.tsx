"use client";

import { reportOutcomeChart } from "@/lib/frozen-report";
import type { FrozenReportPayload } from "@/lib/frozen-report";

export function ReportOutcomeChart({
  report,
}: {
  report: FrozenReportPayload;
}) {
  const chart = reportOutcomeChart(report);
  if (!chart) return null;
  return (
    <div style={{ marginBlock: 16 }}>
      <h4>Recorded outcomes</h4>
      <p className="text-muted">
        {chart.recordedResults} recorded results in the selected window.
      </p>
      {chart.rows.length ? (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {chart.rows.map((row, index) => (
            <li key={`${row.key}-${index}`} style={{ marginBlock: 12 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                }}
              >
                <span style={{ overflowWrap: "anywhere" }}>{row.label}</span>
                <strong style={{ fontVariantNumeric: "tabular-nums" }}>
                  {row.count}
                </strong>
              </div>
              <div
                aria-hidden="true"
                style={{
                  height: 8,
                  background: "var(--line)",
                  marginTop: 4,
                  borderRadius: 4,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    background: "var(--frost)",
                    width: `${row.width}%`,
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p>
          No recorded outcomes in this window. This is not a passing result.
        </p>
      )}
      <p className="text-muted">
        <small>{chart.note}</small>
      </p>
    </div>
  );
}
