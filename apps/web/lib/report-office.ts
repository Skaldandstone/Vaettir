import {
  reportMetricRows,
  reportScopeSummary,
  type FrozenReportPayload,
} from "./frozen-report";
import { buildQualityVisualReport } from "@vaettir/core";

export type ReportOfficeFormat = "docx" | "xlsx";
const boundary =
  "Editable copy of approved quality evidence. Changes to this file do not update the approved Vaettir report. Missing evidence is not zero. Review recipients before sharing.";
function requireApproved(report: FrozenReportPayload) {
  if (report.state !== "approved")
    throw new Error(
      "Approve the report before exporting an editable document.",
    );
  for (const row of reportMetricRows(report))
    if (
      typeof row.value === "number" &&
      (!Number.isFinite(row.value) || row.value < 0)
    )
      throw new Error("This report contains unsupported metric values.");
}
function metadata(report: FrozenReportPayload) {
  return [
    ["Report", report.title],
    ["Project", report.projectName],
    ["Captured at (UTC)", report.asOf],
    ["Execution window start (UTC)", report.windowStart],
    ["Execution window end (UTC)", report.windowEnd ?? report.asOf],
    ["Scope", reportScopeSummary(report, true)],
    ["Audience", report.definition.audience],
    ["Selected sections", report.definition.sections.join(", ")],
    ["Evidence boundary", boundary],
  ];
}

/** Native typed cells, with all authored strings stored as literal text, never
 * formulas or hyperlinks. Only approved portable aggregates enter this file. */
