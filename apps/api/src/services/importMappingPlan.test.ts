import { describe, it, expect } from "vitest";
import { planMappingSheets } from "./importMappingPlan.js";
import { suggestCsvMapping } from "./csvFieldMapping.js";
const sheet = (csvText: string) => ({ name: "Cases", csvText, mapping: suggestCsvMapping(csvText.split("\n")[0]!.split(",")), overrides: [] });
describe("ready cases and independent mapping work", () => {
  it("recognizes ordinary plural headers without fuzzy guessing or ambiguous ties", () => {
    expect(suggestCsvMapping(["Test Case Summary", "Test Step(s)", "Expected Result(s)", "Pre-condition(s)"])).toEqual({ title: "Test Case Summary", given: "Pre-condition(s)", when: "Test Step(s)", then: "Expected Result(s)" });
    expect(suggestCsvMapping(["Summary", "Title", "Steps", "Actual Results"]).title).toBeUndefined();
    expect(suggestCsvMapping(["Step(s)", "Steps"]).when).toBeUndefined();
    expect(suggestCsvMapping(["Uncertain", "Observed action", "Actual result"])).toEqual({});
  });
  it("does not block a good row on another row's title or missing optional classification", () => {
    const result = planMappingSheets([sheet("Title,Steps,Expected Result\nLogin,Enter password,Home opens\n,Open settings,Settings opens")], "CSV");
    expect(result).toMatchObject({ readyCount: 1, pendingCount: 1 });
    expect(result.rows[0]).toMatchObject({ status: "READY", candidate: { title: "Login", testType: "OTHER" } });
    expect(result.rows[1]).toMatchObject({ status: "MAPPING", original: { cells: ["", "Open settings", "Settings opens"] } });
  });
  it("keeps duplicate identities out of the ready subset, including the first occurrence", () => {
    const result = planMappingSheets([sheet("Title,Case ID\nA,X\nB,X\nC,Y")], "CSV");
    expect(result).toMatchObject({ readyCount: 1, pendingCount: 2 });
    expect(result.rows[0]?.reasons).toContain("Resolve duplicate source IDs.");
  });
  it("keeps historical columns and physical blank-row coordinates", () => {
    const result = planMappingSheets([sheet("Title,Steps,Result,Run date\n\n,Open,Passed,2026-10-01")], "CSV");
    expect(result.rows[0]).toMatchObject({ originalRowNumber: 3, hasHistoricalColumns: true, original: { cells: ["", "Open", "Passed", "2026-10-01"] } });
  });
  it("preserves source priority and explicit overrides; neither starts AI analysis", () => {
    const input = sheet("Title,Priority,Steps\nA,LOW,Click");
    expect(planMappingSheets([input], "CSV").rows[0]?.candidate.priority).toBe("LOW");
    expect(planMappingSheets([{ ...input, overrides: [{ rowNumber: 2, priority: "HIGH" }] }], "CSV").rows[0]?.candidate.priority).toBe("HIGH");
  });
  it.each(["CSV", "XLSX", "SHEETS"] as const)("supports zero-ready and all-ready %s without silently dropping rows", format => {
    const source = format === "SHEETS" ? { spreadsheetId: "sheet", sheetId: 4 } : undefined;
    const incomplete = { ...sheet("Title,Case ID,Steps\n,X,Click"), source };
    expect(planMappingSheets([incomplete], format)).toMatchObject({ readyCount: 0, pendingCount: 1 });
    const ready = { ...sheet("Title,Case ID,Steps\nA,X,Click"), source };
    const result = planMappingSheets([ready], format);
    expect(result).toMatchObject({ readyCount: 1, pendingCount: 0 });
    expect(result.rows[0]?.candidate.externalId).toBe("X");
    expect(result.rows[0]?.externalIdPrefix).toBe(format === "CSV" ? "" : format === "XLSX" ? "Cases:" : "4:");
  });
  it("requires stable Sheets IDs and rejects mismatched tabs/coordinates/oversized input", () => {
    const input = { ...sheet("Title,Steps\nA,Click"), source: { spreadsheetId: "sheet", sheetId: 4 } };
    expect(planMappingSheets([input], "SHEETS")).toMatchObject({ readyCount: 0, pendingCount: 1 });
    expect(() => planMappingSheets([input, { ...input, name: "Other" }], "SHEETS")).toThrow("unique tabs");
    expect(() => planMappingSheets([{ ...input, originalRowNumbers: [2] }], "XLSX")).toThrow("coordinates");
    expect(() => planMappingSheets([sheet("Title\n" + "x".repeat(16_385))], "CSV")).toThrow();
  });
});
