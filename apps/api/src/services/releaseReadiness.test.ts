import { describe, it, expect } from "vitest";
import { classifyReadinessTransition } from "./releaseReadiness.js";

describe("classifyReadinessTransition", () => {
  it("is a baseline when there is no previous snapshot", () => {
    expect(classifyReadinessTransition(null, { score: 90, label: "READY" })).toBe("baseline");
  });

  it("is unchanged when score and label both match", () => {
    expect(classifyReadinessTransition({ score: 90, label: "READY" }, { score: 90, label: "READY" })).toBe("unchanged");
  });

  it("is a score change when only the score moved inside the same label", () => {
    expect(classifyReadinessTransition({ score: 90, label: "READY" }, { score: 86, label: "READY" })).toBe("score_changed");
  });

  it("is a label change whenever the label moved, in either direction", () => {
    expect(classifyReadinessTransition({ score: 86, label: "READY" }, { score: 84, label: "AT_RISK" })).toBe("label_changed");
    expect(classifyReadinessTransition({ score: 40, label: "BLOCKED" }, { score: 90, label: "READY" })).toBe("label_changed");
  });

  it("treats a critical-flag block at the same score as a label change", () => {
    // Any open CRITICAL flag forces BLOCKED regardless of score (see
    // computeReadiness) - the score can stay put while the label flips.
    expect(classifyReadinessTransition({ score: 88, label: "READY" }, { score: 88, label: "BLOCKED" })).toBe("label_changed");
  });
});
