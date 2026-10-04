import type { RecordedExecutionTrend } from "@vaettir/api/src/services/recordedExecutionTrendSchema";
import type {
  ExecutionTrendPeriod,
  ExecutionTrendGrouping,
} from "./recorded-execution-trend";
const outcomes = ["PASS", "FAIL", "FLAKY", "SKIP", "BLOCKED"] as const;
const colors = ["#70957e", "#c67969", "#b59a64", "#7b8991", "#8e7faf"];
const keys = [
  "runs",
  "results",
  "mapped",
  "unmatched",
  "unavailableMapping",
  "inProgressRuns",
  "finishedRecordedRuns",
  "completionUnavailableRuns",
  "inProgressResults",
  "timedResults",
  "missingDurations",
  "invalidDurations",
  "sumDurationMs",
] as const;
const refuse = (): never => {
  throw Error(
    "Complete portable recorded-outcome evidence is inconsistent or exceeds supported bounds. Nothing was prepared.",
  );
};
const entities: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
function escape(value: string | number) {
  const text = String(value);
  if (
    text.length > 4000 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text) ||
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(
      text,
    )
  )
    refuse();
  return text.replace(/[&<>"']/g, (c) => entities[c]!);
}
const date = (text: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(text) &&
  Number.isFinite(Date.parse(text)) &&
  new Date(text).toISOString().slice(0, 10) === text;
const instant = (text: string) =>
  Number.isFinite(Date.parse(text)) && new Date(text).toISOString() === text;
/** Caller first validates complete UTC days with executionTrendPeriods. Text only;
 * raw native identities and per-run content are never projected. */
export function renderRecordedExecutionPortableHtml(
  value: RecordedExecutionTrend,
  periods: ExecutionTrendPeriod[],
  grouping: ExecutionTrendGrouping,
  includeDuration: boolean,
) {
  if (
    (grouping !== "DAY" && grouping !== "WEEK") ||
    typeof includeDuration !== "boolean" ||
    !periods.length ||
    periods.length > 90 ||
    !instant(value.asOf) ||
    !instant(value.windowStart) ||
    !instant(value.windowEnd) ||
    !date(value.scope.start) ||
    !date(value.scope.end) ||
    value.scope.start > value.scope.end ||
    Date.parse(value.scope.end) - Date.parse(value.scope.start) >=
      90 * 86400000 ||
    !Array.isArray(value.limitations) ||
    value.limitations.length > 12 ||
    value.limitations.some(
      (limit) => typeof limit !== "string" || limit.length > 4000,
    )
  )
    refuse();
  if (
    periods[0]!.start !== value.scope.start ||
    periods.at(-1)!.end !== value.scope.end ||
    Date.parse(value.windowStart) !== Date.parse(value.scope.start) ||
    Date.parse(value.windowEnd) < Date.parse(value.scope.end) ||
    Date.parse(value.windowEnd) > Date.parse(value.scope.end) + 86400000 - 1 ||
    Date.parse(value.windowEnd) > Date.parse(value.asOf)
  )
    refuse();
  for (const [index, period] of periods.entries()) {
    if (
      !date(period.start) ||
      !date(period.end) ||
      period.start > period.end ||
      typeof period.partialWeek !== "boolean" ||
      (index &&
        Date.parse(period.start) !==
          Date.parse(periods[index - 1]!.end) + 86400000) ||
      (grouping === "DAY" &&
        (period.start !== period.end || period.partialWeek)) ||
      keys.some(
        (key) =>
          !Number.isSafeInteger(period[key]) ||
          period[key] < 0 ||
          (key !== "sumDurationMs" && period[key] > 100000),
      ) ||
      outcomes.some(
        (key) =>
          !Number.isSafeInteger(period.outcomes[key]) ||
          period.outcomes[key] < 0 ||
          period.outcomes[key] > 100000,
      ) ||
      period.results !==
        outcomes.reduce((sum, key) => sum + period.outcomes[key], 0) ||
      period.results !==
        period.mapped + period.unmatched + period.unavailableMapping ||
      period.results !==
        period.timedResults +
          period.missingDurations +
          period.invalidDurations ||
      period.runs !==
        period.inProgressRuns +
          period.finishedRecordedRuns +
          period.completionUnavailableRuns ||
      period.inProgressResults > period.results ||
      (!period.inProgressRuns && period.inProgressResults) ||
      (!period.runs && period.results) ||
      (!period.timedResults && period.sumDurationMs)
    )
      refuse();
    if (grouping === "WEEK") {
      const start = new Date(`${period.start}T00:00:00.000Z`);
      const monday = start.getTime() - ((start.getUTCDay() + 6) % 7) * 86400000;
      const weekEnd = monday + 7 * 86400000 - 1;
      const includedDays =
        (Date.parse(period.end) - Date.parse(period.start)) / 86400000 + 1;
      if (
        !date(period.key) ||
        period.key !== new Date(monday).toISOString().slice(0, 10) ||
        Date.parse(period.end) > weekEnd ||
        period.partialWeek !==
          (includedDays !== 7 || Date.parse(value.windowEnd) < weekEnd)
      )
        refuse();
    }
  }
  if (
    keys.some(
      (key) =>
        !Number.isSafeInteger(value.totals[key]) ||
        value.totals[key] !== periods.reduce((sum, row) => sum + row[key], 0),
    ) ||
    outcomes.some(
      (key) =>
        value.totals.outcomes[key] !==
        periods.reduce((sum, row) => sum + row.outcomes[key], 0),
    )
  )
    refuse();
  const dates = (period: ExecutionTrendPeriod) =>
    `${period.start}${period.end !== period.start ? ` through ${period.end}` : ""}${period.partialWeek ? " · Partial UTC week" : ""}`;
  const largest = Math.max(...periods.map((row) => row.results));
  const maximum = Math.max(1, largest);
  const table = (headings: string[], rows: Array<Array<string | number>>) =>
    `<div class="scroll"><table><thead><tr>${headings.map((h) => `<th scope="col">${escape(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell, index) => (index ? `<td>${escape(cell)}</td>` : `<th scope="row">${escape(cell)}</th>`)).join("")}</tr>`).join("")}</tbody></table></div>`;
  const rows = periods.map((period) => [
    dates(period),
    period.runs,
    period.results,
    period.mapped,
    period.unmatched,
    period.unavailableMapping,
    period.inProgressRuns,
    ...outcomes.map((key) => period.outcomes[key]),
  ]);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>Recorded execution over time | Vaettir</title><style>body{font:16px/1.5 system-ui;color:#182225;background:white;max-width:1200px;margin:32px auto;padding:0 20px}h1{line-height:1.15}p,li,td,th{overflow-wrap:anywhere}table{width:100%;border-collapse:collapse}th,td{text-align:left;vertical-align:top;padding:8px;border-bottom:1px solid #c7d0ce}td{font-variant-numeric:tabular-nums}.scroll{overflow:auto}.boundary{border-left:4px solid #70957e;background:#edf3ee;padding:16px}section{margin-top:24px}.bar{height:10px;display:flex;background:#edf3ee}.summary{display:flex;flex-wrap:wrap;gap:24px}thead{display:table-header-group}tr{break-inside:avoid}@media print{body{margin:0;padding:0;max-width:none}.scroll{overflow:visible}th,td{padding:4px;font-size:11px}.boundary{break-inside:avoid}}</style></head><body><header><small>VAETTIR · Read-time recorded outcomes · Portable HTML v1</small><h1>Execution over time</h1><p>Read at UTC ${escape(value.asOf)}. UTC run-start window ${escape(value.windowStart)} through ${escape(value.windowEnd)}.</p><div class="summary"><p><strong>${escape(value.totals.runs)}</strong> recorded runs</p><p><strong>${escape(value.totals.results)}</strong> result observations</p><p><strong>${escape(value.totals.inProgressRuns)}</strong> in-progress runs</p></div></header><section class="boundary"><h2>Evidence and sharing boundaries</h2><p>Read-time aggregates, not an immutable approved stakeholder snapshot. Repeated observations are not unique attempts, a measured flake rate, normalized velocity, regression detection or a release verdict. Partial UTC weeks are not normalized. Numeric counts are authoritative.</p><ul>${value.limitations.map((note) => `<li>${escape(note)}</li>`).join("")}</ul><p>Raw actor, organization, case and run identities, source, notes and errors are omitted. Exact recorded scope labels can be internal; review recipient suitability. This downloaded file grants no access. Use your browser's Print command for PDF; Vaettir has not generated or delivered a PDF.</p></section><section><h2>Applied recorded scope</h2>${table(
    ["Filter", "Recorded value"],
    [
      [
        "Grouping",
        grouping === "DAY"
          ? "UTC days"
          : "UTC weeks starting Monday; actual included dates",
      ],
      ["Platform", value.scope.platform ?? "No platform filter"],
      ["Environment", value.scope.environment ?? "No environment filter"],
      ["Build", value.scope.build ?? "No build filter"],
    ],
  )}</section><section><h2>Recorded outcome distribution</h2><p>Bars share the largest included period result total (${largest}). Color is supplementary; exact counts are in the complete table below. Zero bins follow a successful complete read, not a passing test or assurance finding.</p>${periods.map((period) => `<div><p>${escape(dates(period))} · ${period.results} observations</p><div class="bar" aria-hidden="true">${outcomes.map((key, index) => `<span style="width:${(100 * period.outcomes[key]) / maximum}%;background:${colors[index]}"></span>`).join("")}</div></div>`).join("")}${table(["Included UTC dates", "Runs", "Observations", "Mapped", "Unmatched", "Unavailable mapping", "In-progress runs", "PASS", "FAIL", "FLAKY (reported)", "SKIP", "BLOCKED"], rows)}</section>${
    includeDuration
      ? `<section><h2>Recorded duration and completion evidence</h2><p>Valid nonnegative duration sums are milliseconds, including repeated observations and in-progress runs. Missing/invalid duration is not zero. Not wall-clock elapsed time, human effort, billable cost, comparable performance or capacity.</p>${table(
          [
            "Included UTC dates",
            "Timed observations",
            "Valid duration sum (ms)",
            "Missing duration",
            "Invalid duration",
            "Recorded completed runs",
            "Completion unavailable",
            "In-progress observations",
          ],
          periods.map((period) => [
            dates(period),
            period.timedResults,
            period.sumDurationMs,
            period.missingDurations,
            period.invalidDurations,
            period.finishedRecordedRuns,
            period.completionUnavailableRuns,
            period.inProgressResults,
          ]),
        )}</section>`
      : ""
  }</body></html>`;
  if (new TextEncoder().encode(html).byteLength > 1024 * 1024) refuse();
  return html;
}
