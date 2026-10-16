import { describe, expect, it } from "vitest";
import {
  releaseClosureId,
  releaseVerificationMetrics,
} from "./jiraReleaseEvidence.js";
const cases = ["a", "b", "c"].map((id) => ({
  id,
  displayId: `P-${id}`,
  title: id,
  priority: "HIGH",
  reviewStatus: "APPROVED",
}));
const run = (id: string, day: number, planned = ["a", "b", "c"]) => ({
  id,
  status: "RUNNING",
  ciProvider: "manual",
  startedAt: new Date(`2026-10-${day}T00:00:00Z`),
  finishedAt: null,
  commitSha: "manual",
  branch: "manual",
  manualTestCaseIds: planned,
});
describe("release-specific verification metrics", () => {
  it("does not let old passes hide unrecorded tests in a newer selected validation run", () => {
    const summary = releaseVerificationMetrics(
      "p",
      cases,
      [run("old", 15), run("new", 16)],
      [
        { testCaseId: "a", testRunId: "old", status: "PASS" },
        { testCaseId: "b", testRunId: "new", status: "FAIL" },
      ],
    );
    expect(summary.counts).toMatchObject({
      planned: 3,
      recorded: 1,
      notRecorded: 2,
      fail: 1,
      pass: 0,
    });
    expect(summary.tests.find((c) => c.id === "a")?.outcome).toBe(
      "NOT_RECORDED",
    );
  });
  it("keeps parameters, tied runs, blocked/skipped/flaky and unmatched observations distinct", () => {
    const summary = releaseVerificationMetrics(
      "p",
      cases,
      [run("1", 16), run("2", 16)],
      [
        { testCaseId: "a", testRunId: "1", status: "PASS" },
        { testCaseId: "a", testRunId: "1", status: "FAIL" },
        { testCaseId: null, testRunId: "2", status: "PASS" },
        { testCaseId: "outside", testRunId: "2", status: "FAIL" },
      ],
    );
    expect(summary.counts).toMatchObject({
      recorded: 1,
      ambiguous: 1,
      notRecorded: 2,
      pass: 0,
    });
    expect(summary.recordedFailures).toBe(2);
    expect(summary.unmatchedObservations).toBe(1);
    expect(summary.outsideCohortObservations).toBe(1);
    const mixed = releaseVerificationMetrics(
      "p",
      cases,
      [run("1", 16)],
      [
        { testCaseId: "a", testRunId: "1", status: "PASS" },
        { testCaseId: "a", testRunId: "1", status: "FAIL" },
        { testCaseId: "b", testRunId: "1", status: "BLOCKED" },
        { testCaseId: "c", testRunId: "1", status: "SKIP" },
      ],
    );
    expect(mixed.counts).toMatchObject({
      mixed: 1,
      blocked: 1,
      skipped: 1,
      pass: 0,
      notRecorded: 0,
    });
  });
  it("requires exact run identity and keeps closure identity independent of later case and metric edits", () => {
    expect(() =>
      releaseVerificationMetrics(
        "p",
        cases,
        [run("1", 16)],
        [{ testCaseId: "a", testRunId: "foreign", status: "PASS" }],
      ),
    ).toThrow();
    const identity = {
      installationId: "installation",
      environmentId: "development",
      cloudId: "cloud",
      targetId: "jira-project",
    };
    expect(releaseClosureId("p", identity, "version")).toBe(
      releaseClosureId("p", identity, "version"),
    );
    expect(releaseClosureId("p", identity, "version")).not.toBe(
      releaseClosureId(
        "p",
        { ...identity, installationId: "new-installation" },
        "version",
      ),
    );
  });
});
