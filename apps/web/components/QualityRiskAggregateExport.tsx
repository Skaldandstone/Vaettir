"use client";
import { useEffect, useRef, useState } from "react";
import { renderBoundedSpreadsheetCsv } from "@vaettir/core";
import { type RouterOutputs } from "@/lib/trpcReact";
import {
  qualityRiskAggregateCsvPlan,
  riskAggregateBoundaries,
  type RiskAggregateFilter,
} from "@/lib/quality-risk-aggregate-csv";
import { Modal } from "./Modal";
import { renderQualityRiskAggregateHtml } from "@/lib/quality-risk-aggregate-html";
type Summary = RouterOutputs["qualityRiskOverview"]["summary"];
export function QualityRiskAggregateExport({
  current,
  filters,
  available,
  revision,
}: {
  current: Summary | null;
  filters: RiskAggregateFilter;
  available: boolean;
  revision: number;
}) {
  const [open, setOpen] = useState(false),
    [format, setFormat] = useState<"CSV" | "HTML">("CSV"),
    [reviewed, setReviewed] = useState<Summary | null>(null),
    [reviewedScope, setReviewedScope] = useState(""),
    [message, setMessage] = useState("");
  const active =
    available && Number.isFinite(revision) && revision > 0 ? current : null;
  // Filter key is local review identity only. It is never exported or hashed remotely.
  const scopeKey = JSON.stringify({ filters, format });
  const epoch = useRef(0),
    previous = useRef({ active, scopeKey, open, revision });
  if (
    previous.current.active !== active ||
    previous.current.scopeKey !== scopeKey ||
    previous.current.open !== open ||
    previous.current.revision !== revision
  ) {
    epoch.current++;
    previous.current = { active, scopeKey, open, revision };
  }
  const [reviewedEpoch, setReviewedEpoch] = useState(-1);
  const live = useRef({ active, scopeKey, open, epoch: epoch.current });
  live.current = { active, scopeKey, open, epoch: epoch.current };
  useEffect(() => {
    setReviewed(null);
    setReviewedScope("");
    setReviewedEpoch(-1);
  }, [active, scopeKey, open, revision]);
  useEffect(
    () => () => {
      live.current = { active: null, scopeKey: "", open: false, epoch: -1 };
    },
    [],
  );
  const canExport =
    !!active &&
    reviewed === active &&
    reviewedScope === scopeKey &&
    reviewedEpoch === epoch.current &&
    open;
  function download() {
    if (!canExport || !active) return;
    try {
      const plan = qualityRiskAggregateCsvPlan(active, filters);
      const encoded =
        format === "CSV"
          ? renderBoundedSpreadsheetCsv(plan.headers, plan.rows)
          : renderQualityRiskAggregateHtml(plan);
      if (
        live.current.active !== active ||
        live.current.scopeKey !== scopeKey ||
        !live.current.open ||
        live.current.epoch !== reviewedEpoch
      )
        return;
      // Consume this reviewed action before browser side effects; another click needs review again.
      live.current.open = false;
      setReviewed(null);
      const anchor = document.createElement("a");
      const url = URL.createObjectURL(
        new Blob([encoded], {
          type:
            format === "CSV"
              ? "text/csv;charset=utf-8"
              : "text/html;charset=utf-8",
        }),
      );
      try {
        anchor.href = url;
        anchor.download = `vaettir-human-risk-aggregates-${active.observedAt.slice(0, 10)}.${format === "CSV" ? "csv" : "html"}`;
        document.body.appendChild(anchor);
        anchor.click();
      } finally {
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      setOpen(false);
      setReviewed(null);
      setMessage(
        "Aggregate file prepared. Check your browser downloads and review recipient suitability; no external access was granted.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The aggregate export could not be prepared. No counts were substituted.",
      );
    }
  }
  return (
    <>
      <button
        type="button"
        className="btn-secondary"
        disabled={!active}
        onClick={() => {
          setReviewed(null);
          setMessage("");
          setOpen(true);
        }}
      >
        Export reviewed risk overview
      </button>
      {active && message && <p role="status">{message}</p>}
      <Modal
        open={open}
        onClose={() => {
          live.current.open = false;
          setOpen(false);
          setReviewed(null);
        }}
        title="Review human risk aggregate export"
      >
        {!active ? (
          <p role="alert">
            Current original-organization and signed-in actor access must be
            reverified. Retained aggregate data is hidden; this export cannot
            proceed.
          </p>
        ) : (
          <>
            <p>
              {active.population.entries} full project entries;{" "}
              {active.filtered.entries} in the applied filtered cohort. Observed
              UTC {active.observedAt}.
            </p>
            <p>
              Includes complete category and reference-availability counts for
              both populations, not just the visible twenty-row page. No
              per-entry content or literal search text is exported.
            </p>
            <label style={{ display: "grid", gap: 6, marginBlock: 12 }}>
              File format
              <select
                value={format}
                onChange={(event) => {
                  if (
                    event.target.value === "CSV" ||
                    event.target.value === "HTML"
                  )
                    setFormat(event.target.value);
                }}
              >
                <option value="CSV">CSV for spreadsheets</option>
                <option value="HTML">
                  Portable HTML for stakeholder review and printing
                </option>
              </select>
            </label>
            {format === "HTML" && (
              <p>
                Text-only offline report with full and filtered counts and
                evidence boundaries. Open the downloaded file and use your
                browser's Print command for PDF. No approved snapshot, PDF or
                delivery is created.
              </p>
            )}
            <ul>
              {riskAggregateBoundaries.map((boundary) => (
                <li key={boundary}>{boundary}</li>
              ))}
            </ul>
            <details>
              <summary>Applied categories and retained source limits</summary>
              <dl>
                {Object.entries(filters)
                  .filter(([key]) => key !== "search")
                  .map(([key, value]) => (
                    <div key={key}>
                      <dt>{key}</dt>
                      <dd>{value || "ANY"}</dd>
                    </div>
                  ))}
              </dl>
              <p>
                Search:{" "}
                {filters.search
                  ? "Applied; literal text omitted from CSV"
                  : "Not applied"}
                .
              </p>
              <ul>
                {active.limits.map((boundary) => (
                  <li key={boundary}>{boundary}</li>
                ))}
              </ul>
            </details>
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
                checked={canExport}
                onChange={(event) => {
                  setReviewed(event.target.checked ? active : null);
                  setReviewedScope(event.target.checked ? scopeKey : "");
                  setReviewedEpoch(event.target.checked ? epoch.current : -1);
                }}
              />
              I reviewed these exact current aggregate counts, applied
              categories, observation time, file format and sharing limitations.
            </label>
          </>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              live.current.open = false;
              setOpen(false);
              setReviewed(null);
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!canExport}
            onClick={download}
          >
            Prepare reviewed file
          </button>
        </div>
      </Modal>
    </>
  );
}
