import AdmZip from "adm-zip";
import { describe, expect, it } from "vitest";
import { parseXlsxWorkbookIsolated } from "./xlsxImportIsolation.js";
import { XLSX_MAX_UPLOAD_BYTES } from "./xlsxImportLimits.js";

function smallWorkbook(): Buffer {
  const zip = new AdmZip();
  zip.addFile("xl/workbook.xml", Buffer.from('<?xml version="1.0" encoding="UTF-8"?><workbook><sheets><sheet name="Cases" r:id="one"/></sheets></workbook>'));
  zip.addFile("xl/_rels/workbook.xml.rels", Buffer.from('<Relationships><Relationship Id="one" Target="worksheets/sheet1.xml"/></Relationships>'));
  zip.addFile("xl/worksheets/sheet1.xml", Buffer.from('<worksheet><sheetData><row><c r="A1" t="inlineStr"><is><t>Title</t></is></c></row><row><c r="A2" t="inlineStr"><is><t>Login works</t></is></c></row></sheetData></worksheet>'));
  return zip.toBuffer();
}

describe("isolated Excel parsing", () => {
  it("parses the current source parser in a worker and releases its slot", async () => {
    const sheets = await parseXlsxWorkbookIsolated(smallWorkbook());
    expect(sheets[0]).toMatchObject({ name: "Cases", rowCount: 1, headers: ["Title"] });
    expect(sheets[0]?.csvText).toContain("Login works");
    expect(await parseXlsxWorkbookIsolated(smallWorkbook())).toEqual(sheets);
  });

  it("rejects invalid input without returning third-party parser details", async () => {
    await expect(parseXlsxWorkbookIsolated(Buffer.from("invalid workbook")))
      .rejects.toThrow("Workbook could not be read safely");
  });

  it("rejects uploads above the compressed-byte cap before starting a worker", async () => {
    await expect(parseXlsxWorkbookIsolated(Buffer.alloc(XLSX_MAX_UPLOAD_BYTES + 1)))
      .rejects.toThrow("32 MB upload capacity");
  });

  it("rejects an already-cancelled request without starting a worker", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(parseXlsxWorkbookIsolated(smallWorkbook(), controller.signal))
      .rejects.toThrow("cancelled");
  });
});
