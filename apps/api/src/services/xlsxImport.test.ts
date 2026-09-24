import AdmZip from "adm-zip";
import { describe, expect, it } from "vitest";
import { parseXlsxWorkbook, previewXlsxSheet } from "./xlsxImport.js";

function workbookFixture() {
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
    Buffer.from(`
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
});
