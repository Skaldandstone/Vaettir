import type { FrozenReportPayload } from "@vaettir/api/src/routers/reportSnapshots";
export type { FrozenReportPayload };
export const REPORT_SECTIONS = [
  "inventory",
  "execution",
  "traceability",
  "defects",
  "automation",
] as const;
export function readableMetric(value: string) {
  return value
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/^./, (first) => first.toUpperCase());
}
export function reportMetricRows(report: FrozenReportPayload) {
  const rows: {
    section: string;
    label: string;
    value: number | string;
    note?: string;
  }[] = [];
  const add = (
    section: string,
    label: string,
    value: number | string,
    note?: string,
  ) => {
    if (
      report.definition.sections.includes(
        section as (typeof REPORT_SECTIONS)[number],
      )
    )
      rows.push({ section, label, value, note });
  };
  add("inventory", "Active cases", report.inventory.active);
  add("inventory", "Risk assessed", report.inventory.riskAssessed);
  add(
    "inventory",
    "Marked flaky",
    report.inventory.flaky,
    "Recorded case flag, not a measured flake rate.",
  );
  for (const row of report.inventory.priority)
    add("inventory", `${readableMetric(row.key)} priority`, row.count);
  add("execution", "Runs in window", report.execution.runs);
  add("execution", "Recorded results", report.execution.results);
  add(
    "execution",
    "Distinct active cases executed",
    `${report.execution.distinctCases} / ${report.inventory.active}`,
    "PASS, FAIL or FLAKY in this window; not a pass rate.",
  );
  add(
    "execution",
    "High / critical priority cases executed",
    `${report.execution.highPriorityExecuted} / ${report.execution.highPriorityCases}`,
    "Priority-based execution coverage, not risk-weighted or release readiness.",
  );
  for (const row of report.execution.outcomes)
    add("execution", `${readableMetric(row.key)} results`, row.count);
  add(
    "traceability",
    "Requirements with an active covering case",
    `${report.traceability.coveredRequirements} / ${report.traceability.requirements}`,
    "Explicit case links only; no execution claim.",
  );
  add(
    "traceability",
    "Active cases with traceability links",
    `${report.traceability.casesWithLinks} / ${report.inventory.active}`,
  );
  add("traceability", "Active traceability links", report.traceability.links);
  if (report.defects) {
    add("defects", "Retained native defect clusters", report.defects.clusters);
    add(
      "defects",
      "Clusters with confirmed task links",
      report.defects.confirmed,
    );
    add(
      "defects",
      "Clusters with suggested task matches",
      report.defects.suggested,
    );
    add("defects", "Unavailable sources", report.defects.unavailableSources);
  } else
    add(
      "defects",
      "Defect evidence",
      "Not imported",
      "No data is not zero defects.",
    );
  for (const row of report.inventory.automation)
    add("automation", `${readableMetric(row.key)} cases`, row.count);
  const change = report.automationChange;
  if (change) {
    add("automation", "Comparable active case identities", change.commonCases);
    add(
      "automation",
      "Became automated",
      change.becameAutomated,
      `Since ${new Date(change.baselineAsOf).toISOString()}. Recorded labels, not verified CI execution.`,
    );
    add("automation", "No longer marked automated", change.noLongerAutomated);
    add(
      "automation",
      "Added / removed active cases",
      `${change.addedCases} / ${change.removedCases}`,
      "Excluded from same-case gains.",
    );
    add(
      "automation",
      "Comparison interval",
      `${change.elapsedDays.toFixed(2)} days`,
    );
    add(
      "automation",
      "Net recorded automation change per 7 days",
      change.elapsedDays >= 1 && change.commonCases > 0
        ? (
            ((change.becameAutomated - change.noLongerAutomated) * 7) /
            change.elapsedDays
          ).toFixed(2)
        : "Comparison interval too short or no comparable cases",
      "Same-case label change normalized by elapsed days; not executed automation or productivity savings.",
    );
  } else
    add(
      "automation",
      "Automation change baseline",
      "No earlier approved snapshot",
      "Capture another snapshot to compare the same case identities.",
    );
  return rows;
}
const escape = (value: unknown) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
/** Portable read-only export contains no raw cohort IDs, source code or scripts. */
export function renderFrozenReportHtml(report: FrozenReportPayload): string {
  const groups = REPORT_SECTIONS.filter((section) =>
    report.definition.sections.includes(section),
  );
  const rows = reportMetricRows(report);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(report.title)}</title><style>body{font:16px/1.5 system-ui;color:#182225;background:#fff;max-width:1100px;margin:40px auto;padding:0 24px}h1{line-height:1.15}small,p{overflow-wrap:anywhere}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:12px;border-bottom:1px solid #c7d0ce}td{font-variant-numeric:tabular-nums}small{display:block;color:#52625c}.note{border-left:4px solid #70957e;padding:12px;background:#edf3ee}section{break-inside:avoid}pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere}@media print{body{margin:0;max-width:none;padding:0}button{display:none}}</style></head><body><header><small>VAETTIR · ${escape(report.projectName)} · ${escape(report.state)}</small><h1>${escape(report.title)}</h1><p>${escape(readableMetric(report.definition.audience))} review · Snapshot ${escape(report.asOf)}</p><p>Execution window: ${escape(report.windowStart)} to ${escape(report.asOf)}. Project-wide scope.</p></header>${[
    ["Summary", report.definition.summary],
    ["Risks and impediments", report.definition.risks],
    ["Next actions", report.definition.nextActions],
  ]
    .map(
      ([title, text]) =>
        `<section><h2>${escape(title)}</h2><pre>${escape(text || "Not provided by report author")}</pre></section>`,
    )
    .join("")}${groups
    .map(
      (section) =>
        `<section><h2>${escape(readableMetric(section))}</h2><table><thead><tr><th scope="col">Metric</th><th scope="col">Recorded value</th></tr></thead><tbody>${rows
          .filter((row) => row.section === section)
          .map(
            (row) =>
              `<tr><th scope="row">${escape(row.label)}${row.note ? `<small>${escape(row.note)}</small>` : ""}</th><td>${escape(row.value)}</td></tr>`,
          )
          .join("")}</tbody></table></section>`,
    )
    .join(
      "",
    )}<section class="note"><h2>Evidence boundaries and missing data</h2><ul>${report.limitations.map((note) => `<li>${escape(note)}</li>`).join("")}</ul><p>Frozen snapshot. Later changes to cases, links or runs do not update these values. Sharing this downloaded file can expose internal project metrics; review recipients first.</p></section></body></html>`;
}
