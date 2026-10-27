import { describe, it, expect } from "vitest";
import {
  buildQualityVisualReport,
  buildReleaseVisualReport,
  renderQualityVisualReportHtml,
} from "./qualityVisuals.js";
const source = {
  definition: { sections: ["automation"] },
  inventory: {
    active: 10,
    automation: [
      { key: "AUTOMATED", count: 7 },
      { key: "MANUAL", count: 3 },
    ],
    priority: [{ key: "PRIVATE_UNUSED", count: 10 }],
  },
  execution: { results: 0, outcomes: [], distinctCases: 0 },
};
describe("Vaettir visual reports", () => {
  it("renders the selected automation breakdown without requiring execution results", () => {
    const report = buildQualityVisualReport(source);
    expect(report.charts).toHaveLength(1);
    expect(report.charts[0]?.rows.map((r) => [r.label, r.value])).toEqual([
      ["Automated", 7],
      ["Manual", 3],
    ]);
    expect(JSON.stringify(report)).not.toContain("PRIVATE_UNUSED");
  });
  it("distinguishes unexecuted inventory from unknown planning and zero inventory", () => {
    const report = buildQualityVisualReport({
      ...source,
      definition: { sections: ["execution"] },
    });
    expect(report.charts.find((c) => c.id === "coverage")?.rows).toEqual([
      { label: "No execution recorded", value: 10, color: "#B5C0D0" },
    ]);
    expect(report.charts.find((c) => c.id === "plan-progress")?.rows).toEqual(
      [],
    );
    expect(
      buildQualityVisualReport({
        ...source,
        definition: { sections: ["execution"] },
        inventory: { active: 0 },
      }).charts.find((c) => c.id === "coverage")?.rows,
    ).toEqual([]);
  });
  it("does not turn inconsistent denominators into full progress", () => {
    const report = buildQualityVisualReport({
      ...source,
      definition: { sections: ["execution"] },
      execution: {
        ...source.execution,
        distinctCases: 11,
        plannedCaseRunPairs: 10,
        notRecordedCaseRunPairs: 12,
      },
    });
    expect(
      report.charts
        .filter((c) => c.id !== "outcomes")
        .every((c) => !c.rows.length),
    ).toBe(true);
  });
  it("keeps release result completion separate from passing", () => {
    const report = buildReleaseVisualReport({
      counts: {
        planned: 10,
        recorded: 6,
        pass: 2,
        fail: 4,
        blocked: 0,
        skipped: 0,
        flaky: 0,
        mixed: 0,
        ambiguous: 0,
        notRecorded: 4,
      },
      risks: [{ severity: "HIGH", count: 2 }],
    });
    expect(report.charts[0]?.rows.map((r) => r.value)).toEqual([6, 4]);
    expect(report.charts[1]?.rows.map((r) => r.value)).toEqual([2, 4, 4]);
    expect(report.charts[2]?.rows).toHaveLength(1);
  });
});

describe("portable report charts", () => {
  it("preserves selected chart models and exact counts without external assets", () => {
    const model = buildQualityVisualReport(source);
    const html = renderQualityVisualReportHtml(model);
    expect(html).toContain('data-chart-id="automation"');
    expect(html).toContain("Automation mix");
    expect(html).toContain("<strong>7</strong>");
    expect(html).toContain("<strong>3</strong>");
    expect(html).not.toContain("PRIVATE_UNUSED");
    expect(html).not.toMatch(/<script|<img|https?:|NaN|Infinity/);
  });
  it("escapes chart text and rejects executable color attributes", () => {
    const model = buildQualityVisualReport(source);
    model.charts[0]!.title = '<img src=x onerror="attack()">';
    model.charts[0]!.rows[0]!.label = "<script>alert(1)</script>";
    model.charts[0]!.rows[0]!.color =
      "red; background:url(https://private.invalid)";
    const html = renderQualityVisualReportHtml(model);
    expect(html).toContain("&lt;img");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toMatch(/<img|<script|private\.invalid|background:url/);
    expect(html).toContain("#697F98");
  });
  it("renders honest empty states without drawing invented result segments", () => {
    const model = buildQualityVisualReport({
      ...source,
      inventory: { active: 0 },
    });
    const html = renderQualityVisualReportHtml(model);
    expect(html).toContain("No cases recorded in this capture.");
    expect(html).not.toContain("stroke-dasharray");
    expect(html).not.toMatch(/NaN|Infinity/);
  });
});
