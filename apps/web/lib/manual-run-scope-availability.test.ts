import { expect, it } from "vitest";
import { admittedManualRunProgress } from "./manual-run-scope-availability";
const fixture = () => ({ plannedCaseIds: ["a", "b", "missing"], unavailableCases: [{ testCaseId: "missing", reason: "MISSING_CASE_AND_FROZEN_DEFINITION" }], scopeAvailability: { plannedCount: 3, availableCount: 2, unavailableCount: 1, complete: false, procedureBasis: "LEGACY_CURRENT_CASE_DEFINITIONS" }, cases: [{ testCaseId: "a", currentResult: { status: "PASS" } }, { testCaseId: "b", currentResult: null }] });
it("missing planned case stays in recorded denominator and remaining, separate from executable cases", () => {
  const value = fixture(), before = structuredClone(value);
  expect(admittedManualRunProgress(value)).toMatchObject({ plannedCount: 3, availableCount: 2, recorded: 1, remaining: 2, percentRecorded: 33, unavailableCaseIds: ["missing"] });
  expect(value).toEqual(before);
});
it.each(["duplicate", "foreign", "overlap", "missing-partition", "count", "basis", "unsupported-reason", "unavailable-duplicate", "invalid-id"])("%s refuses instead of guessed shortened or full completion", kind => {
  const value = fixture();
  if (kind === "duplicate") value.plannedCaseIds.push("a");
  if (kind === "foreign") value.cases[0]!.testCaseId = "other";
  if (kind === "overlap") value.unavailableCases[0]!.testCaseId = "a";
  if (kind === "missing-partition") value.unavailableCases = [];
  if (kind === "count") value.scopeAvailability.plannedCount = 2;
  if (kind === "basis") value.scopeAvailability.procedureBasis = "INFERRED";
  if (kind === "unsupported-reason") value.unavailableCases[0]!.reason = "UNKNOWN";
  if (kind === "unavailable-duplicate") value.unavailableCases.push(value.unavailableCases[0]!);
  if (kind === "invalid-id") value.plannedCaseIds[0] = "\ud800";
  expect(admittedManualRunProgress(value)).toBeNull();
});
it("missing new native metadata refuses presentation; it cannot adopt an old API response's available count", () => {
  expect(admittedManualRunProgress({ ...fixture(), scopeAvailability: undefined })).toBeNull();
  expect(admittedManualRunProgress({ ...fixture(), plannedCaseIds: undefined })).toBeNull();
});
it("thousand-case scope and genuine empty scope remain exact, over-limit refuses without clipping", () => {
  const ids = Array.from({ length: 1000 }, (_, i) => `case-${i}`);
  const value = { plannedCaseIds: ids, unavailableCases: [], scopeAvailability: { plannedCount: 1000, availableCount: 1000, unavailableCount: 0, complete: true, procedureBasis: "FROZEN_RUN_DEFINITIONS" }, cases: ids.map(testCaseId => ({ testCaseId, currentResult: null })) };
  expect(admittedManualRunProgress(value)?.remaining).toBe(1000);
  expect(admittedManualRunProgress({ ...value, plannedCaseIds: [...ids, "extra"] })).toBeNull();
  expect(admittedManualRunProgress({ plannedCaseIds: [], unavailableCases: [], cases: [], scopeAvailability: { ...value.scopeAvailability, plannedCount: 0, availableCount: 0 } })).toMatchObject({ plannedCount: 0, remaining: 0, percentRecorded: 0 });
});
