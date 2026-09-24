import { describe, expect, it, vi } from "vitest";
import { createSafeSchedulerRunner } from "./safeSchedulerRunner.js";

describe("createSafeSchedulerRunner", () => {
  it("captures a rejected tick without rejecting the fire-and-forget entrypoint", async () => {
    const failure = new Error("database unavailable");
    const report = vi.fn();
    const run = createSafeSchedulerRunner(
      "exampleScheduler",
      vi.fn().mockRejectedValue(failure),
      report,
    );

    await expect(run()).resolves.toBeUndefined();
    expect(report).toHaveBeenCalledWith(failure, "exampleScheduler");
  });

  it("allows a later retry after a failed tick", async () => {
    const report = vi.fn();
    const tick = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce(undefined);
    const run = createSafeSchedulerRunner("retryScheduler", tick, report);

    await run();
    await run();

    expect(tick).toHaveBeenCalledTimes(2);
    expect(report).toHaveBeenCalledOnce();
  });

  it("prevents overlapping ticks while one is still running", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tick = vi.fn(() => pending);
    const run = createSafeSchedulerRunner("overlapScheduler", tick, vi.fn());

    const first = run();
    await expect(run()).resolves.toBeUndefined();
    expect(tick).toHaveBeenCalledOnce();

    release();
    await first;
    await run();
    expect(tick).toHaveBeenCalledTimes(2);
  });
});
