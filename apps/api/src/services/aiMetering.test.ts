import { describe, it, expect, vi } from "vitest";
import { captureAiUsage } from "@vaettir/ai-agent";
import { meterAiCall, type AiCharge } from "./aiCredits.js";
import type { PrismaClient } from "@vaettir/db";

// P12-12: captureAiUsage is the seam every Anthropic call in the ai-agent
// package reports into (via traceAnthropicCall). These tests drive that seam
// through the package's own public surface rather than mocking the
// Anthropic client: `traceAnthropicCall` is the internal function that
// records usage, so we import it from the built package's tracing module.
import { traceAnthropicCall } from "@vaettir/ai-agent/dist/tracing.js";

function fakeAnthropicCall(input: number, output: number, model = "claude-test") {
  return traceAnthropicCall("test-op", model, async () => ({
    usage: { input_tokens: input, output_tokens: output },
    content: [],
  }));
}

describe("captureAiUsage", () => {
  it("sums tokens and request count across every traced call in the subtree", async () => {
    const { result, usage } = await captureAiUsage(async () => {
      await fakeAnthropicCall(100, 20);
      await fakeAnthropicCall(300, 50, "claude-other");
      return "done";
    });
    expect(result).toBe("done");
    expect(usage).toEqual({ inputTokens: 400, outputTokens: 70, calls: 2, model: "claude-other" });
  });

  it("reports zero calls when the operation made no Anthropic request", async () => {
    const { usage } = await captureAiUsage(async () => 42);
    expect(usage).toEqual({ inputTokens: 0, outputTokens: 0, calls: 0, model: null });
  });

  it("keeps two concurrent captures isolated from each other", async () => {
    const [a, b] = await Promise.all([
      captureAiUsage(async () => {
        await new Promise((r) => setTimeout(r, 5));
        await fakeAnthropicCall(10, 1);
      }),
      captureAiUsage(async () => {
        await fakeAnthropicCall(1000, 100);
        await new Promise((r) => setTimeout(r, 10));
        await fakeAnthropicCall(1000, 100);
      }),
    ]);
    expect(a.usage.inputTokens).toBe(10);
    expect(b.usage.inputTokens).toBe(2000);
    expect(b.usage.calls).toBe(2);
  });

  it("does not record anything when no capture is active", async () => {
    // Must not throw and must not leak into a later capture.
    await fakeAnthropicCall(5, 5);
    const { usage } = await captureAiUsage(async () => undefined);
    expect(usage.calls).toBe(0);
  });
});

// amount is negative (the flat pre-charge, a CONSUMPTION deduction) --
// matches the real row shape meterAiCall reads back via `select` to compute
// the reconciliation adjustment.
function fakePrisma(row: { organizationId?: string; amount?: number; operation?: string | null } = {}) {
  const update = vi.fn().mockResolvedValue({
    organizationId: row.organizationId ?? "org_1",
    amount: row.amount ?? -6,
    operation: row.operation ?? "reverseEngineerTestFile",
  });
  const create = vi.fn().mockResolvedValue({});
  return { prisma: { aiCreditTransaction: { update, create } } as unknown as PrismaClient, update, create };
}

describe("meterAiCall", () => {
  const charge: AiCharge = { transactionId: "tx_1" };

  it("stamps the charged row with real usage after the call completes", async () => {
    const { prisma, update } = fakePrisma();
    const out = await meterAiCall(prisma, charge, async () => {
      await fakeAnthropicCall(1200, 340, "claude-x");
      return { ok: true };
    });
    expect(out).toEqual({ ok: true });
    expect(update).toHaveBeenCalledWith({
      where: { id: "tx_1" },
      data: { inputTokens: 1200, outputTokens: 340, aiCalls: 1, model: "claude-x" },
      select: { organizationId: true, amount: true, operation: true },
    });
  });

  it("refunds the difference (positive ADJUSTMENT) when real usage cost less than the flat pre-charge", async () => {
    // flat pre-charge 6 credits; real usage here is tiny -- well under 6.
    const { prisma, create } = fakePrisma({ amount: -6 });
    await meterAiCall(prisma, charge, async () => {
      await fakeAnthropicCall(100, 20); // ~0.03 + 0.03 = 0.06 -> ceil to 1 credit
      return "ok";
    });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ organizationId: "org_1", type: "ADJUSTMENT", amount: 5, operation: "reverseEngineerTestFile" }),
    });
  });

  it("charges more (negative ADJUSTMENT) when real usage cost exceeded the flat pre-charge", async () => {
    // flat pre-charge 2 credits; 10,000 input tokens at 0.0003 credits/token
    // = exactly 3 credits real cost -- more than the flat pre-charge.
    const { prisma, create } = fakePrisma({ amount: -2, operation: "assessTestCaseRisk" });
    await meterAiCall(prisma, charge, async () => {
      await fakeAnthropicCall(10_000, 0);
      return "ok";
    });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: "ADJUSTMENT", amount: -1, operation: "assessTestCaseRisk" }),
    });
  });

  it("writes no adjustment when the real cost exactly matches the flat pre-charge", async () => {
    // 1 credit flat; a tiny real call also rounds up to exactly 1 credit.
    const { prisma, create } = fakePrisma({ amount: -1 });
    await meterAiCall(prisma, charge, async () => {
      await fakeAnthropicCall(1, 1);
      return "ok";
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("leaves the row untouched when the AI call throws", async () => {
    const { prisma, update, create } = fakePrisma();
    await expect(
      meterAiCall(prisma, charge, async () => {
        await fakeAnthropicCall(1, 1);
        throw new Error("upstream failure");
      }),
    ).rejects.toThrow("upstream failure");
    expect(update).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("skips the write when no Anthropic request ran", async () => {
    const { prisma, update } = fakePrisma();
    await meterAiCall(prisma, charge, async () => "cached");
    expect(update).not.toHaveBeenCalled();
  });

  it("never turns a successful AI call into a failure if the usage write fails", async () => {
    const update = vi.fn().mockRejectedValue(new Error("db down"));
    const prisma = { aiCreditTransaction: { update } } as unknown as PrismaClient;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const out = await meterAiCall(prisma, charge, async () => {
      await fakeAnthropicCall(1, 1);
      return "still fine";
    });
    expect(out).toBe("still fine");
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("never turns a successful AI call into a failure if the adjustment write fails", async () => {
    const { prisma, create } = fakePrisma({ amount: -6 });
    (create as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("db down"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const out = await meterAiCall(prisma, charge, async () => {
      await fakeAnthropicCall(100, 20);
      return "still fine";
    });
    expect(out).toBe("still fine");
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
