import { createRequire } from "node:module";
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { renderReportDocument, renderReportWorkbook } from "./report-office";
import type { FrozenReportPayload } from "./frozen-report";
const require = createRequire(
  new URL("../../api/package.json", import.meta.url),
);
const Zip = require("adm-zip") as new (bytes: Buffer) => {
  getEntries(): Array<{ entryName: string }>;
  readAsText(name: string): string;
};
const report = {
  state: "approved",
  projectName: "Synthetic reporting",
  title: "Investor quality update",
  asOf: "2026-10-28T21:00:00Z",
  windowStart: "2026-09-28T21:00:00Z",
  definition: {
    audience: "stakeholders",
    windowDays: 30,
    sections: ["inventory", "execution", "automation"],
    summary: "Reviewed launch readiness",
    risks: "Two recorded failures need review.",
    nextActions: "Resolve failures before the release decision.",
  },
  inventory: {
    active: 12,
    riskAssessed: 0,
    flaky: 0,
    priority: [
      { key: "HIGH", count: 4 },
      { key: "MEDIUM", count: 8 },
    ],
    automation: [
      { key: "AUTOMATED", count: 7 },
      { key: "MANUAL", count: 5 },
    ],
  },
  execution: {
    runs: 3,
    results: 10,
    outcomes: [
      { key: "PASS", count: 8 },
      { key: "FAIL", count: 2 },
    ],
    distinctCases: 9,
    highPriorityCases: 4,
    highPriorityExecuted: 3,
  },
  traceability: {
    requirements: 0,
    coveredRequirements: 0,
    casesWithLinks: 0,
    links: 0,
  },
  defects: null,
  cohort: [{ id: "PRIVATE_COHORT_ID", status: "AUTOMATED" }],
  automationChange: null,
  limitations: ["Synthetic fixture only. No hosted acceptance."],
} as FrozenReportPayload;

describe("editable Office reports", () => {
  it("preserves all text, metrics, evidence dates and typed chart data under alternate styling", async () => {
    const preset = { version: 1, palette: "plum", font: "arial" } as const;
    const source = {
      ...report,
      definition: {
        ...report.definition,
        summary: "=SUM(1,2) literal evidence",
      },
    };
    const [plainDoc, styledDoc, plainBook, styledBook] = await Promise.all([
      renderReportDocument(source),
      renderReportDocument(source, preset),
      renderReportWorkbook(source),
      renderReportWorkbook(source, preset),
    ]);
    const doc = (bytes: ArrayBuffer) =>
      new Zip(Buffer.from(bytes)).readAsText("word/document.xml");
    const original = doc(await plainDoc.arrayBuffer()),
      styled = doc(await styledDoc.arrayBuffer());
    const texts = (xml: string) =>
      [...xml.matchAll(/<w:t(?: [^>]*)?>(.*?)<\/w:t>/gs)].map((m) => m[1]);
    expect(texts(styled)).toEqual(texts(original));
    expect(styled).toContain("38263F");
    expect(styled).toContain(source.definition.summary);
    expect(styled).toContain(source.asOf);
    expect(styled).toContain(source.limitations[0]);
    const books = await Promise.all(
      [plainBook, styledBook].map(async (blob) => {
        const book = new ExcelJS.Workbook();
        await book.xlsx.load(await blob.arrayBuffer());
        return book;
      }),
    );
    const values = (book: ExcelJS.Workbook) =>
      book.worksheets.map((sheet) => ({
        name: sheet.name,
        rows: sheet.getSheetValues(),
      }));
    expect(values(books[1]!)).toEqual(values(books[0]!));
    expect(books[1]!.getWorksheet("Metrics")!.getCell("C2").value).toBe(12);
    expect(books[1]!.getWorksheet("Narrative")!.getCell("B2").value).toBe(
      source.definition.summary,
    );
    expect(books[1]!.getWorksheet("Report")!.getCell("B4").value).toBe(
      source.asOf,
    );
    expect(books[1]!.getWorksheet("Report")!.getCell("A2").font.name).toBe(
      "Arial",
    );
    books[1]!.eachSheet((sheet) =>
      sheet.eachRow((row) =>
        row.eachCell((cell) => {
          expect(cell.formula).toBeUndefined();
          expect(cell.hyperlink).toBeUndefined();
        }),
      ),
    );
  });

  it("writes typed XLSX values, literal formula-like text and explicit missing evidence", async () => {
    const danger = '=HYPERLINK("https://example.invalid","text")';
    const value = {
      ...report,
      title: danger,
      definition: { ...report.definition, summary: "Unicode 🧪 " + danger },
    };
    const blob = await renderReportWorkbook(value);
    const bytes = await blob.arrayBuffer();
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(bytes);
    expect(book.worksheets.map((sheet) => sheet.name)).toEqual([
      "Report",
      "Metrics",
      "Chart data",
      "Narrative",
    ]);
    expect(book.getWorksheet("Report")!.getCell("B2").value).toBe(danger);
    expect(book.getWorksheet("Metrics")!.getCell("C2").value).toBe(12);
    expect(book.getWorksheet("Narrative")!.getCell("B2").value).toBe(
      "Unicode 🧪 " + danger,
    );
    book.eachSheet((sheet) =>
      sheet.eachRow((row) =>
        row.eachCell((cell) => {
          expect(cell.formula).toBeUndefined();
          expect(cell.hyperlink).toBeUndefined();
        }),
      ),
    );
    const zip = new Zip(Buffer.from(bytes));
    const xml = zip
      .getEntries()
      .filter((entry) => entry.entryName.endsWith(".xml"))
      .map((entry) => zip.readAsText(entry.entryName))
      .join("");
    expect(xml).not.toContain("PRIVATE_COHORT_ID");
    expect(xml).toContain("Synthetic fixture only");
  });
  it("writes native DOCX text/tables without links, raw identities or rasterized pages", async () => {
    const blob = await renderReportDocument(report);
    const zip = new Zip(Buffer.from(await blob.arrayBuffer()));
    const xml = zip.readAsText("word/document.xml");
    expect(xml).toContain("Reviewed launch readiness");
    expect(xml).toContain("<w:tbl>");
    expect(xml).toContain("Recorded metrics");
    expect(xml).not.toContain("PRIVATE_COHORT_ID");
    expect(
      zip
        .getEntries()
        .filter((entry) => /^word\/media\/.+/.test(entry.entryName)),
    ).toHaveLength(0);
    for (const entry of zip
      .getEntries()
      .filter((entry) => entry.entryName.endsWith(".rels")))
      expect(zip.readAsText(entry.entryName)).not.toContain(
        'TargetMode="External"',
      );
  });
  it("refuses previews and preserves oversized Unicode narrative across workbook rows", async () => {
    await expect(
      renderReportDocument({ ...report, state: "preview" }),
    ).rejects.toThrow(/Approve/);
    await expect(
      renderReportWorkbook({ ...report, state: "preview" }),
    ).rejects.toThrow(/Approve/);
    const summary = "🧪".repeat(20000);
    const blob = await renderReportWorkbook({
      ...report,
      definition: { ...report.definition, summary },
    });
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await blob.arrayBuffer());
    const sheet = book.getWorksheet("Narrative")!;
    expect(
      String(sheet.getCell("B2").value) + String(sheet.getCell("B3").value),
    ).toBe(summary);
  });
});
