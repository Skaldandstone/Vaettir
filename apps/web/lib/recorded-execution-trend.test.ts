import { describe, it, expect } from "vitest";
import {
  defaultExecutionTrendDates,
  renderRecordedExecutionTrendCsv,
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
