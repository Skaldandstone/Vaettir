// SOURCE ONLY: authored, not executed tonight.
import { describe, expect, it } from "vitest";
import { requirementCoverageExportInput, requirementCoverageExportOutput, type RequirementCoverageExport } from "./requirementCoverageExportSchema.js";
import { requirementCoverageRequestKey } from "./requirementCoverageSchema.js";
const zero = { PASS: 0, FAIL: 0, FLAKY: 0, SKIP: 0, BLOCKED: 0, total: 0, state: "NO_RECORDED_RESULT" as const };
const sample = (): RequirementCoverageExport => ({ version: 1, projectId: "private-project", organizationId: "private-org", actorClerkUserId: "private-actor",
  requested: "private-query-key", observedAt: "2026-09-30T12:00:00.000Z", window: { start: "2026-09-01T00:00:00.000Z", end: "2026-09-30T12:00:00.000Z" },
  appliedScope: null, searchPresence: false, selection: { mode: "SEARCH_OR_ALL", requirementCount: 1 },
  population: { requirements: 1, unlinkedRequirements: 1, directPairs: 0, distinctCases: 0, archivedCases: 0, distinctCaseResultRecords: 0, distinctCaseOutcomes: { ...zero } },
  rows: [{ requirementOrdinal: 1, requirementTitle: "Unlinked requirement", titleIsExcerpt: false, case: null, outcomes: { ...zero }, plannedWithoutResult: 0 }],
  limits: ["No coverage or readiness verdict"] });
describe("complete requirement matrix export contract", () => {
  it("retains omitted legacy actor keys and adds only explicit actor to the exact request", () => {
    const old = requirementCoverageExportInput.parse({ projectId: "p", asOf: "2026-09-30T12:00:00Z" });
    expect(Object.hasOwn(old, "expectedClerkActorId")).toBe(false);
    expect(requirementCoverageRequestKey({ ...old, expectedClerkActorId: undefined })).toBe(requirementCoverageRequestKey(old));
    expect(requirementCoverageRequestKey({ ...old, expectedClerkActorId: "actor" })).not.toBe(requirementCoverageRequestKey(old));
    expect(requirementCoverageExportInput.safeParse({ ...old, offset: 20 }).success).toBe(false);
    expect(requirementCoverageExportInput.safeParse({ ...old, requirementIds: ["private-id"] }).success).toBe(false);
  });
  it("preserves an unlinked requirement with literal zero counts and rejects fabricated outcomes", () => {
    const value = sample(); expect(requirementCoverageExportOutput.parse(value).rows[0]!.case).toBeNull();
    value.rows[0]!.outcomes.PASS = 1; value.rows[0]!.outcomes.total = 1; value.rows[0]!.outcomes.state = "RECORDED_OUTCOMES";
    expect(requirementCoverageExportOutput.safeParse(value).success).toBe(false);
  });
  it("repeated linked cases repeat rows but retain one unique outcome denominator", () => {
    const value = sample(), outcomes = { ...zero, PASS: 2, total: 2, state: "RECORDED_OUTCOMES" as const };
    const row = { requirementOrdinal: 1, requirementTitle: "Same title", titleIsExcerpt: false,
      case: { displayId: "SYN-01", title: "Case", titleIsExcerpt: false, archived: true }, outcomes, plannedWithoutResult: 1 };
    value.rows = [row, { ...row, requirementOrdinal: 2 }]; value.selection.requirementCount = 2;
    value.population = { requirements: 2, unlinkedRequirements: 0, directPairs: 2, distinctCases: 1, archivedCases: 1, distinctCaseResultRecords: 2, distinctCaseOutcomes: outcomes };
    expect(requirementCoverageExportOutput.safeParse(value).success).toBe(true);
    value.population.distinctCaseResultRecords = 4;
    expect(requirementCoverageExportOutput.safeParse(value).success).toBe(false);
  });
  it("refuses duplicate pair rows, skipped ordinals and repeated inconsistent titles", () => {
    const duplicate = sample(); duplicate.rows.push(structuredClone(duplicate.rows[0]!));
    expect(requirementCoverageExportOutput.safeParse(duplicate).success).toBe(false);
    const missing = sample(); missing.rows[0]!.requirementOrdinal = 2;
    expect(requirementCoverageExportOutput.safeParse(missing).success).toBe(false);
    const inconsistent = sample();
    inconsistent.rows = ["SYN-01", "SYN-02"].map(displayId => ({ ...sample().rows[0]!, case: { displayId, title: "Case", titleIsExcerpt: false, archived: false } }));
    inconsistent.population = { ...inconsistent.population, unlinkedRequirements: 0, directPairs: 2, distinctCases: 2 };
    expect(requirementCoverageExportOutput.safeParse(inconsistent).success).toBe(true);
    inconsistent.rows[1]!.requirementTitle = "Different title for same ordinal";
    expect(requirementCoverageExportOutput.safeParse(inconsistent).success).toBe(false);
  });
  it("refuses private raw row fields and complete populations above one thousand", () => {
    expect(requirementCoverageExportOutput.safeParse({ ...sample(), rows: [{ ...sample().rows[0], requirementId: "private-native-id", rawNotes: "private" }] }).success).toBe(false);
    const value = sample(); value.rows = Array.from({ length: 1001 }, (_, index) => ({ ...value.rows[0]!, requirementOrdinal: index + 1 }));
    expect(requirementCoverageExportOutput.safeParse(value).success).toBe(false);
  });
});
