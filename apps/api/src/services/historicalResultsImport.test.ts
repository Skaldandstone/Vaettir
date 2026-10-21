import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@vaettir/db";
import { historicalDate, historicalReviewSchema, historicalTable, previewHistoricalResults } from "./historicalResultsImport.js";

const cases = [
  { id: "case-a", displayId: "TEST-1", title: "Login", source: { externalTestId: "google-sheets:book:project:0:old-1" } },
  { id: "case-b", displayId: "TEST-2", title: "Repeated title", source: { externalTestId: "google-sheets:book:project:1:old-1" } },
  { id: "case-c", displayId: "TEST-3", title: "Repeated title", source: null },
];
function db() { return { testCase: { findMany: vi.fn(async () => cases) } } as unknown as PrismaClient; }
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
    const source = input("ID,Title,Result\ncase-a,,pass\nTEST-1,,fail");
    const value = await previewHistoricalResults(db(), source);
    expect(value.blockedCount).toBe(2);
    const missing = await previewHistoricalResults(db(), { ...source, runDate: "" });
    expect(missing.rows.every(r => r.date === "" && r.issues.length > 0)).toBe(true);
  });
  it("fingerprints match decisions and content, with no dependence on row order", async () => {
    const a = await previewHistoricalResults(db(), input("ID,Title,Result\ncase-a,,pass\ncase-b,,fail"));
    const b = await previewHistoricalResults(db(), input("ID,Title,Result\ncase-b,,fail\ncase-a,,pass"));
    const c = await previewHistoricalResults(db(), input("ID,Title,Result\ncase-a,,fail\ncase-b,,fail"));
    expect(a.fingerprint).toBe(b.fingerprint); expect(a.fingerprint).not.toBe(c.fingerprint);
  });
  it("rejects malformed/wide/oversized CSV and caller-supplied authority or credentials", () => {
    for (const csv of ['ID,Result\n"unfinished,pass', "ID,ID\nx,pass", "ID,Result\nx,pass,extra", "ID,\nx,pass", "ID,Result"]) expect(() => historicalTable(csv)).toThrow();
    expect(() => historicalTable("ID,Result\nx," + "é".repeat(600000))).toThrow(/1 MiB/);
    for (const addition of [{ organizationId: "other" }, { actorId: "owner" }, { access_token: "no" }, { mapping: { result: "Result", token: "no" } }]) expect(historicalReviewSchema.safeParse({ ...input("ID,Title,Result\ncase-a,,pass"), ...addition }).success).toBe(false);
  });
});
