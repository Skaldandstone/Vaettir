import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  captureException: vi.fn(),
  findMany: vi.fn(),
  grant: vi.fn(),
  heartbeat: vi.fn(),
}));

vi.mock("@sentry/node", () => ({ captureException: mocks.captureException }));
vi.mock("@vaettir/db", () => ({
  prisma: { organization: { findMany: mocks.findMany } },
}));
vi.mock("../services/aiCredits.js", () => ({
  grantMonthlyCreditsIfNeeded: mocks.grant,
}));
vi.mock("../services/heartbeat.js", () => ({
  recordHeartbeat: mocks.heartbeat,
}));

import { runAiCreditGrantCheckSafely } from "./aiCreditGrantScheduler.js";

describe("AI credit grant scheduler entrypoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("captures an outer database failure and succeeds on the next tick", async () => {
    const failure = new Error("database unavailable");
    mocks.findMany
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce([{ id: "org-1" }]);
    mocks.grant.mockResolvedValue(undefined);

    await expect(runAiCreditGrantCheckSafely()).resolves.toBeUndefined();
    await expect(runAiCreditGrantCheckSafely()).resolves.toBeUndefined();

    expect(mocks.captureException).toHaveBeenCalledWith(failure, {
      tags: { scheduler: "aiCreditGrantScheduler" },
    });
    expect(mocks.grant).toHaveBeenCalledWith(expect.anything(), "org-1");
    expect(mocks.heartbeat).toHaveBeenCalledTimes(2);
  });
});
