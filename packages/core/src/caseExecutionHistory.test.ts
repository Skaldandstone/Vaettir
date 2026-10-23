import { describe, expect, it } from "vitest";
import { summarizeCaseOutcomes } from "./caseExecutionHistory.js";

describe("case execution outcome summaries", () => {
  it("does not fabricate a verdict for a planned or partially observed case", () => {
    expect(summarizeCaseOutcomes([])).toBe("NOT_RECORDED");
  });
  it("keeps repeated parameter outcomes in the same run", () => {
    expect(summarizeCaseOutcomes([{ status: "PASS", count: 50 }])).toBe("PASS");
    expect(
      summarizeCaseOutcomes([
        { status: "PASS", count: 49 },
        { status: "FAIL", count: 1 },
      ]),
    ).toBe("MIXED");
  });
  it("keeps skip and blocked distinct from pass", () => {
    expect(summarizeCaseOutcomes([{ status: "SKIP", count: 1 }])).toBe("SKIP");
    expect(summarizeCaseOutcomes([{ status: "BLOCKED", count: 1 }])).toBe(
      "BLOCKED",
    );
    expect(summarizeCaseOutcomes([{ status: "FLAKY", count: 1 }])).toBe(
      "FLAKY",
    );
  });
});
