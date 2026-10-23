import { afterEach, describe, expect, it, vi } from "vitest";
import {
  analysisPollLivenessTick,
  ANALYSIS_POLL_INTERVAL_MS,
} from "./caseAnalysisQueueWorker.js";
import { createSafeSchedulerRunner } from "./safeSchedulerRunner.js";
describe("paid queue timer liveness", () => {
  afterEach(() => vi.useRealTimers());
  it("records actual timer attempts throughout bounded provider work without overlapping it or inventing dependency health", async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const work = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const dependencyHealth = { database: "UNKNOWN", provider: "UNKNOWN" };
    const errors = vi.fn();
    const guarded = createSafeSchedulerRunner(
      "synthetic-analysis",
      work,
      errors,
    );
    const heartbeat = vi.fn();
    const interval = setInterval(
      () => analysisPollLivenessTick(heartbeat, guarded),
      ANALYSIS_POLL_INTERVAL_MS,
    );
    await vi.advanceTimersByTimeAsync(90000);
    expect(heartbeat).toHaveBeenCalledTimes(18);
    expect(work).toHaveBeenCalledTimes(1);
    expect(dependencyHealth).toEqual({
      database: "UNKNOWN",
      provider: "UNKNOWN",
    });
    expect(errors).not.toHaveBeenCalled();
    release();
    await vi.advanceTimersByTimeAsync(5000);
    expect(work).toHaveBeenCalledTimes(2);
    clearInterval(interval);
    release();
  });
});
