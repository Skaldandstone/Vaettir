"use client";

import { useState } from "react";

import { DistributionBar } from "./MetricVisuals";
import { renderBoundedSpreadsheetCsv } from "@vaettir/core";
import { downloadFile } from "@/lib/download";
import type { RouterOutputs } from "@/lib/trpcReact";
import { renderCurrentManualRunRecordJson } from "@/lib/manual-run-record-export";
import { renderCurrentManualRunPortableHtml } from "@/lib/manual-run-portable-report";
import type { ManualRunProgress } from "../lib/manual-run-scope-availability";

type Case =
  RouterOutputs["manualExecution"]["getForExecution"]["cases"][number];

// Mount only inside the execution page's current original-workspace read gate.
export function RunExecutionSummary({
  cases,
  runId,
  projectId,
  status,
  executionContext,
  stepFieldLabels,
  canExport,
  plannedScope,
}: {
  cases: Case[];
  runId: string;
  projectId: string;
  status: string;
  executionContext: RouterOutputs["manualExecution"]["getForExecution"]["executionContext"];
  stepFieldLabels: Record<string, string>;
  canExport: () => boolean;
  plannedScope: ManualRunProgress;
}) {
  const [exportError, setExportError] = useState<string | null>(null);
  const displayIds = new Map(
    cases.map((testCase) => [testCase.testCaseId, testCase.displayId]),
  );
  const count = (status: string) =>
    cases.filter((testCase) => testCase.currentResult?.status === status)
      .length;
  const recorded = cases.filter((testCase) => testCase.currentResult).length;
  const remaining = plannedScope.remaining;
  const complete = plannedScope.percentRecorded;
  const completeExportScope = plannedScope.unavailableCaseIds.length === 0;
  return (
    <section className="panel" aria-label="Current run progress">
      <div className="run-card-progress">
        <strong>{complete}% recorded</strong>
        <span>{remaining} left to test</span>
      </div>
      <progress
        aria-label="Recorded case progress"
        max={plannedScope.plannedCount || 1}
        value={recorded}
      />
      <DistributionBar
        label="Current case outcomes"
        segments={[
          { label: "Passed", value: count("PASS"), tone: "success" },
          { label: "Failed", value: count("FAIL"), tone: "danger" },
          { label: "Blocked", value: count("BLOCKED"), tone: "warning" },
          { label: "Skipped", value: count("SKIP"), tone: "neutral" },
          { label: "Flaky", value: count("FLAKY"), tone: "info" },
          {
            label: "Other recorded",
            value:
              recorded -
              ["PASS", "FAIL", "BLOCKED", "SKIP", "FLAKY"].reduce(
                (sum, status) => sum + count(status),
                0,
              ),
            tone: "info",
          },
          { label: "Untested available", value: remaining - plannedScope.unavailableCaseIds.length, tone: "neutral" },
          { label: "Procedure unavailable", value: plannedScope.unavailableCaseIds.length, tone: "warning" },
        ]}
      />
      <p className="text-muted">
        {plannedScope.plannedCount} saved planned identities · {plannedScope.availableCount} available procedures · {plannedScope.unavailableCaseIds.length} unavailable. Missing procedures remain in the denominator, not silently excluded.
      </p>
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
        disabled={!completeExportScope}
        onClick={() => {
          setExportError(null);
          if (!completeExportScope || !canExport()) {
            setExportError(
              "Current original run access must be verified before export.",
            );
            return;
          }
          try {
            const content = renderBoundedSpreadsheetCsv(
                [
                  "Run ID",
                  "Case ID",
                  "Case record ID",
                  "Title",
                  "Domain",
                  "Current outcome",
                  "Procedure steps",
                  "Prerequisite case IDs",
                ],
                cases.map((testCase) => [
                  runId,
                  testCase.displayId ?? testCase.testCaseId,
                  testCase.testCaseId,
                  testCase.title,
                  testCase.validationDomain,
                  testCase.currentResult?.status ?? "UNTESTED",
                  testCase.steps.length,
                  testCase.prerequisiteIds
                    .map((id) => displayIds.get(id) ?? id)
                    .join("; "),
                ]),
              );
            if (!canExport()) throw new Error("Original run access changed. Nothing was exported.");
            downloadFile(`vaettir-run-${runId}.csv`, content, "text/csv", canExport);
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
      <button
        type="button"
        className="btn-secondary"
        disabled={!completeExportScope}
        style={{ marginLeft: 8 }}
        onClick={() => {
          setExportError(null);
          if (!completeExportScope || !canExport()) {
            setExportError(
              "Current original run access must be verified before export.",
            );
            return;
          }
          try {
            const content = renderCurrentManualRunRecordJson({
              runId,
              projectId,
              status,
              executionContext,
              stepFieldLabels,
              cases,
            });
            if (!canExport())
              throw new Error(
                "Original run access changed. Nothing was exported.",
              );
            downloadFile(
              `vaettir-run-${runId}-current-record.json`,
              content,
              "application/json",
              canExport,
            );
          } catch (cause) {
            setExportError(
              cause instanceof Error
                ? cause.message
                : "Current run record could not be exported.",
            );
          }
        }}
      >
        Export procedures and current record · JSON
      </button>
      <button type="button" className="btn-secondary" disabled={!completeExportScope} style={{ marginLeft: 8 }} onClick={() => {
        setExportError(null);
        if (!completeExportScope || !canExport()) { setExportError("Current original run access and complete planned procedure scope must be verified before export."); return; }
        try {
          const content = renderCurrentManualRunPortableHtml({ runId, projectId, status, executionContext, stepFieldLabels, cases });
          if (!canExport()) throw new Error("Original run access changed. Nothing was exported.");
          downloadFile(`vaettir-run-${runId}-report.html`, content, "text/html", canExport);
        } catch (cause) { setExportError(cause instanceof Error ? cause.message : "Current run report could not be exported."); }
      }}>Export printable report · HTML</button>
      <p className="text-muted">
        {!completeExportScope && "Whole-run exports are unavailable while saved planned procedures are missing. No smaller subset is exported. "}
        Exports include the current authorized run, not just search matches.
        JSON preserves present procedures, configuration and observations, not
        full revision history or attachment files. HTML is an offline printable
        report of the same complete current run, not a signed audit. Legacy procedures without a
        saved snapshot may reflect later edits.
      </p>
    </section>
  );
}
