import AdmZip from "adm-zip";
import { describe, expect, it } from "vitest";
import { parseXlsxWorkbook, previewXlsxSheet } from "./xlsxImport.js";
import { mapCsvRows } from "./csvFieldMapping.js";

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
  it("accepts ordinary XML 1.0 declarations in every workbook part", () => {
    const zip = new AdmZip(workbookFixture());
    for (const entry of zip.getEntries()) {
      zip.updateFile(entry.entryName, Buffer.concat([
        Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'),
        entry.getData(),
      ]));
    }
    expect(parseXlsxWorkbook(zip.toBuffer())[0]).toMatchObject({ rowCount: 1, headerRow: 2 });
  });

  it("continues to reject XML 1.1 declarations", () => {
    const zip = new AdmZip(workbookFixture());
    const entry = zip.getEntry("xl/workbook.xml")!;
    zip.updateFile(entry.entryName, Buffer.concat([Buffer.from('<?xml version="1.1"?>'), entry.getData()]));
    expect(() => parseXlsxWorkbook(zip.toBuffer())).toThrow("XML version is not supported");
  });

  it("preserves Given and When with whitespace-padded workbook headers", () => {
    const xml = '<worksheet><sheetData><row><c r="A1" t="inlineStr"><is><t>Title</t></is></c><c r="B1" t="inlineStr"><is><t> Given </t></is></c><c r="C1" t="inlineStr"><is><t>When&#10;</t></is></c><c r="D1" t="inlineStr"><is><t>Then</t></is></c></row><row><c r="A2" t="inlineStr"><is><t>Delete own comment</t></is></c><c r="B2" t="inlineStr"><is><t>Signed in as comment owner</t></is></c><c r="C2" t="inlineStr"><is><t>Choose Delete</t></is></c><c r="D2" t="inlineStr"><is><t>Comment removed</t></is></c></row></sheetData></worksheet>';
    const sheet = parseXlsxWorkbook(workbookFixture(xml))[0]!;
    expect(previewXlsxSheet(sheet).rows[0]).toMatchObject({
      given: ["Signed in as comment owner"], when: ["Choose Delete"], then: ["Comment removed"],
    });
  });

  it("detects a non-first vendor header row without guessing ambiguous title or tags", () => {
    const [sheet] = parseXlsxWorkbook(workbookFixture());
    expect(sheet).toMatchObject({
      name: "Cases",
      headerRow: 2,
      rowCount: 1,
      suggestedMapping: {
        given: "Preconditions",
        when: "Test Steps",
        then: "Expected Result",
        externalId: "Test Case ID",
      },
    });
    expect(sheet?.suggestedMapping.title).toBeUndefined();
    expect(sheet?.suggestedMapping.tags).toBeUndefined();
    expect(() => previewXlsxSheet(sheet!)).toThrow('"title" field must be mapped');
  });
  it("offers a scenario checklist sheet without inventing a title/action or requiring Gherkin columns",()=>{
    const xml='<worksheet><sheetData><row><c r="A1" t="inlineStr"><is><t>Module</t></is></c><c r="B1" t="inlineStr"><is><t>Test Scenario</t></is></c><c r="C1" t="inlineStr"><is><t>Expected Result</t></is></c></row><row><c r="A2" t="inlineStr"><is><t>Payments</t></is></c><c r="B2" t="inlineStr"><is><t>Check purchase restoration</t></is></c><c r="C2" t="inlineStr"><is><t>Balance is preserved</t></is></c></row></sheetData></worksheet>';
    const sheet=parseXlsxWorkbook(workbookFixture(xml))[0]!;
    expect(sheet).toMatchObject({headerRow:1,rowCount:1});expect(sheet.suggestedMapping.title).toBeUndefined();expect(sheet.suggestedMapping.when).toBeUndefined();
    expect(()=>previewXlsxSheet(sheet)).toThrow('"title" field must be mapped');
    expect(previewXlsxSheet(sheet,{...sheet.suggestedMapping,title:"Test Scenario"}).rows[0]).toMatchObject({title:"Check purchase restoration",when:[],then:["Balance is preserved"]});
  });
  it("offers a later precondition/outcome table for deliberate title selection without guessing procedure text",()=>{
    const xml='<worksheet><sheetData><row><c r="A1" t="inlineStr"><is><t>Checklist overview</t></is></c></row><row><c r="A2" t="inlineStr"><is><t>Review these cases</t></is></c></row><row><c r="A3" t="inlineStr"><is><t>Precondition</t></is></c><c r="B3" t="inlineStr"><is><t>Description</t></is></c><c r="C3" t="inlineStr"><is><t>Expected Result</t></is></c></row><row><c r="A4" t="inlineStr"><is><t>Account exists</t></is></c><c r="B4" t="inlineStr"><is><t>Purchase restoration</t></is></c><c r="C4" t="inlineStr"><is><t>Balance retained</t></is></c></row></sheetData></worksheet>';
    const sheet=parseXlsxWorkbook(workbookFixture(xml))[0]!;
    expect(sheet).toMatchObject({headerRow:3,rowCount:1});expect(sheet.suggestedMapping.title).toBeUndefined();
    expect(previewXlsxSheet(sheet,{...sheet.suggestedMapping,title:"Description"}).rows[0]).toMatchObject({title:"Purchase restoration",given:["Account exists"],when:[],then:["Balance retained"]});
  });

  it("previews explicitly reviewed vendor title/tags and exact numbered procedure text", () => {
    const [sheet] = parseXlsxWorkbook(workbookFixture());
    const mapping = { ...sheet!.suggestedMapping, title: "Test Scenario", tags: "Test Module/Scenario" };
    const preview = previewXlsxSheet(sheet!, mapping);
    expect(preview.skipped).toEqual([]);
    expect(preview.rows[0]).toMatchObject({
      title: "OAuth login succeeds",
      externalId: "QT-42",
      tags: ["Authentication"],
      given: ["A Google account exists"],
      when: ["1. Open sign in.2. Choose Google.3. Approve access."],
      then: ["The dashboard opens"],
    });
    // Commit uses this same mapper and explicit mapping; preview cannot infer
    // a different procedure or title from the source text.
    expect(preview.rows).toEqual(mapCsvRows(sheet!.csvText!, mapping).rows);
  });
  it("retains multiline expected/action cells without interpreting numbering or literal pipes", () => {
    const xml = '<worksheet><sheetData><row><c r="A1" t="inlineStr"><is><t>Case Name</t></is></c><c r="B1" t="inlineStr"><is><t>Actions</t></is></c><c r="C1" t="inlineStr"><is><t>Expected Result</t></is></c></row><row><c r="A2" t="inlineStr"><is><t>Restore purchases</t></is></c><c r="B2" t="inlineStr"><is><t>1. Reinstall.2. Open the app.&#10;&#10;  3. Check a|b.</t></is></c><c r="C2" t="inlineStr"><is><t>Consumables remain consumed.&#10;  Balance = 0.</t></is></c></row></sheetData></worksheet>';
    const sheet = parseXlsxWorkbook(workbookFixture(xml))[0]!;
    const preview = previewXlsxSheet(sheet);
    expect(preview.rows[0]).toMatchObject({ title: "Restore purchases", given: [], when: ["1. Reinstall.2. Open the app.\n\n  3. Check a|b."], then: ["Consumables remain consumed.\n  Balance = 0."], tags: [] });
    expect(preview.rows).toEqual(mapCsvRows(sheet.csvText!, sheet.suggestedMapping).rows);
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
