import { describe, it, expect } from "vitest";
import {
  DEFAULT_REPORT_PRESENTATION,
  normalizeReportPresentation,
  parseReportPresentation,
  serializeReportPresentation,
} from "./report-presentation";

describe("portable presentation presets", () => {
  it("normalizes only three bounded fields and round-trips without report data", () => {
    expect(
      parseReportPresentation(
        '{"font":"georgia","version":1,"palette":"navy"}',
      ),
    ).toEqual({ version: 1, palette: "navy", font: "georgia" });
    expect(serializeReportPresentation(DEFAULT_REPORT_PRESENTATION)).toBe(
      '{"version":1,"palette":"evergreen","font":"aptos"}',
    );
    expect(
      Object.isFrozen(normalizeReportPresentation(DEFAULT_REPORT_PRESENTATION)),
    ).toBe(true);
  });
  it.each([
    "null",
    "[]",
    "{}",
    '{"version":2,"palette":"navy","font":"arial"}',
    '{"version":1,"palette":"navy","font":"arial","title":"Private text"}',
    '{"version":1,"palette":"navy","font":"https://example.invalid/font"}',
    '{"version":1,"palette":"__proto__","font":"arial"}',
    '{"version":1,"palette":"navy","font":"constructor"}',
    '{"version":1,"palette":"navy","font":"arial","__proto__":{}}',
    '{"version":1,"palette":"navy","font":"arial","font":"georgia"}',
    '{"version":1,"palette":{"url":"x"},"font":"arial"}',
    " ".repeat(513),
    "🧪".repeat(129),
    "{invalid",
  ])("refuses invalid, oversized or unrecognized input %s", (text) => {
    expect(() => parseReportPresentation(text)).toThrow(/preset/);
  });
  it("rejects hidden properties, symbols, custom prototypes and accessors without invoking them", () => {
    const accessor = Object.defineProperty(
      { version: 1, font: "arial" },
      "palette",
      {
        get() {
          throw new Error("getter must not run");
        },
      },
    );
    for (const value of [
      accessor,
      { ...DEFAULT_REPORT_PRESENTATION, [Symbol()]: true },
      Object.assign(
        Object.create({ hidden: true }),
        DEFAULT_REPORT_PRESENTATION,
      ),
      Object.defineProperty({ ...DEFAULT_REPORT_PRESENTATION }, "hidden", {
        value: "private",
      }),
    ])
      expect(() => normalizeReportPresentation(value)).toThrow(/preset/);
  });
});
