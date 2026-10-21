import { describe, expect, it } from "vitest";
import { googleSheetsImportConfig, prepareGoogleSheetsImport } from "./googleSheetsImport.js";

const sheet = (id = 0, csvText = "Case ID,Title,Steps,Expected\ncase-1,Sign in,Submit login,Dashboard") => ({
  source: { spreadsheetId: "synthetic_book", sheetId: id }, name: `Tab ${id}`, csvText,
  mapping: { externalId: "Case ID", title: "Title", ...(csvText.split("\n")[0]!.includes("Steps") ? { when: "Steps" } : {}), ...(csvText.split("\n")[0]!.includes("Expected") ? { then: "Expected" } : {}) }, overrides: [],
});
describe("Google Sheets import boundaries", () => {
  it("defaults off and never returns unrelated secrets or Drive credentials", () => {
    expect(googleSheetsImportConfig({ GOOGLE_DRIVE_CLIENT_ID: "metadata-app", GOOGLE_DRIVE_CLIENT_SECRET: "private" })).toBeNull();
    const configured = googleSheetsImportConfig({ GOOGLE_SHEETS_CLIENT_ID: "1234-client.apps.googleusercontent.com", GOOGLE_SHEETS_PICKER_API_KEY: `AIza${"a".repeat(35)}`, GOOGLE_SHEETS_PROJECT_NUMBER: "123456789", GOOGLE_DRIVE_CLIENT_SECRET: "never-export" });
    expect(Object.keys(configured!)).toEqual(["clientId", "apiKey", "appId"]);
  });
  it("uses spreadsheet/tab IDs for repeatable identity, and distinguishes identical case IDs on different tabs", () => {
    const prepared = prepareGoogleSheetsImport([sheet(0), sheet(7)]);
    expect(prepared.rows.map(row => row.externalId)).toEqual(["0:case-1", "7:case-1"]);
    expect(prepared.keyPrefix).toBe("google-sheets:synthetic_book");
    expect(prepareGoogleSheetsImport([{ ...sheet(0), name: "Renamed worksheet" }]).rows[0]?.externalId).toBe("0:case-1");
    expect(prepared.rows[0]).toMatchObject({ testType: "OTHER", given: [], when: ["Submit login"], then: ["Dashboard"] });
  });
  it("rejects missing and duplicate case IDs before any commit", () => {
    expect(() => prepareGoogleSheetsImport([sheet(0, "Case ID,Title\n,Missing ID")])).toThrow(/case ID/);
    expect(() => prepareGoogleSheetsImport([sheet(0, "Case ID,Title\ncase-1,First\ncase-1,Second")])).toThrow(/unique/);
    expect(() => prepareGoogleSheetsImport([{ ...sheet(), mapping: { title: "Title" } }])).toThrow(/stable case ID/);
  });
  it("rejects invalid scopes, repeated tabs, missing titles and excess aggregate rows", () => {
    expect(() => prepareGoogleSheetsImport([sheet(), { ...sheet(3), source: { spreadsheetId: "foreign", sheetId: 3 } }])).toThrow(/one spreadsheet/);
    expect(() => prepareGoogleSheetsImport([sheet(), sheet()])).toThrow(/unique worksheets/);
    expect(() => prepareGoogleSheetsImport([sheet(0, "Case ID,Title,Steps\ncase-1,,Action")])).toThrow(/required titles/);
    const content = "Case ID,Title\n" + Array.from({ length: 1251 }, (_, i) => `case-${i},Example ${i}`).join("\n");
    expect(() => prepareGoogleSheetsImport([sheet(0, content), sheet(1, content)])).toThrow(/2,500/);
  });
});
