import { expect, it } from "vitest";
import { runProgress } from "./runProgress.js";
it("counts planned untested cases instead of calling an empty run complete", () => {
  expect(runProgress("manual", ["a", "b", "b"], [])).toMatchObject({
    total: 2,
    remaining: 2,
    percentComplete: 0,
  });
  expect(runProgress("manual", [], [])?.percentComplete).toBe(0);
});
it("completion is unique recorded planned identities, not pass rate or raw rows", () => {
  expect(
    runProgress(
      "manual",
      ["a", "b", "c", "d"],
      [
        { testCaseId: "a", status: "PASS", count: 2 },
        { testCaseId: "b", status: "FAIL", count: 1 },
        { testCaseId: "c", status: "SKIP", count: 1 },
        { testCaseId: "foreign", status: "PASS", count: 80 },
        { testCaseId: null, status: "PASS", count: 90 },
      ],
    ),
  ).toMatchObject({
    total: 4,
    recorded: 3,
    remaining: 1,
    percentComplete: 75,
    pass: 1,
  });
});
it("CI preserves its ingested cohort including unmatched and parameterized observations", () => {
  expect(
    runProgress(
      "github-actions",
      [],
      [
        { testCaseId: "a", status: "PASS", count: 2 },
        { testCaseId: "a", status: "FAIL", count: 1 },
        { testCaseId: null, status: "SKIP", count: 3 },
      ],
    ),
  ).toMatchObject({
    total: 6,
    recorded: 6,
    remaining: 0,
    percentComplete: 100,
    pass: 2,
    fail: 1,
    skip: 3,
  });
});
it("conflicting statuses for a planned case are unavailable regardless of input order", () => {
  const rows = [
    { testCaseId: "a", status: "PASS", count: 1 },
    { testCaseId: "a", status: "FAIL", count: 1 },
  ];
  expect(runProgress("manual", ["a"], rows)).toBeNull();
  expect(runProgress("manual", ["a"], [...rows].reverse())).toBeNull();
  expect(runProgress("manual", ["b"], rows)).toMatchObject({
    recorded: 0,
    remaining: 1,
  });
});
it("same-status duplicate groups collapse while outcome categories remain distinct", () => {
  expect(
    runProgress(
      "manual",
      ["a", "b", "c"],
      [
        { testCaseId: "a", status: "BLOCKED", count: 5 },
        { testCaseId: "a", status: "BLOCKED", count: 7 },
        { testCaseId: "b", status: "FLAKY", count: 2 },
        { testCaseId: "c", status: "FUTURE", count: 1 },
      ],
    ),
  ).toMatchObject({
    blocked: 1,
    flaky: 1,
    other: 1,
    recorded: 3,
    percentComplete: 100,
  });
});
it("oversized manual scopes and malformed counts are unavailable, not truncated", () => {
  expect(
    runProgress(
      "manual",
      Array.from({ length: 1001 }, (_, i) => String(i)),
      [],
    ),
  ).toBeNull();
  expect(
    runProgress(
      "manual",
      ["a"],
      [{ testCaseId: "a", status: "PASS", count: 0 }],
    ),
  ).toBeNull();
  expect(
    runProgress(
      "github-actions",
      [],
      [{ testCaseId: null, status: "PASS", count: -1 }],
    ),
  ).toBeNull();
});
