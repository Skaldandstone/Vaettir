import { expect, it } from "vitest";
import {
  manualRunScopeAvailability,
  requireCompleteManualRunScopeAvailability,
} from "./manualRunScopeAvailability.js";
it("missing legacy planned IDs remain ordered read-only unavailable metadata and cannot shrink the denominator or complete", () => {
  const result = manualRunScopeAvailability(["c", "a", "b"], ["a", "c"], null);
  expect(result.availableCaseIds).toEqual(["c", "a"]);
  expect(result.plannedCaseIds).toEqual(["c", "a", "b"]);
  expect(result.unavailableCases).toEqual([
    { testCaseId: "b", reason: "MISSING_CASE_AND_FROZEN_DEFINITION" },
  ]);
  expect(result.scopeAvailability).toEqual({
    plannedCount: 3,
    availableCount: 2,
    unavailableCount: 1,
    complete: false,
    procedureBasis: "LEGACY_CURRENT_CASE_DEFINITIONS",
  });
  expect(() => requireCompleteManualRunScopeAvailability(result)).toThrow(
    /Completion is refused/,
  );
  expect(result.unavailableCases[0]).not.toHaveProperty("steps");
});
it("frozen definitions support every planned identity even when its current mutable case no longer exists; retained order is saved plan order", () => {
  const result = manualRunScopeAvailability(["b", "a"], [], ["a", "b"]);
  expect(result.availableCaseIds).toEqual(["b", "a"]);
  expect(result.scopeAvailability.procedureBasis).toBe(
    "FROZEN_RUN_DEFINITIONS",
  );
  expect(result.unavailableCases).toEqual([]);
  expect(() => requireCompleteManualRunScopeAvailability(result)).not.toThrow();
});
it.each([
  [["a", "a"], ["a"], null],
  [["a"], ["a", "a"], null],
  [["a"], ["foreign"], null],
  [["a", "b"], ["a", "b"], ["a"]],
  [["a"], ["a"], ["a", "a"]],
  [["a"], ["a"], ["foreign"]],
  [["a\0b"], [], null],
  [["\ud800"], [], null],
  [["x".repeat(201)], [], null],
  [["a"], [], undefined],
])(
  "unsupported scope/current/frozen identities refuse without partial repair: %j",
  (planned, current, frozen) => {
    expect(() => manualRunScopeAvailability(planned, current, frozen)).toThrow(
      /unsupported/,
    );
  },
);
it("exact thousand-case boundary is retained, thousand-and-one refuses without splitting or truncation", () => {
  const ids = Array.from({ length: 1000 }, (_, i) => `case-${i}`);
  expect(
    manualRunScopeAvailability(ids, ids, null).scopeAvailability.plannedCount,
  ).toBe(1000);
  expect(() =>
    manualRunScopeAvailability([...ids, "extra"], ids, null),
  ).toThrow(/unsupported/);
});
it("genuine empty legacy scope is distinguishable from a missing case, never inferred by dropping IDs", () => {
  const empty = manualRunScopeAvailability([], [], null),
    missing = manualRunScopeAvailability(["a"], [], null);
  expect(empty.scopeAvailability.plannedCount).toBe(0);
  expect(empty.unavailableCases).toEqual([]);
  expect(missing.scopeAvailability.plannedCount).toBe(1);
  expect(missing.scopeAvailability.unavailableCount).toBe(1);
});
