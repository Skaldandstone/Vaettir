import { Prisma } from "@vaettir/db";
import { TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";
import {
  freezeReviewedStepValue,
  isReviewedStepRollback,
  withReviewedStepRollback,
} from "./manualStepReviewedRollback.js";
const native = (code: string, meta?: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError("Synthetic native rollback", {
    code,
    clientVersion: "fixture",
    ...(meta ? { meta } : {}),
  });
describe("bounded reviewed step rollback; mocks only, no native SQL", () => {
  it.each([native("P2034"), native("P2010", { code: "40001" })])(
    "recognizes only actual known rollback %s",
    async (cause) => {
      expect(isReviewedStepRollback(cause)).toBe(true);
      const execute = vi
        .fn()
        .mockRejectedValueOnce(cause)
        .mockResolvedValueOnce("ACK");
      expect(await withReviewedStepRollback(execute, () => 0)).toBe("ACK");
      expect(execute).toHaveBeenCalledTimes(2);
    },
  );
  it.each([
    native("P2002"),
    native("P2028"),
    native("P1001"),
    native("P2010", { code: "23514" }),
    native("P2010", { code: "40P01" }),
    native("P2010", { code: 40001 }),
    { code: "P2034" },
    { code: "40001" },
    { code: "P2010", meta: { code: "40001" } },
    new Error("P2034 transaction timeout 40001"),
    new TRPCError({ code: "CONFLICT" }),
    new TRPCError({ code: "FORBIDDEN", cause: native("P2034") }),
    null,
    undefined,
  ])("does not retry non-proven rollback %#", async (cause) => {
    expect(isReviewedStepRollback(cause)).toBe(false);
    const execute = vi.fn().mockRejectedValue(cause);
    await expect(withReviewedStepRollback(execute, () => 0)).rejects.toBe(
      cause,
    );
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it("allocates queue+transaction within one monotonic total and reduces both on retry", async () => {
    let clock = 100;
    const cause = native("P2034"),
      seen: Array<{ maxWait: number; timeout: number }> = [];
    const execute = vi.fn(async (budget) => {
      seen.push(budget);
      expect(Object.isFrozen(budget)).toBe(true);
      if (seen.length === 1) {
        clock += 9000;
        throw cause;
      }
      return "ACK";
    });
    expect(await withReviewedStepRollback(execute, () => clock)).toBe("ACK");
    expect(seen).toEqual([
      { maxWait: 5000, timeout: 15000 },
      { maxWait: 2750, timeout: 8250 },
    ]);
    expect(seen[1]!.maxWait + seen[1]!.timeout + 9000).toBe(20000);
  });
  it("keeps original first rollback UNKNOWN on budget exhaustion, never fabricates CAS conflict", async () => {
    let clock = 0;
    const cause = native("P2034");
    const execute = vi.fn(async () => {
      clock = 19999;
      throw cause;
    });
    await expect(withReviewedStepRollback(execute, () => clock)).rejects.toBe(
      cause,
    );
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it("never starts a third transaction or rewrites second native rollback", async () => {
    const first = native("P2034"),
      second = native("P2010", { code: "40001" });
    const execute = vi
      .fn()
      .mockRejectedValueOnce(first)
      .mockRejectedValueOnce(second)
      .mockResolvedValue("must not run");
    await expect(withReviewedStepRollback(execute, () => 0)).rejects.toBe(
      second,
    );
    expect(execute).toHaveBeenCalledTimes(2);
  });
  it("does not turn a validated success into an invented timeout or unknown commit", async () => {
    let clock = 0;
    const ack = { revisionId: "original" };
    const execute = vi.fn(async () => {
      clock = 25000;
      return ack;
    });
    expect(await withReviewedStepRollback(execute, () => clock)).toBe(ack);
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it("refuses unavailable monotonic budget before work and preserves rollback when clock regresses", async () => {
    const execute = vi.fn();
    await expect(
      withReviewedStepRollback(execute, () => Number.NaN),
    ).rejects.toThrow("budget is unavailable");
    expect(execute).not.toHaveBeenCalled();
    let clock = 100;
    const cause = native("P2034");
    const failed = vi.fn(async () => {
      clock = 99;
      throw cause;
    });
    await expect(withReviewedStepRollback(failed, () => clock)).rejects.toBe(
      cause,
    );
    expect(failed).toHaveBeenCalledTimes(1);
  });
  it("deep-freezes captured scalar/null/raw multiline/array intent without normalization", () => {
    const value = {
      note: " \n raw \r\n ",
      reason: null,
      evidenceIds: ["z", "a"],
      observations: {
        environment: "",
        measurements: [{ name: " Meter\n serial ", value: 0 }],
      },
    };
    const serialized = JSON.stringify(value);
    expect(freezeReviewedStepValue(value)).toBe(value);
    expect(JSON.stringify(value)).toBe(serialized);
    for (const child of [
      value,
      value.evidenceIds,
      value.observations,
      value.observations.measurements,
      value.observations.measurements[0],
    ])
      expect(Object.isFrozen(child)).toBe(true);
    expect(() => {
      value.observations.measurements[0]!.value = 1;
    }).toThrow(TypeError);
    expect(freezeReviewedStepValue(null)).toBeNull();
  });
});
