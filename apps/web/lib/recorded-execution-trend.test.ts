import { describe, it, expect } from "vitest";
import {
  defaultExecutionTrendDates,
  renderRecordedExecutionTrendCsv,
  executionTrendPeriods,
} from "./recorded-execution-trend";
import type { RecordedExecutionTrend } from "@vaettir/api/src/services/recordedExecutionTrendSchema";
// SOURCE ONLY, authored 2026-10-04, UNEXECUTED.
const counts = {
  runs: 1,
  results: 2,
  mapped: 1,
  unmatched: 1,
  unavailableMapping: 0,
  inProgressRuns: 0,
  finishedRecordedRuns: 1,
  completionUnavailableRuns: 0,
  inProgressResults: 0,
  timedResults: 1,
  missingDurations: 1,
  invalidDurations: 0,
  sumDurationMs: 10,
  outcomes: { PASS: 1, FAIL: 1, FLAKY: 0, SKIP: 0, BLOCKED: 0 },
};
const sample = (): RecordedExecutionTrend => ({
  projectId: "private-project-id",
  organizationId: "private-org-id",
  clerkActorId: "private-actor",
  requestKey: "private-key",
  asOf: "2026-10-04T10:00:00.000Z",
  windowStart: "2026-10-01T00:00:00.000Z",
  windowEnd: "2026-10-01T23:59:59.999Z",
  scope: {
    start: "2026-10-01",
    end: "2026-10-01",
    platform: "=INTERNAL_LABEL()",
  },
  totals: counts,
  days: [{ day: "2026-10-01", ...counts }],
  limitations: [
    "Result observations, not unique attempts or a release verdict.",
  ],
});

function intervalSample(
  start: string,
  numberOfDays: number,
): RecordedExecutionTrend {
  const days = Array.from({ length: numberOfDays }, (_, index) => ({
    ...counts,
    outcomes: { ...counts.outcomes },
    day: new Date(Date.parse(start) + index * 86400000)
      .toISOString()
      .slice(0, 10),
  }));
  const end = days.at(-1)!.day;
  return {
    ...sample(),
    scope: { start, end },
    windowStart: `${start}T00:00:00.000Z`,
    windowEnd: `${end}T23:59:59.999Z`,
    asOf: new Date(Date.parse(end) + 86400000).toISOString(),
    days,
    totals: {
      ...counts,
      ...Object.fromEntries(
        Object.entries(counts)
          .filter(([, value]) => typeof value === "number")
          .map(([key, value]) => [key, (value as number) * numberOfDays]),
      ),
      outcomes: {
        PASS: numberOfDays,
        FAIL: numberOfDays,
        FLAKY: 0,
        SKIP: 0,
        BLOCKED: 0,
      },
    },
  };
}

describe("complete UTC day and Monday-week presentation source", () => {
  it("groups year-boundary dates by Monday identity without mutating daily evidence", () => {
    const original = intervalSample("2020-12-31", 7),
      before = JSON.stringify(original);
    const weeks = executionTrendPeriods(original, "WEEK");
    expect(
      weeks.map(({ key, start, end, results, partialWeek }) => ({
        key,
        start,
        end,
        results,
        partialWeek,
      })),
    ).toEqual([
      {
        key: "2020-12-28",
        start: "2020-12-31",
        end: "2021-01-03",
        results: 8,
        partialWeek: true,
      },
      {
        key: "2021-01-04",
        start: "2021-01-04",
        end: "2021-01-06",
        results: 6,
        partialWeek: true,
      },
    ]);
    expect(weeks.reduce((sum, row) => sum + row.sumDurationMs, 0)).toBe(
      original.totals.sumDurationMs,
    );
    expect(JSON.stringify(original)).toBe(before);
  });
  it("labels Sunday in-progress windows partial even with all seven date bins present", () => {
    const complete = intervalSample("2021-01-04", 7);
    expect(executionTrendPeriods(complete, "WEEK")[0]!.partialWeek).toBe(false);
    complete.asOf = complete.windowEnd = "2021-01-10T10:00:00.000Z";
    expect(executionTrendPeriods(complete, "WEEK")[0]!.partialWeek).toBe(true);
  });
  it("refuses missing/reordered days or inconsistent completion and duration evidence", () => {
    const missing = intervalSample("2021-01-04", 7);
    missing.days.splice(2, 1);
    expect(() => executionTrendPeriods(missing, "WEEK")).toThrow(
      "missing days cannot become zero",
    );
    const reversed = intervalSample("2021-01-04", 7);
    reversed.days.reverse();
    expect(() => executionTrendPeriods(reversed)).toThrow(
      "Complete ordered UTC days",
    );
    const invalidWindow = intervalSample("2021-01-04", 7);
    invalidWindow.windowEnd = "2021-01-09T23:59:59.999Z";
    expect(() => executionTrendPeriods(invalidWindow)).toThrow(
      "does not match the complete applied interval",
    );
    const ancient = intervalSample("0000-01-01", 2);
    expect(() => executionTrendPeriods(ancient, "WEEK")).toThrow(
      "outside supported four-digit dates",
    );
    for (const key of [
      "finishedRecordedRuns",
      "timedResults",
      "sumDurationMs",
    ] as const) {
      const inconsistent = intervalSample("2021-01-04", 7);
      inconsistent.totals[key]++;
      expect(() => executionTrendPeriods(inconsistent, "WEEK")).toThrow(
        "counts are inconsistent",
      );
    }
  });
  it("weekly CSV describes actual included periods and does not invent normalized velocity", () => {
    const csv = renderRecordedExecutionTrendCsv(
      intervalSample("2020-12-31", 7),
      "WEEK",
    );
    expect(csv).toContain("weekly recorded outcomes CSV v2");
    expect(csv).toContain(
      '"Partial UTC week","2020-12-31 through 2021-01-03","4","8"',
    );
    expect(csv).toContain("not normalized or comparable complete weeks");
    expect(csv).not.toContain("private-project-id");
  });
});
describe("read-time execution aggregates CSV source", () => {
  it("uses inclusive UTC fourteen-day defaults across calendar boundaries", () => {
    expect(
      defaultExecutionTrendDates(new Date("2026-10-04T01:00:00.000Z")),
    ).toEqual({ start: "2026-09-21", end: "2026-10-04" });
  });
  it("emits rectangular reviewed scope and observations without actor/run/source identities", () => {
    const value = renderRecordedExecutionTrendCsv(sample());
    expect(value).toContain('"\'=INTERNAL_LABEL()"');
    expect(value).toContain("not an immutable approved stakeholder snapshot");
    expect(value).toContain(
      '"Day","2026-10-01","1","2","1","1","0","0","1","1","0","0","0"',
    );
    for (const secret of [
      "private-project-id",
      "private-org-id",
      "private-actor",
      "private-key",
    ])
      expect(value).not.toContain(secret);
  });
  it("refuses overbound or unsafe cells rather than silently dropping days", () => {
    const large = sample();
    large.days = Array.from({ length: 91 }, (_, n) => ({
      ...counts,
      day: `synthetic-${n}`,
    }));
    expect(() => renderRecordedExecutionTrendCsv(large)).toThrow(
      "complete daily scope",
    );
    const control = sample();
    control.scope.environment = "internal\u0001label";
    expect(() => renderRecordedExecutionTrendCsv(control)).toThrow(
      "control characters",
    );
    const inconsistent = sample();
    inconsistent.totals = { ...inconsistent.totals, results: 10 };
    expect(() => renderRecordedExecutionTrendCsv(inconsistent)).toThrow(
      "counts are inconsistent",
    );
  });
});
