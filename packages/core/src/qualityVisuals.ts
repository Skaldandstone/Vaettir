/** Vaettir owns chart semantics. Integrations receive this display-only model. */
export type QualityVisual = {
  id: string;
  title: string;
  kind: "donut" | "bars";
  unit: string;
  note: string;
  empty: string;
  rows: Array<{ label: string; value: number; color: string }>;
};
export type QualityVisualReport = { version: 1; charts: QualityVisual[] };

/** Portable report charts use the same display model as the application.
 * Only escaped text, validated colors and numeric geometry enter the markup.
 * No source records, scripts, links or external assets are included.
 */
export function renderQualityVisualReportHtml(
  model: QualityVisualReport,
): string {
  const escape = (value: string) =>
    value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  const color = (value: string) =>
    /^#[a-f\d]{6}$/i.test(value) ? value : "#697F98";
  return `<div class="quality-visual-report">${model.charts
    .map((chart) => {
      const rows = chart.rows.filter(
        (row) => Number.isSafeInteger(row.value) && row.value > 0,
      );
      const total = rows.reduce((sum, row) => sum + row.value, 0);
      const max = Math.max(1, ...rows.map((row) => row.value));
      let offset = 0;
      const shape =
        chart.kind === "donut"
          ? `<svg viewBox="0 0 240 220" role="img" aria-label="${escape(total ? `${chart.title}: ${rows.map((row) => `${row.label} ${row.value}`).join(", ")}` : chart.empty)}"><circle cx="120" cy="106" r="76" fill="none" stroke="var(--line)" stroke-width="24"/>${rows
              .map((row) => {
                const length = (row.value / total) * 100,
                  start = offset;
                offset += length;
                return `<circle cx="120" cy="106" r="76" fill="none" stroke="${color(row.color)}" stroke-width="24" pathLength="100" stroke-dasharray="${length} ${100 - length}" stroke-dashoffset="${-start}" transform="rotate(-90 120 106)"/>`;
              })
              .join(
                "",
              )}<text x="120" y="108" text-anchor="middle" fill="currentColor" font-size="32" font-weight="650">${total ? total.toLocaleString() : "—"}</text><text x="120" y="132" text-anchor="middle" fill="currentColor" font-size="12">${escape(total ? chart.unit : "No data")}</text></svg>`
          : `<svg viewBox="0 0 400 ${Math.max(150, rows.length * 52)}" role="img" aria-label="${escape(chart.title)}">${rows.map((row, index) => `<g transform="translate(0 ${index * 52})"><text x="0" y="15" fill="currentColor" font-size="13">${escape(row.label)}</text><text x="398" y="15" text-anchor="end" fill="currentColor" font-size="13">${row.value}</text><rect x="0" y="24" width="400" height="13" rx="6" fill="var(--line)"/><rect x="0" y="24" width="${(row.value / max) * 400}" height="13" rx="6" fill="${color(row.color)}"/></g>`).join("")}</svg>`;
      return `<figure class="quality-visual" data-chart-id="${escape(chart.id)}"><figcaption><h3>${escape(chart.title)}</h3></figcaption>${shape}${total ? `<ul class="quality-visual-legend">${rows.map((row) => `<li><span><i style="background:${color(row.color)}"></i>${escape(row.label)}</span><strong>${row.value.toLocaleString()}</strong></li>`).join("")}</ul>` : `<p>${escape(chart.empty)}</p>`}<p class="text-muted"><small>${escape(chart.note)}</small></p></figure>`;
    })
    .join("")}</div>`;
}