export async function renderReportWorkbook(
  report: FrozenReportPayload,
): Promise<Blob> {
  requireApproved(report);
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Vaettir";
  workbook.title = report.title;
  workbook.subject = "Approved quality evidence";
  const fill = {
    type: "pattern" as const,
    pattern: "solid" as const,
    fgColor: { argb: "FF16302D" },
  };
  const make = (name: string, headers: string[], widths: number[]) => {
    const sheet = workbook.addWorksheet(name, {
      views: [{ state: "frozen", ySplit: 1 }],
    });
    sheet.addRow(headers);
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = fill;
    sheet.columns.forEach((column, index) => {
      column.width = widths[index] ?? 40;
    });
    return sheet;
  };
  const overview = make("Report", ["Field", "Recorded value"], [30, 95]);
  metadata(report).forEach((row) => overview.addRow(row));
  const metrics = make(
    "Metrics",
    ["Section", "Metric", "Recorded value", "Evidence note"],
    [22, 46, 24, 90],
  );
  reportMetricRows(report).forEach((row) =>
    metrics.addRow([row.section, row.label, row.value, row.note ?? ""]),
  );
  metrics.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, metrics.rowCount), column: 4 },
  };
  const chartData = make(
    "Chart data",
    ["Chart", "Category", "Recorded value", "Unit", "Evidence note"],
    [34, 36, 22, 20, 100],
  );
  for (const chart of buildQualityVisualReport(report).charts) {
    if (!chart.rows.length)
      chartData.addRow([
        chart.title,
        "No recorded data",
        "Unavailable",
        chart.unit,
        chart.empty,
      ]);
    for (const row of chart.rows)
      chartData.addRow([
        chart.title,
        row.label,
        row.value,
        chart.unit,
        chart.note,
      ]);
  }
  const narrative = make("Narrative", ["Section", "Approved text"], [28, 110]);
  const addText = (label: string, value: string) => {
    // Excel limits individual text cells to 32,767 UTF-16 units. Keep all text
    // across rows without splitting a Unicode surrogate pair.
    let part = "";
    for (const character of value || "Not recorded") {
      if (part.length + character.length > 30000) {
        narrative.addRow([label, part]);
        part = "";
      }
      part += character;
    }
    narrative.addRow([label, part]);
  };
  addText("Summary", report.definition.summary);
  addText("Risks and decisions", report.definition.risks);
  addText("Next actions", report.definition.nextActions);
  report.limitations.forEach((text) => addText("Evidence limitation", text));
  workbook.eachSheet((sheet) => {
    sheet.eachRow((row, index) => {
      if (index > 1)
        row.font = { name: "Aptos", size: 11, color: { argb: "FF16302D" } };
      row.alignment = { vertical: "top", wrapText: true };
    });
    sheet.pageSetup = {
      paperSize: 9,
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    };
  });
  const bytes = await workbook.xlsx.writeBuffer();
  return new Blob([new Uint8Array(bytes)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

/** Editable paragraphs and native Word tables, without raw identities, external
 * relationships, macros, screenshots or executable template expressions. */
export async function renderReportDocument(
  report: FrozenReportPayload,
): Promise<Blob> {
  requireApproved(report);
  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    Table,
    TableRow,
    TableCell,
    HeadingLevel,
    WidthType,
    Footer,
    PageNumber,
  } = await import("docx");
  const paragraph = (text: string) =>
    new Paragraph({ children: [new TextRun(text)], spacing: { after: 160 } });
  const heading = (text: string) =>
    new Paragraph({
      text,
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 280, after: 160 },
      keepNext: true,
    });
  const table = (headers: string[], values: (string | number)[][]) =>
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [headers, ...values].map(
        (row, index) =>
          new TableRow({
            tableHeader: index === 0,
            children: row.map(
              (value) =>
                new TableCell({
                  shading: index === 0 ? { fill: "16302D" } : undefined,
                  children: [
                    new Paragraph({
                      children: [
                        new TextRun({
                          text: String(value),
                          bold: index === 0,
                          color: index === 0 ? "FFFFFF" : "16302D",
                        }),
                      ],
                    }),
                  ],
                }),
            ),
          }),
      ),
    });
  const children: (
    InstanceType<typeof Paragraph> | InstanceType<typeof Table>
  )[] = [
    new Paragraph({ text: report.title, heading: HeadingLevel.TITLE }),
    paragraph(`${report.projectName} · Captured ${report.asOf}`),
    paragraph(boundary),
    heading("Report scope"),
    table(["Field", "Recorded value"], metadata(report)),
  ];
  for (const [title, text] of [
    ["Executive summary", report.definition.summary],
    ["Risks and decisions", report.definition.risks],
    ["Next actions", report.definition.nextActions],
  ]) {
    children.push(heading(title!));
    for (const line of (text || "Not recorded").split(/\r?\n/))
      children.push(paragraph(line));
  }
  children.push(
    heading("Recorded metrics"),
    table(
      ["Metric", "Recorded value", "Evidence note"],
      reportMetricRows(report).map((row) => [
        row.label,
        row.value,
        row.note ?? row.section,
      ]),
    ),
  );
  for (const chart of buildQualityVisualReport(report).charts) {
    children.push(heading(chart.title), paragraph(chart.note));
    children.push(
      chart.rows.length
        ? table(
            ["Category", chart.unit],
            chart.rows.map((row) => [row.label, row.value]),
          )
        : paragraph(chart.empty),
    );
  }
  children.push(heading("Scope and limitations"));
  report.limitations.forEach((text) => children.push(paragraph(text)));
  return Packer.toBlob(
    new Document({
      creator: "Vaettir",
      title: report.title,
      description: "Approved quality evidence, editable copy",
      styles: {
        default: {
          document: {
            run: { font: "Aptos", size: 22 },
            paragraph: { spacing: { after: 160 } },
          },
        },
      },
      sections: [
        {
          properties: {},
          children,
          footers: {
            default: new Footer({
              children: [
                new Paragraph({
                  children: [
                    new TextRun("Vaettir · Editable approved report · "),
                    new TextRun({ children: [PageNumber.CURRENT] }),
                  ],
                }),
              ],
            }),
          },
        },
      ],
    }),
  );
}
