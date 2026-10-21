import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@vaettir/db";
import { historicalDate, historicalReviewSchema, historicalTable, previewHistoricalResults } from "./historicalResultsImport.js";

const cases = [
  { id: "case-a", displayId: "old-01", caseNumber: 1, title: "Login", source: { externalTestId: "google-sheets:book:project:0:old-1" } },
  { id: "case-b", displayId: "TEST-2", caseNumber: 2, title: "Repeated title", source: { externalTestId: "google-sheets:book:project:1:old-1" } },
  { id: "case-c", displayId: "TEST-3", caseNumber: 3, title: "Repeated title", source: null },
];
function db() { return { project: { findUniqueOrThrow: vi.fn(async () => ({ organizationId: "org", caseKey: "new" })) }, projectCaseKeyAlias: { findMany: vi.fn(async () => [{ caseKey: "old" }, { caseKey: "middle" }]) }, testCase: { findMany: vi.fn(async () => cases) } } as unknown as PrismaClient; }
const input = (csvText: string) => historicalReviewSchema.parse({ projectId: "project", sourceRef: "file:plan.csv", runLabel: "October run", csvText, mapping: { caseId: "ID", title: "Title", result: "Result" }, runDate: "2026-01-12" });

describe("historical date provenance", () => {
  const now = new Date("2026-10-21T00:00:00Z");
  it("validates real dates and requires explicit ambiguous date order", () => {
    expect(historicalDate("03/04/2025", "mdy", now)).toBe("2025-03-04");
    expect(historicalDate("03/04/2025", "dmy", now)).toBe("2025-04-03");
    expect(historicalDate("2024-02-29", "iso", now)).toBe("2024-02-29");
    for (const raw of ["", "03/04/2025", "2025-02-29", "2026-04-31", "2026-10-22", "1899-01-01"]) expect(() => historicalDate(raw, "iso", now)).toThrow();
  });
  it("converts only explicitly selected Excel dates, excluding the fictitious leap day", () => {
    expect(historicalDate("1", "excel1900", now)).toBe("1900-01-01");
    expect(historicalDate("61.5", "excel1900", now)).toBe("1900-03-01");
    for (const raw of ["60", "0", "-1", "NaN", "2958466"]) expect(() => historicalDate(raw, "excel1900", now)).toThrow();
    expect(() => historicalDate("61", "iso", now)).toThrow();
  });
});
describe("historical review boundaries", () => {
  it("resolves live, original and intermediate project keys without accepting foreign aliases", async () => {
    const client = db();
    for (const label of ["new-01", "old-01", "middle-01", "NEW-01"]) {
      const result = await previewHistoricalResults(client, input(`ID,Title,Result\n${label},,pass`));
      expect(result.rows[0]!.caseId).toBe("case-a"); expect(result.blockedCount).toBe(0);
    }
    const denied = await previewHistoricalResults(client, input("ID,Title,Result\nforeign-01,,pass"));
    expect(denied.rows[0]!.caseId).toBeNull();
    expect(client.projectCaseKeyAlias.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { projectId: "project", organizationId: "org", caseKey: { in: ["foreign"] } } }));
    const manual = await previewHistoricalResults(client, { ...input("ID,Title,Result\nmissing,,pass"), caseSelections: { "2": "middle-01" } });
    expect(manual.rows[0]!.caseId).toBe("case-a");
  });
  it("binds original worksheet row references to review, without calling normalized CSV records physical rows", async () => {
    const source = input("ID,Title,Result\ncase-a,,pass");
    const plain = await previewHistoricalResults(db(), source);
    const worksheet = await previewHistoricalResults(db(), { ...source, sourceRowNumbers: [5, 9] });
    expect(plain.rows[0]).toMatchObject({ rowNumber: 2, originalWorksheetRow: null });
    expect(worksheet.rows[0]).toMatchObject({ rowNumber: 2, originalWorksheetRow: 9 });
    expect(plain.fingerprint).not.toBe(worksheet.fingerprint);
    for (const sourceRowNumbers of [[5], [9, 5], [5, 5]]) await expect(previewHistoricalResults(db(), { ...source, sourceRowNumbers })).rejects.toThrow(/row references/);
  });
  it("keeps matching project-scoped, supports native/display IDs and does not guess past a bad ID", async () => {
    const client = db(), value = await previewHistoricalResults(client, input("ID,Title,Result\nVAE-case-a,wrong,pass\nTEST-2,wrong,fail\nmissing,Login,pass"));
    expect(client.testCase.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { projectId: "project" } }));
    expect(value.rows.map(r => r.caseId)).toEqual(["case-a", "case-b", null]);
    expect(value.blockedCount).toBe(1);
  });
  it("blocks ambiguous external IDs/titles and foreign manual IDs; requires a reviewed local choice", async () => {
    const source = input("ID,Title,Result\nold-1,Login,pass\n,Repeated title,fail");
    const blocked = await previewHistoricalResults(db(), source);
    expect(blocked.blockedCount).toBe(2);
    expect(blocked.rows[0]!.candidates).toHaveLength(2);
    const foreign = await previewHistoricalResults(db(), { ...source, caseSelections: { "2": "foreign-id", "3": "case-c" } });
    expect(foreign.rows[0]!.issues).toContain("That case is not in this project.");
    const chosen = await previewHistoricalResults(db(), { ...source, caseSelections: { "2": "case-a", "3": "case-c" } });
    expect(chosen.blockedCount).toBe(0);
    expect(chosen.fingerprint).not.toBe(blocked.fingerprint);
  });
  it("never treats blank/not-run cells as executed or prototype names as statuses", async () => {
    const source = input("ID,Title,Result\n,,\n,,Not run\ncase-a,,constructor\ncase-b,,custom");
    const value = await previewHistoricalResults(db(), source);
    expect(value.ignoredCount).toBe(2); expect(value.blockedCount).toBe(2);
    const mapped = await previewHistoricalResults(db(), { ...source, statusMap: { constructor: "PASS", custom: "BLOCKED" } });
    expect(mapped.blockedCount).toBe(0); expect(mapped.matchedCount).toBe(2);
  });
  it("blocks duplicate case/date observations and never fills a missing date", async () => {
    const source = input("ID,Title,Result\ncase-a,,pass\nold-01,,fail");
    const value = await previewHistoricalResults(db(), source);
    expect(value.blockedCount).toBe(2);
    const missing = await previewHistoricalResults(db(), { ...source, runDate: "" });
    expect(missing.rows.every(r => r.date === "" && r.issues.length > 0)).toBe(true);
  });
  it("binds the exact reviewed source snapshot as well as case and result decisions", async () => {
    const a = await previewHistoricalResults(db(), input("ID,Title,Result\ncase-a,,pass\ncase-b,,fail"));
    const b = await previewHistoricalResults(db(), input("ID,Title,Result\ncase-b,,fail\ncase-a,,pass"));
    const c = await previewHistoricalResults(db(), input("ID,Title,Result\ncase-a,,fail\ncase-b,,fail"));
    expect(a.fingerprint).not.toBe(b.fingerprint); expect(a.fingerprint).not.toBe(c.fingerprint);
    const source = input("ID,Title,Result\ncase-a,,pass\ncase-b,,fail");
    const sameMeaningDifferentChoice = await previewHistoricalResults(db(), { ...source, mapping: { ...source.mapping, note: "Title" } });
    expect(a.fingerprint).not.toBe(sameMeaningDifferentChoice.fingerprint);
  });
  it("rejects malformed/wide/oversized CSV and caller-supplied authority or credentials", () => {
    for (const csv of ['ID,Result\n"unfinished,pass', "ID,ID\nx,pass", "ID,Result\nx,pass,extra", "ID,\nx,pass", "ID,Result"]) expect(() => historicalTable(csv)).toThrow();
    expect(() => historicalTable("ID,Result\nx," + "é".repeat(600000))).toThrow(/1 MiB/);
    for (const addition of [{ organizationId: "other" }, { actorId: "owner" }, { access_token: "no" }, { mapping: { result: "Result", token: "no" } }]) expect(historicalReviewSchema.safeParse({ ...input("ID,Title,Result\ncase-a,,pass"), ...addition }).success).toBe(false);
  });
});
