// SOURCE ONLY: authored NOT RUN. Native DB/router/render acceptance remains open.
import { describe, it, expect } from "vitest";
import { caseExecutionWholeCaseSummarySchema } from "./caseExecutionWholeCaseSummary.js";
import { caseExecutionHistoryItemSchema } from "./caseExecutionHistory.js";
const value = { revisionCount: 2, correctionCount: 1, lastRecorderName: "Recorded human label", lastRecordedAt: "2026-01-02T12:00:00.000Z", lastStatus: "PASS" as const };
describe("whole-case history summary boundaries (NOT RUN)", () => {
  it("preserves exact retained metadata and allows a first tracked legacy correction", () => {
    expect(caseExecutionWholeCaseSummarySchema.parse(value)).toEqual(value);
    expect(caseExecutionWholeCaseSummarySchema.parse({ ...value, revisionCount: 1, correctionCount: 1 }).correctionCount).toBe(1);
  });
  it("refuses unsupported counts, names, timestamps, case vocabulary and extra private payloads", () => {
    for (const change of [{ revisionCount: 0 }, { revisionCount: 101 }, { correctionCount: 3 }, { correctionCount: -1 },
      { lastRecorderName: "" }, { lastRecorderName: "x".repeat(201) }, { lastRecordedAt: "invalid" }, { lastStatus: "FLAKY" }, { note: "private payload" }])
      expect(caseExecutionWholeCaseSummarySchema.safeParse({ ...value, ...change }).success).toBe(false);
  });
  it("old absence and explicit untracked null remain distinct from positive recorded revision evidence", () => {
    const field = caseExecutionHistoryItemSchema.shape.wholeCase;
    expect(field.parse(undefined)).toBeUndefined();
    expect(field.parse(null)).toBeNull();
    expect(field.parse(value)).toEqual(value);
    expect(field.safeParse({ revisionCount: 0 }).success).toBe(false);
  });
});
