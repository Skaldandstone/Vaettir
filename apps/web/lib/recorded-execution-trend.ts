import {
  renderBoundedSpreadsheetCsv as csv,
  type SpreadsheetCsvCell,
} from "@vaettir/core";
import {
  recordedExecutionTrendOutput,
  type RecordedExecutionTrend,
} from "@vaettir/api/src/services/recordedExecutionTrendSchema";
export const EXECUTION_OUTCOMES = [
  "PASS",
  "FAIL",
  "FLAKY",
  "SKIP",
  "BLOCKED",
] as const;
export const EXECUTION_OUTCOME_COLORS: Record<
  (typeof EXECUTION_OUTCOMES)[number],
  string
> = {
  PASS: "var(--sage, #a8c8b0)",
  FAIL: "var(--ember, #d88976)",
  FLAKY: "#d5ba83",
  SKIP: "#7b8991",
  BLOCKED: "#ab9dc9",
};
export function defaultExecutionTrendDates(now = new Date()) {
  const end = now.toISOString().slice(0, 10),
    start = new Date(Date.parse(`${end}T00:00:00.000Z`) - 13 * 86400000)
      .toISOString()
      .slice(0, 10);
  return { start, end };
}
/** Reviewed read-time aggregates. Not a stored/approved report or full backup. */
export function renderRecordedExecutionTrendCsv(value: RecordedExecutionTrend) {
  if (value.days.length > 90)
    throw new Error("The complete daily scope exceeds the CSV bound.");
  recordedExecutionTrendOutput.parse(value);
  if (
    new Set(value.days.map((day) => day.day)).size !== value.days.length ||
    value.days.some(
      (day) =>
        day.results !==
          EXECUTION_OUTCOMES.reduce(
            (sum, status) => sum + day.outcomes[status],
            0,
          ) ||
        day.results !== day.mapped + day.unmatched + day.unavailableMapping,
    ) ||
    (
      [
        "runs",
        "results",
        "mapped",
        "unmatched",
        "unavailableMapping",
        "inProgressRuns",
      ] as const
    ).some(
      (key) =>
        value.totals[key] !==
        value.days.reduce((sum, day) => sum + day[key], 0),
    ) ||
    EXECUTION_OUTCOMES.some(
      (status) =>
        value.totals.outcomes[status] !==
        value.days.reduce((sum, day) => sum + day.outcomes[status], 0),
    )
  )
    throw new Error(
      "The complete daily counts are inconsistent. No partial CSV was prepared.",
    );
  const rows: SpreadsheetCsvCell[][] = [];
  const meta = (label: string, text: string) =>
    rows.push(["Scope", label, text]);
  meta("Export format", "Vaettir read-time daily recorded outcomes CSV v1");
  meta("Read at UTC", value.asOf);
  meta(
    "Run-start window UTC",
    `${value.windowStart} through ${value.windowEnd}`,
  );
  meta("Recorded platform", value.scope.platform ?? "No platform filter");
  meta(
    "Recorded environment",
    value.scope.environment ?? "No environment filter",
  );
  meta("Recorded build", value.scope.build ?? "No build filter");
  for (const day of value.days)
    rows.push([
      "Day",
      day.day,
      day.runs,
      day.results,
      day.mapped,
      day.unmatched,
      day.unavailableMapping,
      day.inProgressRuns,
      ...EXECUTION_OUTCOMES.map((status) => day.outcomes[status]),
    ]);
  for (const note of value.limitations)
    rows.push(["Evidence boundary", "", note]);
  meta(
    "Sharing boundary",
    "Read-time aggregates, not an immutable approved stakeholder snapshot. Raw run/case IDs, provider/error/notes/source are omitted. Exact recorded scope labels may be internal; review recipients. No access is granted by this CSV.",
  );
  return csv(
    [
      "Row type",
      "UTC day / metadata label",
      "Runs / metadata value",
      "Result observations",
      "Mapped same-project observations",
      "Unmatched observations",
      "Unavailable mapping observations",
      "In-progress runs",
      "PASS",
      "FAIL",
      "FLAKY (reported)",
      "SKIP",
      "BLOCKED",
    ],
    rows.map((row) => [
      ...row,
      ...Array<SpreadsheetCsvCell>(13 - row.length).fill(""),
    ]),
  );
}
