import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class SyntheticAnthropic {
    messages = { create: sdk.create };
  },
}));
vi.mock("./tracing.js", () => ({
  traceAnthropicCall: (
    _operation: string,
    _model: string,
    call: () => unknown,
  ) => call(),
}));
import { assessTestCaseRisk } from "./assessRisk.js";

const scenario = {
  title: "Synthetic checkout total",
  given: ["A synthetic cart"],
  when: ["The total is calculated"],
  then: ["The recorded total matches"],
  testType: "UNIT",
};
const assessment = {
  severity: "HIGH",
  riskScore: 75,
  rationale: "Synthetic calculation integrity.",
};
const previousKey = process.env.ANTHROPIC_API_KEY;

describe("risk request bounds without provider access", () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "synthetic-never-sent";
    sdk.create.mockReset().mockResolvedValue({
      content: [{ type: "tool_use", input: assessment }],
    });
  });
  afterAll(() => {
    if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previousKey;
  });
  it("keeps ordinary single-case request defaults and validated output", async () => {
    expect(await assessTestCaseRisk(scenario)).toEqual(assessment);
    expect(sdk.create).toHaveBeenCalledTimes(1);
    expect(sdk.create.mock.calls[0]?.[1]).toBeUndefined();
    expect(sdk.create.mock.calls[0]?.[0]).toMatchObject({
      max_tokens: 1024,
      tool_choice: { type: "tool", name: "emit_risk_assessment" },
    });
  });
  it("passes the bounded queue deadline and disables SDK retries", async () => {
    expect(
      await assessTestCaseRisk(scenario, { timeout: 90000, maxRetries: 0 }),
    ).toEqual(assessment);
    expect(sdk.create).toHaveBeenCalledTimes(1);
    expect(sdk.create.mock.calls[0]?.[1]).toEqual({
      timeout: 90000,
      maxRetries: 0,
    });
  });
  it("retains fail-closed missing-tool and malformed-result validation", async () => {
    sdk.create.mockResolvedValueOnce({ content: [] });
    await expect(assessTestCaseRisk(scenario)).rejects.toThrow("tool_use");
    sdk.create.mockResolvedValueOnce({
      content: [{ type: "tool_use", input: { ...assessment, riskScore: 101 } }],
    });
    await expect(assessTestCaseRisk(scenario)).rejects.toThrow();
  });
});
