import { describe, it, expect } from "vitest";
import {
  assessPopulation,
  type AssessmentInput,
} from "./populationAssessment.js";
const empty: AssessmentInput = {
  documents: 0,
  requirements: 0,
  testCases: 0,
  approvedPlans: 0,
  latestRun: null,
  releases: [],
};
describe("project evidence assessment", () => {
  it("does not turn missing data into a readiness score", () => {
    const result = assessPopulation(empty);
    expect(result.overall).toBe("Readiness not established");
    expect(result.stages.every((stage) => stage.state === "missing")).toBe(
      true,
    );
    expect(result.actions[0]?.key).toBe("add-evidence");
  });
  it("records passing evidence without claiming release readiness", () => {
    const result = assessPopulation(
      {
        ...empty,
        documents: 1,
        requirements: 2,
        testCases: 8,
        approvedPlans: 1,
        latestRun: {
          id: "run",
          status: "PASSED",
          startedAt: new Date("2026-09-28"),
          finishedAt: new Date("2026-09-28"),
        },
        releases: [{ id: "release", name: "R1", status: "READY" }],
      },
      new Date("2026-09-29"),
    );
    expect(result.overall).toBe("Readiness not established");
    expect(result.stages[3]?.state).toBe("recorded");
    expect(result.releasePhases[0]?.basis).toContain("not inferred");
  });
  it("prioritizes failures and flags old/future evidence", () => {
    const run = {
      id: "run",
      status: "FAILED",
      startedAt: new Date("2026-09-28"),
      finishedAt: new Date("2026-09-28"),
    };
    expect(
      assessPopulation({ ...empty, latestRun: run }, new Date("2026-09-29"))
        .actions[0]?.key,
    ).toBe("inspect-run");
    expect(
      assessPopulation({ ...empty, latestRun: run }, new Date("2026-11-29"))
        .stages[3]?.summary,
    ).toContain("30 days");
    expect(
      assessPopulation({ ...empty, latestRun: run }, new Date("2026-08-29"))
        .stages[3]?.summary,
    ).toContain("future");
  });
});
