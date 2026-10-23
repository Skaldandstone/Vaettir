import AdmZip from "adm-zip";
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@vaettir/db";
import { parseXlsxWorkbook } from "./xlsxImport.js";
import { parseXlsxWorkbookIsolated } from "./xlsxImportIsolation.js";
import { historicalReviewSchema, previewHistoricalResults } from "./historicalResultsImport.js";
function book(twoCellPreamble = false) {
  const zip = new AdmZip();
  zip.addFile("xl/workbook.xml", Buffer.from('<workbook><sheets><sheet name="Past results" r:id="one"/></sheets></workbook>'));
  zip.addFile("xl/_rels/workbook.xml.rels", Buffer.from('<Relationships><Relationship Id="one" Target="worksheets/sheet1.xml"/></Relationships>'));
  const row = (r: number, values: string[]) => `<row r="${r}">${values.map((text, i) => `<c r="${String.fromCharCode(65 + i)}${r}" t="inlineStr"><is><t>${text}</t></is></c>`).join("")}</row>`;
  zip.addFile("xl/worksheets/sheet1.xml", Buffer.from(`<worksheet><sheetData>${row(1, twoCellPreamble ? ["Title", "January results"] : ["Old execution export"])}${row(5, ["ID", "Result", "Date"])}${row(9, ["case-a", "pass", "2025-01-01"])}</sheetData></worksheet>`));
  return zip.toBuffer();
}
describe("real historical XLSX parsing", () => {
  it("prefers the real execution table over a two-cell Title/January-results preamble", () => {
    expect(parseXlsxWorkbook(book(true), undefined, "results")[0]).toMatchObject({ headerRow: 5, headers: ["ID", "Result", "Date"], originalRowNumbers: [5, 9] });
  });
  it("accepts ID/Result/Date without changing the case-header heuristic, preserving sparse physical rows through matching", async () => {
    const bytes = book();
    expect(parseXlsxWorkbook(bytes)[0]!.csvText).toBeNull();
    const sheet = parseXlsxWorkbook(bytes, undefined, "results")[0]!;
    expect(sheet).toMatchObject({ headers: ["ID", "Result", "Date"], headerRow: 5, originalRowNumbers: [5, 9], rowCount: 1 });
    const db = { project: { findUniqueOrThrow: vi.fn(async () => ({ caseKey: "test", organizationId: "org" })) }, projectCaseKeyAlias: { findMany: vi.fn(async () => []) }, testCase: { findMany: vi.fn(async () => [{ id: "case-a", caseNumber: 1, displayId: "test-01", title: "Login", source: null }]) } } as unknown as PrismaClient;
    const review = await previewHistoricalResults(db, historicalReviewSchema.parse({ projectId: "project", sourceRef: "file:old.xlsx#Past results", runLabel: "Past results", csvText: sheet.csvText, sourceRowNumbers: sheet.originalRowNumbers, mapping: { caseId: "ID", result: "Result", date: "Date" } }));
    expect(review).toMatchObject({ matchedCount: 1, blockedCount: 0 });
    expect(review.rows[0]).toMatchObject({ rowNumber: 2, originalWorksheetRow: 9, date: "2025-01-01", status: "PASS", caseId: "case-a" });
  });
  it("keeps result/case parser cache entries separate in actual isolated workers", async () => {
    const bytes = book();
    expect((await parseXlsxWorkbookIsolated(bytes, undefined, "synthetic-history", undefined, "results"))[0]).toMatchObject({ headerRow: 5, originalRowNumbers: [5, 9] });
    expect((await parseXlsxWorkbookIsolated(bytes, undefined, "synthetic-history"))[0]!.csvText).toBeNull();
  });
});
