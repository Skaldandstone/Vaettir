import { describe, it, expect } from "vitest";
import { AI_OPERATION_COSTS, InsufficientAiCreditsError } from "./aiCredits.js";

describe("AI_OPERATION_COSTS", () => {
  it("every operation has a positive integer credit cost", () => {
    for (const [operation, cost] of Object.entries(AI_OPERATION_COSTS)) {
      expect(cost, `${operation} cost`).toBeGreaterThan(0);
      expect(Number.isInteger(cost), `${operation} cost is an integer`).toBe(true);
    }
  });
});

describe("InsufficientAiCreditsError", () => {
  it("carries the operation, required, and balance, and a readable message", () => {
    const err = new InsufficientAiCreditsError("reverseEngineerTestFile", 6, 2);
    expect(err.operation).toBe("reverseEngineerTestFile");
    expect(err.required).toBe(6);
    expect(err.balance).toBe(2);
    expect(err.message).toBe('Insufficient AI credits for "reverseEngineerTestFile": needs 6, org has 2.');
    expect(err.name).toBe("InsufficientAiCreditsError");
  });
});
