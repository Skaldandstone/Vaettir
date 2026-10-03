import { describe, it, expect } from "vitest";
import {
  capturedReportEvidence,
  reportEvidenceSchema,
} from "./reportSnapshotEvidence.js";
describe("immutable bounded report evidence", () => {
  it("preserves blocked, unmatched, repeated and not-recorded observations without a final verdict", () => {
    const row = capturedReportEvidence(
      [
        {
          id: "case",
          displayId: "SYN-1",
          priority: "HIGH",
          automationStatus: "MANUAL",
        },
        {
          id: "none",
          displayId: "SYN-2",
          priority: "LOW",
          automationStatus: "MANUAL",
        },
      ],
      [
        {
          id: "run",
          startedAt: new Date("2020-01-15T12:00Z"),
          ciProvider: "manual",
          manualTestCaseIds: ["case", "case", "none"],
        },
      ],
      [{ testCaseId: "case", status: "BLOCKED", _count: { _all: 2 } }],
      [
        { testRunId: "run", status: "BLOCKED", _count: { _all: 2 } },
        { testRunId: "run", status: "FAIL", _count: { _all: 1 } },
      ],
      new Set(["run:case"]),
    );
    expect(row.cases[0]?.outcomes).toEqual([{ key: "BLOCKED", count: 2 }]);
    expect(row.cases[1]?.outcomes).toEqual([]);
    expect(row.runs[0]).toMatchObject({
      plannedCases: 2,
      notRecordedCases: 1,
      outcomes: [
        { key: "BLOCKED", count: 2 },
        { key: "FAIL", count: 1 },
      ],
    });
    expect(row.cases[1]).toMatchObject({ plannedRuns: 1, notRecordedRuns: 1 });
  });
  it("rejects unsupported provenance versions and negative counts", () => {
    expect(
      reportEvidenceSchema.safeParse({ version: 2, cases: [], runs: [] })
        .success,
    ).toBe(false);
    expect(
      reportEvidenceSchema.safeParse({
        version: 1,
        cases: [],
        runs: [
          {
            id: "run",
            startedAt: "2020-01-15T12:00:00Z",
            provider: "manual",
            outcomes: [],
            plannedCases: -1,
            notRecordedCases: 0,
          },
        ],
      }).success,
    ).toBe(false);
  });
});