/** Self-contained light/print styling; geometry and exact legends match the UI. */
export const QUALITY_VISUAL_REPORT_CSS = `
.quality-visual-report{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));gap:20px;margin-block:24px;align-items:stretch}
.quality-visual{margin:0;padding:22px;min-width:0;border:1px solid var(--line);border-radius:16px;background:var(--panel);break-inside:avoid}
.quality-visual h3{margin:0 0 12px}.quality-visual svg{width:100%;max-height:250px;display:block}
.quality-visual-legend{list-style:none;padding:0;margin:12px 0}.quality-visual-legend li{display:flex;justify-content:space-between;gap:16px;margin:8px 0}
.quality-visual-legend li span{display:flex;gap:8px;align-items:center;min-width:0;overflow-wrap:anywhere}.quality-visual-legend strong{font-variant-numeric:tabular-nums}
.quality-visual-legend i{width:10px;height:10px;flex-shrink:0;border-radius:50%}
@media print{.quality-visual-report{grid-template-columns:repeat(2,minmax(0,1fr))}.quality-visual{padding:14px;border-radius:8px;print-color-adjust:exact;-webkit-print-color-adjust:exact}}
`;
type Count = { key: string; count: number };
export type QualityVisualSource = {
  definition?: { sections: readonly string[] };
  inventory: { active: number; automation?: Count[]; priority?: Count[] };
  execution: {
    results: number;
    outcomes: Count[];
    distinctCases: number;
    plannedCaseRunPairs?: number;
    notRecordedCaseRunPairs?: number;
  };
  traceability?: { requirements: number; coveredRequirements: number };
};
const palette: Record<string, string> = {
  PASS: "#16856A",
  FAIL: "#D04443",
  BLOCKED: "#A66B08",
  FLAKY: "#8264CF",
  SKIP: "#7D8B9D",
  SKIPPED: "#7D8B9D",
  MIXED: "#A66B08",
  AMBIGUOUS: "#697F98",
  NOT_RECORDED: "#B5C0D0",
  AUTOMATED: "#337CB8",
  MANUAL: "#8264CF",
  PARTIALLY_AUTOMATED: "#278E93",
  NEEDS_AUTOMATION: "#A66B08",
  CRITICAL: "#D04443",
  HIGH: "#C57827",
  MEDIUM: "#337CB8",
  LOW: "#7D8B9D",
};
const count = (n: number) => Number.isSafeInteger(n) && n >= 0;
const label = (s: string) =>
  s
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase());
function distribution(
  id: string,
  title: string,
  unit: string,
  rows: Count[] | undefined,
  note: string,
  kind: QualityVisual["kind"] = "donut",
): QualityVisual {
  return {
    id,
    title,
    unit,
    kind,
    note,
    empty: `No ${unit} recorded in this capture.`,
    rows: (rows ?? [])
      .filter((r) => count(r.count) && r.count > 0)
      .map((r) => ({
        label: label(r.key),
        value: r.count,
        color: palette[r.key] ?? "#697F98",
      })),
  };
}
function coverage(
  id: string,
  title: string,
  done: number | undefined,
  total: number | undefined,
  complete: string,
  remaining: string,
  note: string,
  unit = "cases",
): QualityVisual {
  const valid =
    total !== undefined &&
    done !== undefined &&
    count(total) &&
    count(done) &&
    total > 0 &&
    done <= total;
  return {
    id,
    title,
    unit,
    kind: "donut",
    note,
    empty:
      total === 0
        ? "No items in this capture's scope."
        : "Coverage was not captured or its counts are inconsistent.",
    rows: valid
      ? [
          { label: complete, value: done, color: "#337CB8" },
          { label: remaining, value: total - done, color: "#B5C0D0" },
        ].filter((r) => r.value > 0)
      : [],
  };
}
export function buildQualityVisualReport(
  source: QualityVisualSource,
): QualityVisualReport {
  // Legacy captures without a retained definition expose only their existing execution projection.
  const sections = new Set(source.definition?.sections ?? ["execution"]);
  const charts: QualityVisual[] = [];
  if (sections.has("automation"))
    charts.push(
      distribution(
        "automation",
        "Automation mix",
        "cases",
        source.inventory.automation,
        "Recorded case labels; not verified automation runs.",
      ),
    );
  if (sections.has("execution")) {
    charts.push(
      distribution(
        "outcomes",
        "Recorded outcomes",
        "observations",
        source.execution.outcomes,
        "Repeated observations count separately; this is not a release-readiness score.",
      ),
    );
    charts.push(
      coverage(
        "coverage",
        "Case execution coverage",
        source.execution.distinctCases,
        source.inventory.active,
        "Executed",
        "No execution recorded",
        "Distinct active cases with Pass, Fail or Flaky in the captured window.",
      ),
    );
    const { plannedCaseRunPairs: planned, notRecordedCaseRunPairs: remaining } =
      source.execution;
    charts.push(
      coverage(
        "plan-progress",
        "Planned execution",
        planned !== undefined && remaining !== undefined
          ? planned - remaining
          : undefined,
        planned,
        "Result recorded",
        "Awaiting result",
        "Planned case/run pairs. A recorded result may be blocked or skipped.",
        "case/run pairs",
      ),
    );
  }
  if (sections.has("inventory"))
    charts.push(
      distribution(
        "priority",
        "Test priority",
        "cases",
        source.inventory.priority,
        "Captured priority assignments.",
        "bars",
      ),
    );
  if (sections.has("traceability"))
    charts.push(
      coverage(
        "requirements",
        "Requirement coverage",
        source.traceability?.coveredRequirements,
        source.traceability?.requirements,
        "Linked to tests",
        "No test link",
        "Explicit test links; a link does not establish a passing result.",
        "requirements",
      ),
    );
  return { version: 1, charts };
}
export function buildReleaseVisualReport(source: {
  counts: {
    planned: number;
    recorded: number;
    pass: number;
    fail: number;
    blocked: number;
    skipped: number;
    flaky: number;
    mixed: number;
    ambiguous: number;
    notRecorded: number;
  };
  risks: Array<{ severity: string; count: number }>;
}): QualityVisualReport {
  const keys = [
    "pass",
    "fail",
    "blocked",
    "skipped",
    "flaky",
    "mixed",
    "ambiguous",
    "notRecorded",
  ] as const;
  return {
    version: 1,
    charts: [
      coverage(
        "release-progress",
        "Release validation progress",
        source.counts.recorded,
        source.counts.planned,
        "Result recorded",
        "Awaiting result",
        "Latest recorded outcome per planned test; recorded does not mean passed.",
      ),
      distribution(
        "release-outcomes",
        "Release test outcomes",
        "tests",
        keys.map((key) => ({
          key: key === "notRecorded" ? "NOT_RECORDED" : key.toUpperCase(),
          count: source.counts[key],
        })),
        "Latest outcomes in the selected release cohort.",
      ),
      distribution(
        "release-risks",
        "Unresolved release risks",
        "risks",
        source.risks.map((r) => ({ key: r.severity, count: r.count })),
        "Recorded unresolved risks by severity; no calculated readiness score.",
        "bars",
      ),
    ],
  };
}
