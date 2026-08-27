import { describe, it, expect } from "vitest";
import { computeReadiness } from "./orgReadiness.js";

describe("computeReadiness", () => {
  it("scores 100/READY with no criteria and no open flags", () => {
    const result = computeReadiness([], []);
    expect(result.score).toBe(100);
    expect(result.label).toBe("READY");
  });

  it("scores 100/READY when every criterion is MET and there are no open flags", () => {
    const result = computeReadiness([{ status: "MET" }, { status: "MET" }], []);
    expect(result.score).toBe(100);
    expect(result.label).toBe("READY");
  });

  it("weights AT_RISK and PENDING as partial credit, NOT_MET as zero", () => {
    // (1 + 0.5 + 0.25 + 0) / 4 * 100 = 43.75 -> rounds to 44
    const result = computeReadiness([{ status: "MET" }, { status: "AT_RISK" }, { status: "PENDING" }, { status: "NOT_MET" }], []);
    expect(result.score).toBe(44);
    expect(result.criteria).toEqual({ met: 1, atRisk: 1, notMet: 1, pending: 1, total: 4 });
  });

  it("subtracts open risk flags from the score by severity", () => {
    const allMet = [{ status: "MET" }];
    const withHighFlag = computeReadiness(allMet, [{ severity: "HIGH" }]);
    expect(withHighFlag.score).toBe(90); // 100 - 10
  });

  it("forces BLOCKED when any open flag is CRITICAL, regardless of score", () => {
    const result = computeReadiness([{ status: "MET" }, { status: "MET" }], [{ severity: "CRITICAL" }]);
    expect(result.label).toBe("BLOCKED");
    expect(result.riskFlags.critical).toBe(1);
  });

  it("labels BLOCKED below 50, AT_RISK between 50 and 84, READY at 85+", () => {
    expect(computeReadiness([{ status: "NOT_MET" }], []).label).toBe("BLOCKED"); // score 0
    expect(computeReadiness([{ status: "AT_RISK" }], []).label).toBe("AT_RISK"); // score 50
    expect(computeReadiness([{ status: "MET" }], []).label).toBe("READY"); // score 100
  });

  it("never lets the penalty push the score below 0", () => {
    const result = computeReadiness([{ status: "NOT_MET" }], [{ severity: "CRITICAL" }, { severity: "CRITICAL" }, { severity: "HIGH" }]);
    expect(result.score).toBe(0);
  });
});
