import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  recordHeartbeat: vi.fn(),
  captureException: vi.fn(),
}));

vi.mock("@vaettir/db", () => ({
  prisma: {
    organization: {
      findMany: mocks.findMany,
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
    },
  },
}));
vi.mock("@sentry/node", () => ({ captureException: mocks.captureException }));
vi.mock("../services/heartbeat.js", () => ({
  recordHeartbeat: mocks.recordHeartbeat,
}));
vi.mock("../services/orgReadiness.js", () => ({ getOrgOverview: vi.fn() }));
vi.mock("../services/readinessDigest.js", () => ({ postSlackDigest: vi.fn() }));

describe("readiness digest scheduler startup", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.findMany.mockReset();
    mocks.recordHeartbeat.mockReset();
    mocks.captureException.mockReset();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("checks immediately, starts only once, and retries after a rejected startup check", async () => {
    const startupError = new Error("temporary database failure");
    mocks.findMany.mockRejectedValueOnce(startupError).mockResolvedValue([]);
    const { CHECK_INTERVAL_MS, startReadinessDigestScheduler } =
      await import("./readinessDigestScheduler.js");

    startReadinessDigestScheduler();
    startReadinessDigestScheduler();
    await vi.waitFor(() => expect(mocks.findMany).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(mocks.captureException).toHaveBeenCalledWith(startupError, {
        tags: { scheduler: "readinessDigestScheduler" },
      }),
    );

    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
    expect(mocks.findMany).toHaveBeenCalledTimes(2);
    expect(mocks.recordHeartbeat).toHaveBeenCalledTimes(2);
  });
});
