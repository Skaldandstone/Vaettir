import { describe, expect, it } from "vitest";
import { COMPLIANCE_STARTERS } from "./compliance-starters";
import { complianceCheckOutline, rankComplianceCandidates } from "./compliance-proposals";

describe("read-only compliance suggestions", () => {
  it("ranks shared terms while preserving exact case identity and stable ties", () => {
    const cases = Object.freeze([
      Object.freeze({ id: "a", title: "Unrelated behavior" }),
      Object.freeze({ id: "b", title: "License expiry blocks release" }),
      Object.freeze({ id: "c", title: "License credits" }),
      Object.freeze({ id: "d", title: "License inventory" }),
    ]);
    const result = rankComplianceCandidates({ title: "License expiry", description: "Review the release" }, cases);
    expect(result.map((item) => item.candidate.id)).toEqual(["b", "c", "d", "a"]);
    expect(result[0]?.matchedTerms).toEqual(["expiry", "license", "release"]);
    expect(result[0]?.candidate).toBe(cases[1]);
    expect(cases.map((item) => item.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("does not treat generic testing words as evidence and returns no pass or clearance decision", () => {
    const result = rankComplianceCandidates({ title: "Review license" }, [{ id: "one", title: "Review tests" }, { id: "two", title: "License not granted" }]);
    expect(result[0]).toEqual({ candidate: { id: "two", title: "License not granted" }, matchedTerms: ["license"] });
    expect(result[1]?.matchedTerms).toEqual([]);
    expect(rankComplianceCandidates({ title: "License" }, [])).toEqual([]);
  });

  it("offers bounded music check outlines, not invented legal clearance or saved cases", () => {
    const music = COMPLIANCE_STARTERS.find((starter) => starter.key === "music-rights-us")!;
    expect(music.controls).toHaveLength(8);
    expect(music.version).toContain("US review prompts");
    for (const control of music.controls) {
      const draft = complianceCheckOutline(music.key, control)!;
      expect(draft.action.length).toBeGreaterThan(30);
      expect(draft.evidence.length).toBeGreaterThan(30);
      expect(draft.prerequisite).toContain("responsible reviewer");
      expect(draft.expectedResult).toContain("do not infer a pass");
    }
    expect(complianceCheckOutline("music-rights-us", { ...music.controls[0]!, title: "Customer-specific terms" })).toBeNull();
    expect(complianceCheckOutline("music-rights-us", { ...music.controls[0]!, description: "Customer-specific scope" })).toBeNull();
    expect(complianceCheckOutline("music-rights-us", { ...music.controls[0]!, description: null })).toBeNull();
    expect(complianceCheckOutline("customer", music.controls[0]!)).toBeNull();
  });
});
