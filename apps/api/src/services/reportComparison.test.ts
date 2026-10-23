import { describe, expect, it } from "vitest";
import type { FrozenReportPayload } from "../routers/reportSnapshots.js";
import {
  compareApprovedReports,
  reportComparisonInput,
} from "./reportComparison.js";

// Source-only synthetic regressions authored tonight, NOT EXECUTED.
function payload(asOf: string): FrozenReportPayload {
  return {
    state: "approved",
    projectName: "Synthetic",
    title: "Reviewed synthetic status",
    definition: {
      audience: "stakeholders",
      windowDays: 7,
      sections: [
        "inventory",
        "execution",
        "traceability",
        "defects",
        "automation",
      ],
      summary: "Private author note",
      risks: "",
      nextActions: "",
    },
    asOf,
    windowStart: "2026-10-01T00:00:00.000Z",
    windowEnd: "2026-10-02T00:00:00.000Z",
    inventory: {
      active: 2,
      riskAssessed: 1,
      flaky: 0,
      automation: [{ key: "MANUAL", count: 2 }],
      priority: [{ key: "HIGH", count: 2 }],
    },
    execution: {
      runs: 1,
      results: 2,
      outcomes: [
        { key: "PASS", count: 1 },
        { key: "FAIL", count: 1 },
      ],
      distinctCases: 2,
      highPriorityCases: 2,
      highPriorityExecuted: 2,
    },
    traceability: {
      requirements: 1,
      coveredRequirements: 1,
      casesWithLinks: 1,
      links: 1,
    },
    defects: null,
    cohort: [
      { id: "private-case-a", status: "MANUAL" },
      { id: "private-case-b", status: "MANUAL" },
    ],
    automationChange: null,
    limitations: ["Synthetic fixture, not runtime proof."],
  };
}
const baseline = () => ({
  id: "a".repeat(64),
  payload: payload("2026-10-02T01:00:00.000Z"),
});
const later = () => ({
  id: "b".repeat(64),
  payload: payload("2026-10-03T01:00:00.000Z"),
});
describe("approved report comparisons", () => {
  it("keeps release identity exact and discloses frozen linked-plan membership changes", () => {
    const before = baseline(),
      after = later();
    for (const snapshot of [before, after]) {
      snapshot.payload.definition.executionScope = { releaseId: "release-a" };
      snapshot.payload.scope = {
        kind: "recorded-execution",
        filters: { releaseId: "release-a" },
        planName: null,
        contributingRunIds: [],
        cohortBasis: "Synthetic current release membership",
        releaseName: "Synthetic release",
        releaseNameIsExcerpt: false,
        releasePlanIds: ["plan-a"],
      };
    }
    expect(compareApprovedReports(before, after).scopeDescription).toContain(
      "Release: Synthetic release",
    );
    after.payload.scope!.releasePlanIds = ["plan-a", "plan-b"];
    expect(compareApprovedReports(before, after).limitations).toContain(
      "The frozen release-plan identity sets differ. Aggregate changes include current membership changes, not same-release execution improvements.",
    );
    after.payload.scope!.filters = { releaseId: "release-b" };
    expect(() => compareApprovedReports(before, after)).toThrow(
      "different scopes",
    );
  });
  it("rejects duplicate, unbounded and arbitrary selectors", () => {
    expect(
      reportComparisonInput.safeParse({
        projectId: "fixture",
        baselineId: "a".repeat(64),
        targetId: "a".repeat(64),
      }).success,
    ).toBe(false);
    expect(
      reportComparisonInput.safeParse({
        projectId: "fixture",
        baselineId: "a".repeat(64),
        targetId: "b".repeat(64),
        rawQuery: "SQL",
      }).success,
    ).toBe(false);
  });
  it("retains neutral deltas, unavailable evidence and original limitations without private identities or commentary", () => {
    const after = later();
    after.payload.execution.results = 3;
    after.payload.cohort = [
      { id: "private-case-b", status: "MANUAL" },
      { id: "private-case-c", status: "MANUAL" },
    ];
    const result = compareApprovedReports(baseline(), after);
    expect(
      result.rows.find((row) => row.label === "Recorded results")?.delta,
    ).toBe(1);
    expect(
      result.rows.find((row) => row.label === "Retained defect clusters"),
    ).toMatchObject({ baseline: null, target: null, delta: null });
    expect(
      result.rows.find((row) => row.label === "Planned pairs without a result")
        ?.delta,
    ).toBeNull();
    expect(result.cohort).toEqual({ common: 1, added: 1, removed: 1 });
    expect(result.sourceLimitations.baseline).toEqual(
      baseline().payload.limitations,
    );
    expect(JSON.stringify(result)).not.toContain("private-case");
    expect(JSON.stringify(result)).not.toContain("Private author note");
  });
  it("requires an earlier approved baseline and exactly matching scope", () => {
    const before = baseline(),
      after = later();
    expect(() => compareApprovedReports(after, before)).toThrow(/earlier/);
    before.payload.state = "preview";
    expect(() => compareApprovedReports(before, after)).toThrow(/approved/);
    before.payload.state = "approved";
    after.payload.scope = {
      kind: "recorded-execution",
      filters: { platform: "PC" },
      planName: null,
      contributingRunIds: [],
      cohortBasis: "Recorded cases",
    };
    expect(() => compareApprovedReports(before, after)).toThrow(
      /different scopes/,
    );
    before.payload.scope = {
      ...after.payload.scope,
      filters: { platform: "mobile" },
    };
    expect(() => compareApprovedReports(before, after)).toThrow(
      /different scopes/,
    );
  });
  it("uses only shared selected sections and exposes unequal windows instead of a misleading trend", () => {
    const before = baseline(),
      after = later();
    before.payload.definition.sections = ["execution"];
    after.payload.windowEnd = "2026-10-03T00:00:00.000Z";
    const result = compareApprovedReports(before, after);
    expect(result.sections).toEqual(["execution"]);
    expect(result.rows.every((row) => row.section === "execution")).toBe(true);
    expect(result.sameExecutionWindow).toBe(false);
    after.payload.definition.sections = ["inventory"];
    expect(() => compareApprovedReports(before, after)).toThrow(
      /no selected metric sections/,
    );
  });
  it("refuses ambiguous bucket data rather than masking it as zero", () => {
    const after = later();
    after.payload.execution.outcomes = [
      { key: "PASS", count: 1 },
      { key: "PASS", count: 2 },
    ];
    expect(() => compareApprovedReports(baseline(), after)).toThrow(/buckets/);
    after.payload.execution.outcomes = [{ key: "PASS", count: -1 }];
    expect(() => compareApprovedReports(baseline(), after)).toThrow(
      /unsupported/,
    );
  });
});
