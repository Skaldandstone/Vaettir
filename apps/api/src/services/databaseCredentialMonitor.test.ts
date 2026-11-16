import { describe, expect, it, vi } from "vitest";
import { createDatabaseCredentialMonitor, databaseCredentialLiveness } from "./databaseCredentialMonitor.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}

describe("managed database credential refresh", () => {
  it("keeps liveness 200 before, during and after replacement readiness, and handles later rotations", async () => {
    const ready = deferred<void>();
    const resolveUrl = vi.fn().mockResolvedValueOnce("initial").mockResolvedValueOnce("second").mockResolvedValueOnce("second").mockResolvedValue("third");
    const refresh = vi.fn().mockReturnValueOnce(ready.promise).mockResolvedValue(undefined);
    const onRotation = vi.fn();
    const monitor = createDatabaseCredentialMonitor({ initialUrl: "initial", resolveUrl, refresh, onRotation, onCheckFailure: vi.fn() });
    await monitor.check();
    expect(refresh).not.toHaveBeenCalled();
    expect(databaseCredentialLiveness()).toEqual({ statusCode: 200, body: { ok: true } });
    const pending = monitor.check();
    await Promise.resolve();
    expect(monitor.status()).toEqual({ rotated: true, checkFailed: false, refreshing: true });
    expect(databaseCredentialLiveness().statusCode).toBe(200);
    expect(onRotation).not.toHaveBeenCalled();
    await monitor.check();
    expect(resolveUrl).toHaveBeenCalledTimes(2);
    ready.resolve();
    await pending;
    expect(monitor.status()).toEqual({ rotated: false, checkFailed: false, refreshing: false });
    await monitor.check();
    expect(refresh).toHaveBeenCalledTimes(1);
    await monitor.check();
    expect(refresh.mock.calls).toEqual([["second"], ["third"]]);
    expect(onRotation.mock.calls).toEqual([[], []]);
    expect(databaseCredentialLiveness().statusCode).toBe(200);
  });

  it("retains the task on a failed replacement and retries only preparation on a later check", async () => {
    const refresh = vi.fn().mockRejectedValueOnce(new Error("private-secret")).mockResolvedValue(undefined);
    const onCheckFailure = vi.fn();
    const onRotation = vi.fn();
    const monitor = createDatabaseCredentialMonitor({ initialUrl: "initial", resolveUrl: async () => "second", refresh, onRotation, onCheckFailure });
    await monitor.check();
    expect(monitor.status()).toEqual({ rotated: true, checkFailed: true, refreshing: false });
    expect(databaseCredentialLiveness().statusCode).toBe(200);
    expect(onRotation).not.toHaveBeenCalled();
    expect(onCheckFailure.mock.calls).toEqual([[]]);
    await monitor.check();
    expect(monitor.status()).toEqual({ rotated: false, checkFailed: false, refreshing: false });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("does not refresh or evict on transient or empty secret reads", async () => {
    const resolveUrl = vi.fn().mockRejectedValueOnce(new Error("private-secret")).mockResolvedValueOnce(undefined).mockResolvedValue("initial");
    const refresh = vi.fn();
    const onCheckFailure = vi.fn();
    const monitor = createDatabaseCredentialMonitor({ initialUrl: "initial", resolveUrl, refresh, onRotation: vi.fn(), onCheckFailure });
    await monitor.check();
    expect(monitor.status().checkFailed).toBe(true);
    expect(databaseCredentialLiveness().statusCode).toBe(200);
    await monitor.check();
    await monitor.check();
    expect(monitor.status()).toEqual({ rotated: false, checkFailed: false, refreshing: false });
    expect(refresh).not.toHaveBeenCalled();
    expect(onCheckFailure.mock.calls).toEqual([[], []]);
  });

  it("stops before a pending secret read can initiate a replacement", async () => {
    const read = deferred<string>();
    const resolveUrl = vi.fn(() => read.promise);
    const refresh = vi.fn();
    const monitor = createDatabaseCredentialMonitor({ initialUrl: "initial", resolveUrl, refresh, onRotation: vi.fn(), onCheckFailure: vi.fn() });
    const pending = monitor.check();
    monitor.stop();
    read.resolve("second");
    await pending;
    await monitor.check();
    expect(refresh).not.toHaveBeenCalled();
    expect(resolveUrl).toHaveBeenCalledTimes(1);
  });
});
