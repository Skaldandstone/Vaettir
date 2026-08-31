import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findMany: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn(), overview: vi.fn(), post: vi.fn(), capture: vi.fn(), heartbeat: vi.fn() }));
vi.mock("@vaettir/db", () => ({ prisma: { organization: { findMany: mocks.findMany, findUniqueOrThrow: mocks.findUniqueOrThrow, update: mocks.update } } }));
vi.mock("@sentry/node", () => ({ captureException: mocks.capture }));
vi.mock("../services/orgReadiness.js", () => ({ getOrgOverview: mocks.overview }));
vi.mock("../services/readinessDigest.js", () => ({ postSlackDigest: mocks.post }));
vi.mock("../services/heartbeat.js", () => ({ recordHeartbeat: mocks.heartbeat }));

beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-08-30T10:00:00Z"));
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.findMany.mockResolvedValue([]); mocks.overview.mockResolvedValue({}); mocks.post.mockResolvedValue(undefined); mocks.update.mockResolvedValue({});
  mocks.findUniqueOrThrow.mockResolvedValue({ id: "synthetic", name: "Synthetic", slackWebhookUrl: "https://example.invalid/no-network" });
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

it("performs one real startup check and repeated starts create only one interval", async () => {
  const scheduler = await import("./readinessDigestScheduler.js");
  scheduler.startReadinessDigestScheduler(); scheduler.startReadinessDigestScheduler();
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.findMany).toHaveBeenCalledTimes(1);
  expect(mocks.heartbeat).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(scheduler.CHECK_INTERVAL_MS);
  expect(mocks.findMany).toHaveBeenCalledTimes(2);
});

it("queries only due enabled webhook organizations, and skips already-sent UTC days", async () => {
  mocks.findMany.mockResolvedValue([{ id: "already", lastDigestSentAt: new Date("2026-08-30T00:00:00Z") }, { id: "due", lastDigestSentAt: new Date("2026-08-29T10:00:00Z") }]);
  const scheduler = await import("./readinessDigestScheduler.js"); scheduler.startReadinessDigestScheduler();
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { digestEnabled: true, slackWebhookUrl: { not: null }, digestHourUtc: 10 } }));
  expect(mocks.findUniqueOrThrow).toHaveBeenCalledExactlyOnceWith({ where: { id: "due" } });
  expect(mocks.post).toHaveBeenCalledTimes(1);
  expect(mocks.update).toHaveBeenCalledTimes(1);
});

it("does not send for a non-due query result or a removed webhook", async () => {
  const scheduler = await import("./readinessDigestScheduler.js"); scheduler.startReadinessDigestScheduler();
  await vi.advanceTimersByTimeAsync(0); expect(mocks.post).not.toHaveBeenCalled();
  mocks.findMany.mockResolvedValue([{ id: "removed", lastDigestSentAt: null }]);
  mocks.findUniqueOrThrow.mockResolvedValue({ slackWebhookUrl: null });
  await vi.advanceTimersByTimeAsync(scheduler.CHECK_INTERVAL_MS);
  expect(mocks.post).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.capture).toHaveBeenCalledTimes(1);
});

it("captures DB failure without unhandled rejection and retries successfully later", async () => {
  const failure = new Error("synthetic DB failure"); mocks.findMany.mockRejectedValueOnce(failure);
  const scheduler = await import("./readinessDigestScheduler.js"); scheduler.startReadinessDigestScheduler();
  await vi.advanceTimersByTimeAsync(0); expect(mocks.capture).toHaveBeenCalledWith(failure);
  await vi.advanceTimersByTimeAsync(scheduler.CHECK_INTERVAL_MS);
  expect(mocks.findMany).toHaveBeenCalledTimes(2); expect(mocks.capture).toHaveBeenCalledTimes(1);
});

it("does not overlap startup with a scheduled check in the same process", async () => {
  let release: (value: unknown[]) => void = () => undefined;
  mocks.findMany.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const scheduler = await import("./readinessDigestScheduler.js"); scheduler.startReadinessDigestScheduler();
  await vi.advanceTimersByTimeAsync(scheduler.CHECK_INTERVAL_MS); expect(mocks.findMany).toHaveBeenCalledTimes(1);
  release([]); await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(scheduler.CHECK_INTERVAL_MS); expect(mocks.findMany).toHaveBeenCalledTimes(2);
});

it("captures webhook failure without recording delivery, then retries", async () => {
  mocks.findMany.mockResolvedValue([{ id: "due", lastDigestSentAt: null }]);
  const failure = new Error("synthetic webhook failure"); mocks.post.mockRejectedValueOnce(failure);
  const scheduler = await import("./readinessDigestScheduler.js"); scheduler.startReadinessDigestScheduler();
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.capture).toHaveBeenCalledWith(failure); expect(mocks.update).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(scheduler.CHECK_INTERVAL_MS);
  expect(mocks.post).toHaveBeenCalledTimes(2); expect(mocks.update).toHaveBeenCalledTimes(1);
});
