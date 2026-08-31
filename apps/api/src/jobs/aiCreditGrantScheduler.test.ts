import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findMany: vi.fn(), grant: vi.fn(), capture: vi.fn(), heartbeat: vi.fn() }));
vi.mock("@vaettir/db", () => ({ prisma: { organization: { findMany: mocks.findMany } } }));
vi.mock("@sentry/node", () => ({ captureException: mocks.capture }));
vi.mock("../services/aiCredits.js", () => ({ grantMonthlyCreditsIfNeeded: mocks.grant }));
vi.mock("../services/heartbeat.js", () => ({ recordHeartbeat: mocks.heartbeat }));

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.findMany.mockResolvedValue([]);
  mocks.grant.mockResolvedValue(undefined);
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

it("reports startup query rejection and grants normally on the next scheduled check", async () => {
  const failure = new Error("synthetic startup database failure");
  mocks.findMany.mockRejectedValueOnce(failure).mockResolvedValue([{ id: "synthetic-org" }]);
  const scheduler = await import("./aiCreditGrantScheduler.js");
  scheduler.startAiCreditGrantScheduler();
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.capture).toHaveBeenCalledExactlyOnceWith(failure);
  expect(mocks.grant).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(scheduler.CHECK_INTERVAL_MS);
  expect(mocks.findMany).toHaveBeenCalledTimes(2);
  expect(mocks.findMany).toHaveBeenLastCalledWith({ select: { id: true } });
  expect(mocks.grant).toHaveBeenCalledExactlyOnceWith(expect.any(Object), "synthetic-org");
  expect(mocks.capture).toHaveBeenCalledTimes(1);
});

it("reports an interval query rejection and recovers on the following interval", async () => {
  const failure = new Error("synthetic interval database failure");
  mocks.findMany.mockResolvedValueOnce([]).mockRejectedValueOnce(failure).mockResolvedValue([{ id: "synthetic-org" }]);
  const scheduler = await import("./aiCreditGrantScheduler.js");
  scheduler.startAiCreditGrantScheduler();
  await vi.advanceTimersByTimeAsync(scheduler.CHECK_INTERVAL_MS);
  expect(mocks.capture).toHaveBeenCalledExactlyOnceWith(failure);
  expect(mocks.grant).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(scheduler.CHECK_INTERVAL_MS);
  expect(mocks.findMany).toHaveBeenCalledTimes(3);
  expect(mocks.grant).toHaveBeenCalledExactlyOnceWith(expect.any(Object), "synthetic-org");
});

it("preserves per-organization failure isolation and retries without changing grant arguments", async () => {
  const failure = new Error("synthetic grant failure");
  mocks.findMany.mockResolvedValue([{ id: "first" }, { id: "second" }]);
  mocks.grant.mockRejectedValueOnce(failure);
  const scheduler = await import("./aiCreditGrantScheduler.js");
  scheduler.startAiCreditGrantScheduler();
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.capture).toHaveBeenCalledExactlyOnceWith(failure);
  expect(mocks.grant.mock.calls.map(call => call[1])).toEqual(["first", "second"]);
  await vi.advanceTimersByTimeAsync(scheduler.CHECK_INTERVAL_MS);
  expect(mocks.grant.mock.calls.map(call => call[1])).toEqual(["first", "second", "first", "second"]);
});

it("does not create duplicate startup checks or timers when started repeatedly", async () => {
  const scheduler = await import("./aiCreditGrantScheduler.js");
  scheduler.startAiCreditGrantScheduler(); scheduler.startAiCreditGrantScheduler();
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.findMany).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(1);
  expect(scheduler.CHECK_INTERVAL_MS).toBe(24 * 60 * 60 * 1000);
  await vi.advanceTimersByTimeAsync(scheduler.CHECK_INTERVAL_MS);
  expect(mocks.findMany).toHaveBeenCalledTimes(2);
});

it("contains reporting failures so the next interval still recovers", async () => {
  mocks.findMany.mockRejectedValueOnce(new Error("synthetic database failure")).mockResolvedValue([{ id: "synthetic-org" }]);
  mocks.capture.mockImplementationOnce(() => { throw new Error("synthetic reporter failure"); });
  const scheduler = await import("./aiCreditGrantScheduler.js");
  scheduler.startAiCreditGrantScheduler();
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(scheduler.CHECK_INTERVAL_MS);
  expect(mocks.capture).toHaveBeenCalledTimes(1);
  expect(mocks.grant).toHaveBeenCalledExactlyOnceWith(expect.any(Object), "synthetic-org");
});
