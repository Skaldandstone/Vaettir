import { describe, expect, it } from "vitest";
import {
  aggregateStepStatus,
  recordStepResultInputSchema,
  safeEvidenceFileName,
} from "./manualStepExecution.js";
describe("structured outcome contracts", () => {
  it("keeps failure precedence without treating missing readings as passed", () => {
    expect(aggregateStepStatus(["PASS", "FAIL", "BLOCKED"])).toBe("FAIL");
    expect(aggregateStepStatus(["PASS", "BLOCKED", "SKIP"])).toBe("BLOCKED");
    expect(aggregateStepStatus(["PASS", "SKIP"])).toBe("SKIP");
  });
  it("requires explicit optimistic revision and durable receipt identity", () => {
    expect(
      recordStepResultInputSchema.safeParse({
        testRunId: "run",
        testCaseId: "case",
        stepIndex: 0,
        status: "PASS",
      }).success,
    ).toBe(false);
    expect(safeEvidenceFileName("  Synthetic evidence.txt  ")).toBe(
      "Synthetic evidence.txt",
    );
  });
});
