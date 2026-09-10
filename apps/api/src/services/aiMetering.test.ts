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

function fakePrisma() {
  const update = vi.fn().mockResolvedValue({});
  return { prisma: { aiCreditTransaction: { update } } as unknown as PrismaClient, update };
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
    });
  });

  it("leaves the row untouched when the AI call throws", async () => {
    const { prisma, update } = fakePrisma();
    await expect(
      meterAiCall(prisma, charge, async () => {
        await fakeAnthropicCall(1, 1);
        throw new Error("upstream failure");
      }),
    ).rejects.toThrow("upstream failure");
    expect(update).not.toHaveBeenCalled();
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
});
