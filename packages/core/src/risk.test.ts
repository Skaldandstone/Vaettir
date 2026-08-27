import { describe, it, expect } from "vitest";
import { fallbackRiskScoreFromPriority } from "./risk.js";

describe("fallbackRiskScoreFromPriority", () => {
  it("maps each known priority to its fixed fallback score", () => {
    expect(fallbackRiskScoreFromPriority("CRITICAL")).toBe(90);
    expect(fallbackRiskScoreFromPriority("HIGH")).toBe(70);
    expect(fallbackRiskScoreFromPriority("MEDIUM")).toBe(50);
    expect(fallbackRiskScoreFromPriority("LOW")).toBe(30);
  });

  it("falls back to 50 for an unknown priority rather than throwing", () => {
    expect(fallbackRiskScoreFromPriority("NOT_A_REAL_PRIORITY")).toBe(50);
  });
});
