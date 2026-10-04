import {
  renderBoundedSpreadsheetCsv as csv,
  type SpreadsheetCsvCell,
} from "@vaettir/core";
import {
  recordedExecutionTrendOutput,
  type RecordedExecutionTrend,
} from "@vaettir/api/src/services/recordedExecutionTrendSchema";
import { reportDateIntervalSchema } from "@vaettir/api/src/services/reportDateIntervalSchema";
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
export type ExecutionTrendGrouping = "DAY" | "WEEK";
type TrendDay = RecordedExecutionTrend["days"][number];
export type ExecutionTrendPeriod = Omit<TrendDay, "day"> & {
  key: string;
  start: string;
  end: string;
  partialWeek: boolean;
  days: TrendDay[];
};
const countKeys = [
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
/** Complete UTC bins only. Calendar weeks start Monday; no annual week-number guess. */
export function executionTrendPeriods(
  value: RecordedExecutionTrend,
  grouping: ExecutionTrendGrouping = "DAY",
): ExecutionTrendPeriod[] {
  if (grouping !== "DAY" && grouping !== "WEEK")
    throw new Error("Choose a supported recorded-outcome grouping.");
  if (value.days.length > 90)
    throw new Error("The complete daily scope exceeds the CSV bound.");
  recordedExecutionTrendOutput.parse(value);
  const interval = reportDateIntervalSchema.parse({
    start: value.scope.start,
    end: value.scope.end,
  });
  const first = Date.parse(interval.start),
    last = Date.parse(interval.end);
  const windowStart = Date.parse(value.windowStart),
    windowEnd = Date.parse(value.windowEnd);
  if (
    windowStart !== first ||
    windowEnd < last ||
    windowEnd > last + 86400000 - 1 ||
    windowEnd > Date.parse(value.asOf)
  )
    throw new Error(
      "The recorded UTC window does not match the complete applied interval.",
    );
  const expected = (last - first) / 86400000 + 1;
  if (
    expected > 90 ||
    value.days.length !== expected ||
    value.days.some(
      (day, index) =>
        day.day !==
        new Date(first + index * 86400000).toISOString().slice(0, 10),
    )
  )
    throw new Error(
      "Complete ordered UTC days are required; missing days cannot become zero.",
    );
  if (
    new Set(value.days.map((day) => day.day)).size !== value.days.length ||
    value.days.some(
      (day) =>
        day.results !==
          EXECUTION_OUTCOMES.reduce(
            (sum, status) => sum + day.outcomes[status],
            0,
          ) ||
        day.results !== day.mapped + day.unmatched + day.unavailableMapping ||
        day.runs !==
          day.inProgressRuns +
            day.finishedRecordedRuns +
            day.completionUnavailableRuns ||
        day.results !==
          day.timedResults + day.missingDurations + day.invalidDurations ||
        day.inProgressResults > day.results ||
        (day.inProgressRuns === 0 && day.inProgressResults !== 0) ||
        (day.runs === 0 && day.results !== 0) ||
        (day.timedResults === 0 && day.sumDurationMs !== 0),
    ) ||
    countKeys.some(
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
      "The complete daily counts are inconsistent. No partial presentation or CSV was prepared.",
    );
  const periods = new Map<string, ExecutionTrendPeriod>();
  for (const day of value.days) {
    const date = new Date(`${day.day}T00:00:00.000Z`);
    const weekStart = date.getTime() - ((date.getUTCDay() + 6) % 7) * 86400000;
    const weekIdentity = new Date(weekStart).toISOString();
    if (grouping === "WEEK" && !/^\d{4}-\d{2}-\d{2}T/.test(weekIdentity))
      throw new Error(
        "This UTC calendar week lies outside supported four-digit dates. Use daily grouping.",
      );
    const key = grouping === "DAY" ? day.day : weekIdentity.slice(0, 10);
    const previous = periods.get(key);
    if (!previous) {
      const { day: _day, ...counts } = day;
      periods.set(key, {
        ...counts,
        outcomes: { ...day.outcomes },
        key,
        start: day.day,
        end: day.day,
        partialWeek: false,
        days: [day],
      });
    } else {
      for (const field of countKeys) previous[field] += day[field];
      for (const status of EXECUTION_OUTCOMES)
        previous.outcomes[status] += day.outcomes[status];
      previous.end = day.day;
      previous.days.push(day);
    }
  }
  for (const period of periods.values())
    period.partialWeek =
      grouping === "WEEK" &&
      (period.days.length !== 7 ||
        windowEnd < Date.parse(period.key) + 7 * 86400000 - 1);
  return [...periods.values()];
}
/** Reviewed read-time aggregates. Not a stored/approved report or full backup. */
export function renderRecordedExecutionTrendCsv(
  value: RecordedExecutionTrend,
  grouping: ExecutionTrendGrouping = "DAY",
  includeRecordedDuration = false,
) {
  if (typeof includeRecordedDuration !== "boolean")
    throw new Error("Choose whether to include recorded duration evidence.");
  const periods = executionTrendPeriods(value, grouping);
  const rows: SpreadsheetCsvCell[][] = [];
  const meta = (label: string, text: string) =>
    rows.push(["Scope", label, text]);
  meta(
    "Export format",
    includeRecordedDuration
      ? `Vaettir read-time ${grouping === "DAY" ? "daily" : "weekly"} recorded outcomes and duration CSV v3`
      : grouping === "DAY"
        ? "Vaettir read-time daily recorded outcomes CSV v1"
        : "Vaettir read-time weekly recorded outcomes CSV v2",
  );
  if (grouping === "WEEK")
    meta(
      "Grouping",
      "UTC calendar weeks start Monday. Period labels are actual included dates; partial weeks are not normalized or comparable complete weeks.",
    );
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
  if (includeRecordedDuration)
    meta(
      "Duration evidence",
      "Sum of valid nonnegative recorded result durations in milliseconds, including repeated observations and in-progress runs. Missing and invalid durations are separate counts, not zero. Not wall-clock elapsed time, human effort, billable cost, comparable performance or execution capacity.",
    );
  for (const day of periods)
    rows.push([
      grouping === "DAY"
        ? "Day"
        : day.partialWeek
          ? "Partial UTC week"
          : "UTC week",
      grouping === "DAY" ? day.start : `${day.start} through ${day.end}`,
      day.runs,
      day.results,
      day.mapped,
      day.unmatched,
      day.unavailableMapping,
      day.inProgressRuns,
      ...EXECUTION_OUTCOMES.map((status) => day.outcomes[status]),
      ...(includeRecordedDuration
        ? [
            day.timedResults,
            day.sumDurationMs,
            day.missingDurations,
            day.invalidDurations,
            day.finishedRecordedRuns,
            day.completionUnavailableRuns,
            day.inProgressResults,
          ]
        : []),
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
      grouping === "DAY"
        ? "UTC day / metadata label"
        : "Included UTC dates / metadata label",
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
      ...(includeRecordedDuration
        ? [
            "Result observations with valid recorded duration",
            "Sum valid recorded duration (ms)",
            "Missing duration observations",
            "Invalid duration observations",
            "Runs with recorded completion",
            "Runs with unavailable completion",
            "Observations in in-progress runs",
          ]
        : []),
    ],
    rows.map((row) => [
      ...row,
      ...Array<SpreadsheetCsvCell>(
        (includeRecordedDuration ? 20 : 13) - row.length,
      ).fill(""),
    ]),
  );
}
