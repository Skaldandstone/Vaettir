import { afterEach, describe, expect, it, vi } from "vitest";
import { readWorkbookPreview } from "./read-workbook-preview";
afterEach(() => vi.useRealTimers());
describe("workbook preview polling", () => {
  it("continues past the old deadline with one start and an indeterminate progress callback", async () => {
    vi.useFakeTimers();
    const start = vi.fn(async (_requestId: string) => ({})),
      cancel = vi.fn(async (_requestId: string) => ({}));
    let polls = 0;
    const status = vi.fn(async (_requestId: string) =>
      ++polls < 12
        ? { status: "READING" as const, checkpoints: Math.floor(polls / 3) }
        : {
            status: "READY" as const,
            checkpoints: 5,
            preview: { sheets: ["original"] },
          },
    );
    const progress = vi.fn();
    const promise = readWorkbookPreview(
      { start, status, cancel },
      new AbortController().signal,
      progress,
    );
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await promise).toEqual({ sheets: ["original"] });
    expect(start).toHaveBeenCalledOnce();
    expect(cancel).not.toHaveBeenCalled();
    const requestId = start.mock.calls[0]![0];
    expect(status.mock.calls.every((call) => call[0] === requestId)).toBe(true);
    expect(progress).toHaveBeenCalledWith(3);
  });
  it("cancels the original read on owner cancellation without starting another", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const start = vi.fn(async (_requestId: string) => ({})),
      cancel = vi.fn(async (_requestId: string) => ({}));
    const status = vi.fn(async (_requestId: string) => ({
      status: "READING" as const,
      checkpoints: 0,
    }));
    const promise = readWorkbookPreview(
      { start, status, cancel },
      controller.signal,
      vi.fn(),
    );
    const rejected = expect(promise).rejects.toThrow("cancelled");
    await vi.advanceTimersByTimeAsync(2000);
    controller.abort();
    await rejected;
    expect(start).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledWith(start.mock.calls[0]![0]);
  });
  it("recovers a lost status response using the same read identity", async () => {
    vi.useFakeTimers();
    const start = vi.fn(async (_requestId: string) => ({})),
      cancel = vi.fn(async (_requestId: string) => ({}));
    const status = vi
      .fn()
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValueOnce({
        status: "READY",
        checkpoints: 5,
        preview: { sheets: [] },
      });
    const promise = readWorkbookPreview(
      { start, status, cancel },
      new AbortController().signal,
      vi.fn(),
    );
    await vi.advanceTimersByTimeAsync(2000);
    expect(await promise).toEqual({ sheets: [] });
    expect(start).toHaveBeenCalledOnce();
    expect(status.mock.calls[0]![0]).toBe(status.mock.calls[1]![0]);
    expect(cancel).not.toHaveBeenCalled();
  });
  it("stops after repeated transport failure and does not leave a background read running", async () => {
    vi.useFakeTimers();
    const start = vi.fn(async (_requestId: string) => ({})),
      cancel = vi.fn(async (_requestId: string) => ({}));
    const status = vi.fn().mockRejectedValue(new Error("unavailable"));
    const promise = readWorkbookPreview(
      { start, status, cancel },
      new AbortController().signal,
      vi.fn(),
    );
    const rejected = expect(promise).rejects.toThrow("unavailable");
    await vi.advanceTimersByTimeAsync(5000);
    await rejected;
    expect(status).toHaveBeenCalledTimes(3);
    expect(cancel).toHaveBeenCalledOnce();
    expect(start).toHaveBeenCalledOnce();
  });
});
