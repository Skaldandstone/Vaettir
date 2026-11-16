import pptxgen from "pptxgenjs";
import {
  DEFAULT_REPORT_PRESENTATION,
  reportPresentationStyle,
  type ReportPresentation,
} from "./report-presentation";
import { buildQualityVisualReport } from "@vaettir/core";
import {
  reportMetricRows,
  reportScopeSummary,
  type FrozenReportPayload,
} from "./frozen-report";

/** Editable objects and native chart workbooks; no screenshots, network or AI. */
export function createReportDeck(
  report: FrozenReportPayload,
  presentation: ReportPresentation = DEFAULT_REPORT_PRESENTATION,
) {
  const style = reportPresentationStyle(presentation);
  if (report.state !== "approved")
    throw new Error("Approve the report before exporting a presentation.");
  const charts = buildQualityVisualReport(report).charts;
  const metrics = reportMetricRows(report);
  if (
    charts.some((chart) =>
      chart.rows.some(
        (row) => !Number.isSafeInteger(row.value) || row.value < 0,
      ),
    )
  )
    throw new Error("This report contains unsupported chart values.");
  const deck = new pptxgen();
  deck.layout = "LAYOUT_WIDE";
  deck.author = "Vaettir";
  deck.subject =
    "Approved quality evidence for a stakeholder or investor update";
  deck.title = report.title;
  deck.company = "";
  deck.theme = { headFontFace: style.heading, bodyFontFace: style.body };
  const { ink, muted, accent, paper } = style;
  let number = 0;
  function slide(title: string) {
    const page = deck.addSlide();
    page.background = { color: paper };
    page.addShape(deck.ShapeType.rect, {
      x: 0,
      y: 0,
      w: 0.16,
      h: 7.5,
      fill: { color: accent },
      line: { color: accent },
    });
    page.addText(title, {
      x: 0.55,
      y: 0.4,
      w: 12.1,
      h: 0.85,
      fontSize: 26,
      bold: true,
      color: ink,
      breakLine: false,
      fit: "shrink",
      margin: 0,
    });
    page.addText(
      `Vaettir · Captured ${report.asOf} · Editable copy of approved evidence`,
      {
        x: 0.55,
        y: 7.02,
        w: 11.4,
        h: 0.25,
        fontSize: 9,
        color: muted,
        margin: 0,
      },
    );
    page.addText(String(++number), {
      x: 12.1,
      y: 7.02,
      w: 0.6,
      h: 0.25,
      fontSize: 9,
      color: muted,
      align: "right",
      margin: 0,
    });
    return page;
  }
  const cover = slide(report.title);
  cover.addText(report.projectName, {
    x: 0.6,
    y: 1.55,
    w: 12,
    h: 0.7,
    fontSize: 30,
    bold: true,
    color: ink,
    fit: "shrink",
    margin: 0,
  });
  cover.addText(reportScopeSummary(report, true), {
    x: 0.6,
    y: 2.6,
    w: 11.9,
    h: 1,
    fontSize: 20,
    color: muted,
    fit: "shrink",
    margin: 0,
  });
  cover.addText("Quality evidence for the next decision", {
    x: 0.6,
    y: 4.1,
    w: 12,
    h: 0.6,
    fontSize: 24,
    color: accent,
    margin: 0,
  });
  cover.addText(
    "Review audience and confidential information before sharing. Changes made in PowerPoint do not update the approved Vaettir report.",
    { x: 0.6, y: 5.2, w: 11.7, h: 0.9, fontSize: 17, color: muted, margin: 0 },
  );
  function textPages(title: string, text: string) {
    // Preserve every character; bound slide density even for unbroken strings.
    const characters = Array.from(
      text || "No narrative was recorded in the approved report.",
    );
    const pages: string[] = [];
    for (let i = 0; i < characters.length; i += 650)
      pages.push(characters.slice(i, i + 650).join(""));
    for (let i = 0; i < pages.length; i++) {
      const page = slide(
        `${title}${pages.length > 1 ? ` (${i + 1}/${pages.length})` : ""}`,
      );
      page.addText(pages[i]!, {
        x: 0.65,
        y: 1.65,
        w: 11.9,
        h: 4.8,
        fontSize: 22,
        color: ink,
        valign: "top",
        breakLine: false,
        fit: "shrink",
        margin: 0.05,
      });
    }
  }
  textPages("Executive summary", report.definition.summary);
  for (const chart of charts) {
    const page = slide(chart.title);
    const rows = chart.rows.filter((row) => row.value > 0);
    if (rows.length)
      page.addChart(
        chart.kind === "donut" ? deck.ChartType.doughnut : deck.ChartType.bar,
        [
          {
            name: chart.unit,
            labels: rows.map((row) => row.label),
            values: rows.map((row) => row.value),
          },
        ],
        {
          x: 0.75,
          y: 1.5,
          w: 11.8,
          h: 4.5,
          chartColors: rows.map((row) => row.color.replace("#", "")),
          showLegend: chart.kind === "donut",
          legendPos: "b",
          showValue: true,
          showTitle: false,
          holeSize: 65,
          catAxisLabelFontSize: 14,
          valAxisLabelFontSize: 12,
          legendFontSize: 14,
          barDir: "bar",
          altText: `${chart.title}. ${rows.map((row) => `${row.label}: ${row.value}`).join("; ")}`,
        },
      );
    else
      page.addText(chart.empty, {
        x: 1,
        y: 2.5,
        w: 11,
        h: 1.5,
        fontSize: 24,
        color: muted,
        align: "center",
      });
    page.addText(chart.note, {
      x: 0.65,
      y: 6.25,
      w: 11.9,
      h: 0.55,
      fontSize: 12,
      color: muted,
      fit: "shrink",
      margin: 0,
    });
  }
  textPages("Risks and decisions", report.definition.risks);
  textPages("Next actions", report.definition.nextActions);
  for (let i = 0; i < metrics.length; i += 8) {
    const page = slide("Evidence table");
    page.addTable(
      [
        ["Metric", "Recorded value", "Context"].map((text) => ({ text })),
        ...metrics
          .slice(i, i + 8)
          .map((row) =>
            [row.label, String(row.value), row.note ?? row.section].map(
              (text) => ({ text }),
            ),
          ),
      ],
      {
        x: 0.6,
        y: 1.5,
        w: 12.1,
        colW: [3.8, 1.8, 6.5],
        rowH: 0.53,
        fontSize: 13,
        color: ink,
        border: { type: "solid", pt: 0.5, color: "D3E1DB" },
        margin: 0.08,
        autoPage: true,
        autoPageRepeatHeader: true,
        autoPageSlideStartY: 1.5,
      },
    );
  }
  textPages(
    "Scope and limitations",
    [reportScopeSummary(report, true), ...report.limitations].join("\n\n"),
  );
  return deck;
}

export async function renderReportDeck(
  report: FrozenReportPayload,
  presentation: ReportPresentation = DEFAULT_REPORT_PRESENTATION,
): Promise<Blob> {
  return (await createReportDeck(report, presentation).write({
    outputType: "blob",
    compression: true,
  })) as Blob;
}
