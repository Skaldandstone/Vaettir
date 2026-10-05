"use client";

import { useState } from "react";

import { DistributionBar } from "./MetricVisuals";
import { renderBoundedSpreadsheetCsv } from "@vaettir/core";
import { downloadFile } from "@/lib/download";
import type { RouterOutputs } from "@/lib/trpcReact";

type Case =
  RouterOutputs["manualExecution"]["getForExecution"]["cases"][number];

// Mount only inside the execution page's current original-workspace read gate.
export function RunExecutionSummary({
  cases,
  runId,
}: {
  cases: Case[];
  runId: string;
}) {
  const [exportError, setExportError] = useState<string | null>(null);
  const displayIds = new Map(
    cases.map((testCase) => [testCase.testCaseId, testCase.displayId]),
  );
  const count = (status: string) =>
    cases.filter((testCase) => testCase.currentResult?.status === status)
      .length;
  const recorded = cases.filter((testCase) => testCase.currentResult).length;
  const remaining = cases.length - recorded;
  const complete = cases.length
    ? Math.round((recorded * 100) / cases.length)
    : 0;
  return (
    <section className="panel" aria-label="Current run progress">
      <div className="run-card-progress">
        <strong>{complete}% recorded</strong>
        <span>{remaining} left to test</span>
      </div>
      <progress
        aria-label="Recorded case progress"
        max={cases.length || 1}
        value={recorded}
      />
      <DistributionBar
        label="Current case outcomes"
        segments={[
          { label: "Passed", value: count("PASS"), tone: "success" },
          { label: "Failed", value: count("FAIL"), tone: "danger" },
          { label: "Blocked", value: count("BLOCKED"), tone: "warning" },
          { label: "Skipped", value: count("SKIP"), tone: "neutral" },
          {
            label: "Other recorded",
            value:
              recorded -
              ["PASS", "FAIL", "BLOCKED", "SKIP"].reduce(
                (sum, status) => sum + count(status),
                0,
              ),
            tone: "info",
          },
          { label: "Untested", value: remaining, tone: "neutral" },
        ]}
      />
      <p className="text-muted">
        Recorded progress is not pass rate or release acceptance. Procedures and
        corrections remain in this run’s evidence record.
      </p>
      {exportError && (
        <p role="alert">{exportError} Nothing was silently truncated.</p>
      )}
      <button
        type="button"
        className="btn-secondary"
        onClick={() => {
          setExportError(null);
          try {
            downloadFile(
              `vaettir-run-${runId}.csv`,
              renderBoundedSpreadsheetCsv(
                [
                  "Run ID",
                  "Case ID",
                  "Title",
                  "Domain",
                  "Current outcome",
                  "Procedure steps",
                  "Prerequisite case IDs",
                ],
                cases.map((testCase) => [
                  runId,
                  testCase.displayId ?? "Unavailable",
                  testCase.title,
                  testCase.validationDomain,
                  testCase.currentResult?.status ?? "UNTESTED",
                  testCase.steps.length,
                  testCase.prerequisiteIds
                    .map((id) => displayIds.get(id) ?? "Unavailable")
                    .join("; "),
                ]),
              ),
              "text/csv",
            );
          } catch (cause) {
            setExportError(
              cause instanceof Error
                ? cause.message
                : "Current outcomes could not be exported.",
            );
          }
        }}
      >
        Export current outcomes · CSV
      </button>
    </section>
  );
}
