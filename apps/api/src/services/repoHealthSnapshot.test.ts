import { describe, it, expect } from "vitest";
import { computeJobMetrics, daysSinceLastGreen, jobPassed, type JobRun } from "./repoHealthSnapshot.js";

function run(jobName: string, conclusion: "success" | "failure", daysAgo: number): JobRun {
  const startedAt = new Date(Date.now() - daysAgo * 86_400_000);
  return { runId: daysAgo, jobName, conclusion, startedAt, completedAt: startedAt, headSha: "abc" };
}

describe("jobPassed", () => {
  it("is true only for conclusion success", () => {
    expect(jobPassed({ runId: 1, jobName: "x", conclusion: "success", startedAt: null, completedAt: null, headSha: "a" })).toBe(true);
    expect(jobPassed({ runId: 1, jobName: "x", conclusion: "failure", startedAt: null, completedAt: null, headSha: "a" })).toBe(false);
    expect(jobPassed({ runId: 1, jobName: "x", conclusion: null, startedAt: null, completedAt: null, headSha: "a" })).toBe(false);
  });
});

describe("computeJobMetrics", () => {
  it("groups by job name and computes pass rate for the rolling window", () => {
    const runs = [run("test", "success", 5), run("test", "success", 4), run("test", "failure", 3), run("test", "success", 2)];
    const [metrics] = computeJobMetrics(runs, 20);
    expect(metrics!.jobName).toBe("test");
    expect(metrics!.totalRuns).toBe(4);
    expect(metrics!.passRate).toBeCloseTo(0.75);
  });

  it("scores flakiness as the fraction of alternating consecutive pairs, newest first", () => {
    // newest-first after sort: success, failure, success, failure -> every pair flips
    const runs = [run("t", "failure", 4), run("t", "success", 3), run("t", "failure", 2), run("t", "success", 1)];
    const [metrics] = computeJobMetrics(runs);
    expect(metrics!.flakinessScore).toBeCloseTo(1);
  });

  it("scores a steady run of failures then a fix as low flakiness", () => {
    const runs = [run("t", "failure", 5), run("t", "failure", 4), run("t", "failure", 3), run("t", "success", 1)];
    const [metrics] = computeJobMetrics(runs);
    // newest-first: success, failure, failure, failure -> 1 flip / 3 pairs
    expect(metrics!.flakinessScore).toBeCloseTo(1 / 3);
  });

  it("computes passRateDelta against the immediately preceding window of the same size", () => {
    const window = 2;
    const runs = [
      run("t", "success", 4), // previous window
      run("t", "success", 3), // previous window
      run("t", "failure", 2), // current window
      run("t", "failure", 1), // current window
    ];
    const [metrics] = computeJobMetrics(runs, window);
    expect(metrics!.passRate).toBeCloseTo(0);
    expect(metrics!.passRateDelta).toBeCloseTo(0 - 1); // current 0% - previous 100%
  });

  it("leaves passRateDelta null when there is no full previous window", () => {
    const runs = [run("t", "success", 1)];
    const [metrics] = computeJobMetrics(runs, 20);
    expect(metrics!.passRateDelta).toBeNull();
  });

  it("sorts results by job name", () => {
    const runs = [run("zeta", "success", 1), run("alpha", "success", 1)];
    const metrics = computeJobMetrics(runs);
    expect(metrics.map((m) => m.jobName)).toEqual(["alpha", "zeta"]);
  });
});

describe("daysSinceLastGreen", () => {
  it("returns the worst (largest) gap across jobs", () => {
    const fastJob = computeJobMetrics([run("fast", "success", 1)])[0]!;
    const staleJob = computeJobMetrics([run("stale", "success", 10)])[0]!;
    const gap = daysSinceLastGreen([fastJob, staleJob]);
    expect(gap).toBeGreaterThan(9.9);
    expect(gap).toBeLessThan(10.1);
  });

  it("returns null if any job has no green run in its window", () => {
    const neverGreen = computeJobMetrics([run("broken", "failure", 1)])[0]!;
    expect(daysSinceLastGreen([neverGreen])).toBeNull();
  });
});
