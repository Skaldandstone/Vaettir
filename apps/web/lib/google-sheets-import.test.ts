import { afterEach, describe, expect, it, vi } from "vitest";
import { GOOGLE_SHEETS_SCOPE, parseSheetBook, readSheetBook, readSheetSnapshot, sheetValuesCsv, validSheetToken, worksheetRange } from "./google-sheets-import";

const tab = { id: 0, title: "Owner's cases", rows: 1000, columns: 26 };
const book = { id: "synthetic_book", title: "Synthetic workbook", tabs: [tab] };
afterEach(() => vi.unstubAllGlobals());
describe("selected Google Sheets reads", () => {
  it("rejects missing/broad/incrementally combined scopes and expired tokens", () => {
    expect(validSheetToken({ access_token: "synthetic-token", scope: GOOGLE_SHEETS_SCOPE, expires_in: 3600 })).toBe("synthetic-token");
    for (const scope of [undefined, "https://www.googleapis.com/auth/drive", `${GOOGLE_SHEETS_SCOPE} https://www.googleapis.com/auth/drive.metadata.readonly`])
      expect(() => validSheetToken({ access_token: "never-log", scope, expires_in: 3600 })).toThrow(/permission/);
    expect(() => validSheetToken({ access_token: "never-log", scope: GOOGLE_SHEETS_SCOPE, expires_in: 1 })).toThrow(/permission/);
  });
  it("validates selected workbook identity and escapes literal worksheet names", async () => {
    expect(worksheetRange(tab)).toBe("'Owner''s cases'");
    expect(() => parseSheetBook("wanted", { spreadsheetId: "other" })).toThrow(/different/);
    await expect(readSheetBook("../secrets", "synthetic", new AbortController().signal)).rejects.toThrow(/valid/);
  });
  it("preserves multiline, quoted and formula-looking text without evaluation", () => {
    expect(sheetValuesCsv({ values: [["Title", "Steps"], ["=SUM(1,2)", 'Line 1\n"Line 2"']] })).toBe('"Title","Steps"\r\n"=SUM(1,2)","Line 1\n""Line 2"""');
    expect(() => sheetValuesCsv({ values: [["Title"], ...Array(2501).fill(["Too many"])] })).toThrow(/2,500/);
    expect(() => sheetValuesCsv({ values: [["Title"], Array(101).fill("x")] })).toThrow(/100 columns/);
  });
  it("uses only bounded GET requests to Google and a header token, without cache/cookies/redirects", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ values: [["ID", "Title"], ["a", "Synthetic case"]] })));
    vi.stubGlobal("fetch", fetcher);
    const result = await readSheetSnapshot(book, tab, "synthetic-token", new AbortController().signal);
    expect(result.source).toEqual({ spreadsheetId: book.id, sheetId: tab.id });
    const [url, options] = fetcher.mock.calls[0]!;
    expect(String(url)).toMatch(/^https:\/\/sheets\.googleapis\.com\/v4\/spreadsheets\/synthetic_book\/values\//);
    expect(String(url)).not.toContain("synthetic-token");
    expect(options).toMatchObject({ method: "GET", credentials: "omit", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer", headers: { Authorization: "Bearer synthetic-token" } });
  });
  it("rejects oversized responses and excess populated rows instead of silently truncating", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("x".repeat(1024 * 1024 + 1))));
    await expect(readSheetSnapshot(book, tab, "synthetic", new AbortController().signal)).rejects.toThrow(/1 MiB/);
    expect(() => sheetValuesCsv({ values: [["Title"], ...Array(2501).fill(["Populated row"])] })).toThrow(/2,500/);
  });
  it("discards provider error bodies rather than showing credentials or row content", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("private-account-or-token", { status: 403 })));
    await expect(readSheetSnapshot(book, tab, "synthetic", new AbortController().signal)).rejects.toThrow("Google Sheets could not read this selection. Check your access, or authorize again.");
  });
});
