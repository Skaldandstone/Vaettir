import AdmZip from "adm-zip";
import { describe, expect, it } from "vitest";
import { parseXlsxWorkbook, previewXlsxSheet } from "./xlsxImport.js";

function workbookFixture(sheetOverride?: string) {
  const zip = new AdmZip();
  zip.addFile(
    "xl/workbook.xml",
    Buffer.from(
      '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Cases" sheetId="1" r:id="rId1"/></sheets></workbook>',
    ),
  );
  zip.addFile(
    "xl/_rels/workbook.xml.rels",
    Buffer.from(
      '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    ),
  );
  zip.addFile(
    "xl/worksheets/sheet1.xml",
    Buffer.from(sheetOverride ?? `
      <worksheet><sheetData>
        <row r="1"><c r="A1" t="inlineStr"><is><t>Imported from Qase</t></is></c></row>
        <row r="2">
          <c r="A2" t="inlineStr"><is><t>Test Case ID</t></is></c>
          <c r="B2" t="inlineStr"><is><t>Test Module/Scenario</t></is></c>
          <c r="C2" t="inlineStr"><is><t>Test Scenario</t></is></c>
          <c r="D2" t="inlineStr"><is><t>Preconditions</t></is></c>
          <c r="E2" t="inlineStr"><is><t>Test Steps</t></is></c>
          <c r="F2" t="inlineStr"><is><t>Expected Result</t></is></c>
        </row>
        <row r="3">
          <c r="A3" t="inlineStr"><is><t>QT-42</t></is></c>
          <c r="B3" t="inlineStr"><is><t>Authentication</t></is></c>
          <c r="C3" t="inlineStr"><is><t>OAuth login succeeds</t></is></c>
          <c r="D3" t="inlineStr"><is><t>A Google account exists</t></is></c>
          <c r="E3" t="inlineStr"><is><t>1. Open sign in.2. Choose Google.3. Approve access.</t></is></c>
          <c r="F3" t="inlineStr"><is><t>The dashboard opens</t></is></c>
        </row>
      </sheetData></worksheet>
    `),
  );
  return zip.toBuffer();
}

describe("XLSX smart import", () => {
  it("detects a non-first header row and maps common vendor columns", () => {
    const [sheet] = parseXlsxWorkbook(workbookFixture());
    expect(sheet).toMatchObject({
      name: "Cases",
      headerRow: 2,
      rowCount: 1,
      suggestedMapping: {
        title: "Test Scenario",
        given: "Preconditions",
        when: "Test Steps",
        then: "Expected Result",
        tags: "Test Module/Scenario",
        externalId: "Test Case ID",
      },
    });
  });

  it("previews stable IDs, suite tags, and concatenated numbered steps", () => {
    const [sheet] = parseXlsxWorkbook(workbookFixture());
    const preview = previewXlsxSheet(sheet!);
    expect(preview.skipped).toEqual([]);
    expect(preview.rows[0]).toMatchObject({
      title: "OAuth login succeeds",
      externalId: "QT-42",
      tags: ["Authentication"],
      given: ["A Google account exists"],
      when: ["Open sign in.", "Choose Google.", "Approve access."],
      then: ["The dashboard opens"],
    });
  });

  it("rejects non-XLSX input", () => {
    expect(() => parseXlsxWorkbook(Buffer.from("not a workbook"))).toThrow(
      "not a valid .xlsx",
    );
  });

  it("preserves ordinary escaped XML text and Unicode in imported case titles", () => {
    const sheet = '<worksheet><sheetData><row><c r="A1" t="inlineStr"><is><t>Title</t></is></c></row><row><c r="A2" t="inlineStr"><is><t>Login &amp; upgrade &quot;Premium&quot; &#x2713;</t></is></c></row></sheetData></worksheet>';
    const parsed = parseXlsxWorkbook(workbookFixture(sheet))[0]!;
    expect(previewXlsxSheet(parsed).rows[0]?.title).toBe('Login & upgrade "Premium" ✓');
  });

  it.each([
    ['&amp;amp;', '&amp;'],
    ['<![CDATA[Login &amp; upgrade]]>', 'Login &amp; upgrade'],
    ['A &#128512; user', 'A 😀 user'],
  ])("decodes ordinary XML text once without changing CDATA (%s)", (source, expected) => {
    const sheet = `<worksheet><sheetData><row><c r="A1" t="inlineStr"><is><t>Title</t></is></c></row><row><c r="A2" t="inlineStr"><is><t>${source}</t></is></c></row></sheetData></worksheet>`;
    expect(previewXlsxSheet(parseXlsxWorkbook(workbookFixture(sheet))[0]!).rows[0]?.title).toBe(expected);
  });

  it("rejects oversized declared entries before decompression", () => {
    const zip = new AdmZip();
    zip.addFile("xl/workbook.xml", Buffer.from("<workbook/>"));
    const buffer = zip.toBuffer();
    const central = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    buffer.writeUInt32LE(64 * 1024 * 1024, central + 24);
    buffer.writeUInt32LE(64 * 1024 * 1024, 22);
    expect(() => parseXlsxWorkbook(buffer)).toThrow("10 MB expanded limit");
  });

  it("rejects falsified zero-size deflated XML without unbounded inflation", () => {
    const zip = new AdmZip();
    zip.addFile("xl/workbook.xml", Buffer.from("<workbook/>"));
    const buffer = zip.toBuffer();
    const central = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    buffer.writeUInt32LE(0, central + 24);
    buffer.writeUInt32LE(0, 22);
    expect(() => parseXlsxWorkbook(buffer)).toThrow("invalid zero-size compressed entry");
  });

  it("rejects an out-of-range sparse column without creating a large array", () => {
    const sheet = '<worksheet><sheetData><row r="1"><c r="IW1" t="inlineStr"><is><t>Title</t></is></c></row></sheetData></worksheet>';
    expect(() => parseXlsxWorkbook(workbookFixture(sheet))).toThrow("256 column limit");
  });

  it("rejects custom XML entities before parsing", () => {
    const sheet = '<!DOCTYPE worksheet [<!ENTITY custom "synthetic">]><worksheet><sheetData/></worksheet>';
    expect(() => parseXlsxWorkbook(workbookFixture(sheet))).toThrow("XML declarations are not supported");
  });

  it("bounds cell text rather than silently truncating it", () => {
    const sheet = `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>${"x".repeat(16_385)}</t></is></c></row></sheetData></worksheet>`;
    expect(() => parseXlsxWorkbook(workbookFixture(sheet))).toThrow("cell text exceeds");
  });
});
