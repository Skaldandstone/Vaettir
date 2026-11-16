import { describe, it, expect } from "vitest";
import { planMappingSheets } from "./importMappingPlan.js";
import { mapCsvRows, suggestCsvMapping } from "./csvFieldMapping.js";
const sheet = (csvText: string) => ({ name: "Cases", csvText, mapping: suggestCsvMapping(csvText.split("\n")[0]!.split(",")), overrides: [] });
describe("ready cases and independent mapping work", () => {
  it.each(["CSV", "XLSX", "SHEETS"] as const)("queues every unresolved title row in %s without inferring a title or context from IDs", format => {
    const input = { ...sheet("Unknown,Case ID,Steps,Result\nOriginal name,X,Open,Passed\n,Y,,Failed\n,Verify settings,,"),
      source: format === "SHEETS" ? { spreadsheetId: "synthetic", sheetId: 4 } : undefined };
    const result = planMappingSheets([input], format);
    expect(result).toMatchObject({ readyCount: 0, pendingCount: 3, contextCount: 0 });
    expect(result.rows.map(row => row.candidate.title)).toEqual(["", "", ""]);
    expect(result.rows.map(row => row.original.cells)).toEqual([
      ["Original name", "X", "Open", "Passed"], ["", "Y", "", "Failed"], ["", "Verify settings", "", ""],
    ]);
    for (const row of result.rows) {
      expect(row.status).toBe("MAPPING"); expect(row.reasons).toContain("Map a case title.");
      expect(row.hasHistoricalColumns).toBe(true);
    }
  });
  it.each(["Title,Title,Steps\nFirst,Second,Open", "Unknown,Steps\nOriginal,Open"])("queues a missing or ambiguous mapped title column: %s", csvText => {
    const result = planMappingSheets([{ name: "Cases", csvText, mapping: { title: "Title", when: "Steps" }, overrides: [] }], "CSV");
    expect(result).toMatchObject({ readyCount: 0, pendingCount: 1, contextCount: 0 });
    expect(result.rows[0]?.candidate).toMatchObject({ title: "", when: ["Open"] });
    expect(result.rows[0]?.reasons).toEqual(["Choose an unambiguous title column.", "Map a case title."]);
  });
  it("keeps direct preview/import strict and retains reviewed row edits while a column is unresolved", () => {
    const csvText = "Unknown,Steps\nOriginal,Open";
    expect(() => mapCsvRows(csvText, { when: "Steps" })).toThrow('The "title" field must be mapped');
    const input = { name: "Cases", csvText, mapping: { when: "Steps" }, overrides: [{ rowNumber: 2, title: "Reviewed title", when: ["  Exact\n action "] }] };
    const result = planMappingSheets([input], "CSV");
    expect(result).toMatchObject({ readyCount: 0, pendingCount: 1 });
    expect(result.rows[0]?.candidate).toMatchObject({ title: "Reviewed title", when: ["  Exact\n action "] });
    expect(result.rows[0]?.original.cells).toEqual(["Original", "Open"]);
    const repaired = planMappingSheets([{ ...input, mapping: { ...input.mapping, title: "Unknown" } }], "CSV");
    expect(repaired).toMatchObject({ readyCount: 1, pendingCount: 0 });
  });
  it.each(["CSV", "XLSX", "SHEETS"] as const)("retains mapped suite and Preconditions in %s ready and queued candidates", format => {
    const input = { ...sheet("Title,ID,SuitePath,Preconditions,Steps,Expected\nReady,1,Parent / Child,Account exists,Open,Shown\n,2,Pending / Child,Session exists,Close,Hidden"),
      source: format === "SHEETS" ? { spreadsheetId: "synthetic", sheetId: 4 } : undefined };
    const result = planMappingSheets([input], format);
    expect(result).toMatchObject({ readyCount: 1, pendingCount: 1 });
    const prefix = format === "CSV" ? "" : "Cases / ";
    expect(result.rows[0]?.candidate).toMatchObject({ suitePath: prefix + "Parent / Child", given: ["Account exists"] });
    expect(result.rows[1]?.candidate).toMatchObject({ suitePath: prefix + "Pending / Child", given: ["Session exists"] });
    expect(result.rows[0]?.original.cells).toEqual(["Ready", "1", "Parent / Child", "Account exists", "Open", "Shown"]);
  });
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
