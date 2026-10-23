// SOURCE ONLY: authored, not executed tonight.
import { describe, expect, it } from "vitest";
import { caseExecutionHistoryInputSchema, caseHistoryFilterKey, caseHistoryRequestKey } from "./caseExecutionHistoryScopeSchema.js";
const legacy = { projectId: "project", testCaseId: "case", limit: 10 };
describe("case history bounded literal scope", () => {
  it("keeps omitted legacy fields absent and accepts the old run-only cursor", () => {
    expect(caseExecutionHistoryInputSchema.parse(legacy)).toEqual(legacy);
    expect(caseExecutionHistoryInputSchema.parse({ ...legacy, before: { runId: "run" } }).before).toEqual({ runId: "run" });
    expect(caseHistoryFilterKey(legacy)).toBe(JSON.stringify({ projectId: "project", testCaseId: "case" }));
  });
  it("validates inclusive dates, impossible/reversed/future/over90day dates", () => {
    expect(caseExecutionHistoryInputSchema.safeParse({ ...legacy, filters: { interval: { start: "2026-01-01", end: "2026-03-31" } } }).success).toBe(true);
    for (const interval of [{ start: "2026-02-30", end: "2026-03-01" }, { start: "2026-03-01", end: "2026-01-01" },
      { start: "2026-01-01", end: "2026-04-01" }, { start: "9999-01-01", end: "9999-01-02" }])
      expect(caseExecutionHistoryInputSchema.safeParse({ ...legacy, filters: { interval } }).success).toBe(false);
  });
  it("preserves exact casing and whitespace and refuses unsupported filter fields", () => {
    const input = caseExecutionHistoryInputSchema.parse({ ...legacy, filters: { platform: " PC ", build: "release-1", environment: "Lab\nA" } });
    expect(input.filters).toEqual({ platform: " PC ", build: "release-1", environment: "Lab\nA" });
    for (const filters of [{ platform: " " }, { build: "x".repeat(301) }, { environment: "x".repeat(2001) }, { commit: "not-a-build" }])
      expect(caseExecutionHistoryInputSchema.safeParse({ ...legacy, filters }).success).toBe(false);
  });
  it("canonical filter keys ignore insertion order but bind case/actor/org/date/literal scope", () => {
    const a = { ...legacy, originalOrganizationId: "org", expectedClerkActorId: "actor", filters: { platform: "PC", build: "b" } };
    expect(caseHistoryFilterKey(a)).toBe(caseHistoryFilterKey({ ...a, filters: { build: "b", platform: "PC" } }));
    expect(caseHistoryFilterKey(a)).not.toBe(caseHistoryFilterKey({ ...a, testCaseId: "other" }));
    expect(caseHistoryFilterKey(a)).not.toBe(caseHistoryFilterKey({ ...a, expectedClerkActorId: "other" }));
    expect(caseHistoryFilterKey(a)).not.toBe(caseHistoryFilterKey({ ...a, originalOrganizationId: "other" }));
    expect(caseHistoryFilterKey(a)).not.toBe(caseHistoryFilterKey({ ...a, filters: { platform: "pc", build: "b" } }));
    expect(caseHistoryRequestKey(a)).not.toBe(caseHistoryRequestKey({ ...a, limit: 11 }));
  });
});
