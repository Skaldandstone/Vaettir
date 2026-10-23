import type { ApprovedReportComparison } from "@vaettir/api/src/services/reportComparison";
import {
  reportMetricRows,
  reportScopeSummary,
  type FrozenReportPayload,
} from "./frozen-report.ts";
import {
  renderBoundedSpreadsheetCsv as csv,
  type SpreadsheetCsvCell as CsvCell,
} from "@vaettir/core";

/** Approved, selected aggregate metrics only. No author commentary/raw identities. */
export function renderFrozenReportCsv(report: FrozenReportPayload) {
  if (report.state !== "approved")
    throw new Error("Approve the frozen snapshot before aggregate CSV export.");
  const rows: CsvCell[][] = [];
  const metadata = (label: string, value: CsvCell, note = "") =>
    rows.push(["Metadata", "", label, value, note]);
  metadata("Export format", "Vaettir approved aggregate snapshot CSV v1");
  metadata("Project", report.projectName);
  metadata("Report title", report.title);
  metadata("Audience", report.definition.audience);
  metadata("Captured at (UTC)", report.asOf);
  metadata("Execution window start (UTC)", report.windowStart);
  metadata(
    "Execution window end (UTC)",
    report.windowEnd ?? report.asOf,
    "Inclusive stored run-start bounds; this is not a per-result recorded timestamp.",
  );
  metadata("Scope", reportScopeSummary(report, true));
  if (report.scope) metadata("Cohort basis", report.scope.cohortBasis);
  metadata("Selected sections", report.definition.sections.join("; "));
  for (const metric of reportMetricRows(report))
    rows.push([
      "Metric",
      metric.section,
      metric.label,
      metric.value,
      metric.note ?? "",
    ]);
  for (const limitation of report.limitations)
    rows.push([
      "Evidence boundary",
      "",
      "Retained snapshot limitation",
      "",
      limitation,
    ]);
  rows.push([
    "Export boundary",
    "",
    "Frozen internal aggregates",
    "",
    "This file never refreshes itself. Author summary/risks/next-actions and raw case/run/plan/cohort identities are not included. Authored titles and captured scope labels are retained; review them and recipients before sharing. This does not grant workspace or external recipient access.",
  ]);
  rows.push([
    "Export boundary",
    "",
    "Spreadsheet text safety",
    "",
    "Dangerous leading text is prefixed with an apostrophe; numbers remain numeric. Spreadsheet re-save/import settings may remove that protection. Missing evidence remains explicit text, not zero.",
  ]);
  return csv(
    ["Row type", "Section", "Label", "Recorded value", "Evidence note"],
    rows,
  );
}

/** Server-authorized neutral comparison; missing values never become zero. */
export function renderReportComparisonCsv(value: ApprovedReportComparison) {
  const rows: CsvCell[][] = [];
  const meta = (label: string, before: CsvCell, after: CsvCell, note = "") =>
    rows.push(["Metadata", "", label, before, after, "", note]);
  meta("Export format", "Vaettir approved snapshot comparison CSV v1", "");
  meta("Capture title", value.baseline.title, value.target.title);
  meta("Captured at (UTC)", value.baseline.asOf, value.target.asOf);
  meta(
    "Execution window start (UTC)",
    value.baseline.windowStart,
    value.target.windowStart,
  );
  meta(
    "Execution window end (UTC)",
    value.baseline.windowEnd,
    value.target.windowEnd,
    "Inclusive stored run-start bounds, not inferred result-recorded timestamps.",
  );
  meta("Scope", value.scopeDescription, value.scopeDescription);
  meta(
    "Same execution window",
    value.sameExecutionWindow ? "Yes" : "No",
    "",
    value.sameExecutionWindow
      ? "Same original interval does not prove equivalent historical tests."
      : "Unequal execution windows; counts are not directly equivalent.",
  );
  meta(
    "Common active case identities",
    value.cohort.common,
    value.cohort.common,
  );
  meta("Added active identities in later capture", "", value.cohort.added);
  meta("Removed active identities in later capture", value.cohort.removed, "");
  for (const metric of value.rows)
    rows.push([
      "Metric",
      metric.section,
      metric.label,
      metric.baseline ?? "Unavailable",
      metric.target ?? "Unavailable",
      metric.delta ?? "Unavailable",
      metric.note,
    ]);
  for (const [label, notes] of [
    ["Comparison", value.limitations],
    ["Earlier baseline", value.sourceLimitations.baseline],
    ["Later capture", value.sourceLimitations.target],
  ] as const)
    for (const note of notes)
      rows.push(["Evidence boundary", "", label, "", "", "", note]);
  rows.push([
    "Export boundary",
    "",
    "Internal neutral count comparison",
    "",
    "",
    "",
    "Count changes are not automatically improvements, regressions or verified repairs. No raw case/run/plan/cohort/snapshot identities or author commentary are exported. Retained titles/scope labels are internal text; review recipients. This is neither a new stored approval nor an external access grant.",
  ]);
  rows.push([
    "Export boundary",
    "",
    "Spreadsheet text safety",
    "",
    "",
    "",
    "Dangerous leading text uses an apostrophe; legitimate numeric changes remain numeric, including negative values. Re-saving/import settings may remove protections. Unavailable is not zero.",
  ]);
  return csv(
    [
      "Row type",
      "Section",
      "Label",
      "Baseline",
      "Later capture",
      "Count change",
      "Evidence note",
    ],
    rows,
  );
}
