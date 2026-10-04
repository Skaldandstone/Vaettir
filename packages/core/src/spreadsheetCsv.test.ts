// Authored, not executed in the source-only implementation night.
import { describe, expect, it } from "vitest";
import { renderBoundedSpreadsheetCsv } from "./spreadsheetCsv.js";

describe("bounded spreadsheet CSV", () => {
  it("retains comma/newline/quote/Unicode text with BOM and CRLF framing", () => {
    expect(
      renderBoundedSpreadsheetCsv(
        ["Label", "Value"],
        [["a,b", 'a "quote"\n🙂']],
      ),
    ).toBe('\uFEFF"Label","Value"\r\n"a,b","a ""quote""\n🙂"\r\n');
  });
  it("protects leading authored formulas and does not infer numeric text", () => {
    expect(
      renderBoundedSpreadsheetCsv(["A", "B", "C"], [["  =SUM(1)", -2, "001"]]),
    ).toBe('\uFEFF"A","B","C"\r\n"\'  =SUM(1)","-2","001"\r\n');
  });
  it("refuses ragged/oversized/unsafe rows instead of a partial export", () => {
    expect(() => renderBoundedSpreadsheetCsv(["A"], [["x", "y"]])).toThrow(
      /row/,
    );
    expect(() => renderBoundedSpreadsheetCsv(["A"], [["x"]], 1101)).toThrow(
      /shape/,
    );
    expect(() => renderBoundedSpreadsheetCsv(Array(31).fill("A"), [])).toThrow(
      /shape/,
    );
    expect(() => renderBoundedSpreadsheetCsv(["A"], [[NaN]])).toThrow(
      /numeric/,
    );
    expect(() => renderBoundedSpreadsheetCsv(["A"], [["x\u0000y"]])).toThrow(
      /control/,
    );
    expect(() => renderBoundedSpreadsheetCsv(["A"], [["\ud800"]])).toThrow(
      /Unicode/,
    );
    expect(() =>
      renderBoundedSpreadsheetCsv(["A"], [["x".repeat(32769)]]),
    ).toThrow(/cell/);
  });
  it("allows explicit whole-query rows plus bounded metadata without widening the byte cap", () => {
    expect(
      renderBoundedSpreadsheetCsv(["A"], Array(1001).fill(["x"]), 1010),
    ).toContain('"x"');
    expect(() =>
      renderBoundedSpreadsheetCsv(["A"], Array(1001).fill(["x"])),
    ).toThrow(/row limit/);
    expect(() =>
      renderBoundedSpreadsheetCsv(["A"], Array(80).fill(["界".repeat(8000)])),
    ).toThrow(/one MiB/);
  });
  it("counts UTF-8 scalar bytes at the cell limit without platform ambient types", () => {
    for (const [text, accepted, rejected] of [
      ["a", 32768, 32769],
      ["é", 16384, 16385],
      ["界", 10922, 10923],
      ["🙂", 8192, 8193],
    ] as const) {
      expect(renderBoundedSpreadsheetCsv(["A"], [[text.repeat(accepted)]])).toContain(text);
      expect(() => renderBoundedSpreadsheetCsv(["A"], [[text.repeat(rejected)]])).toThrow(/cell/);
    }
    expect(() => renderBoundedSpreadsheetCsv(["A"], [["\udc00"]])).toThrow(/Unicode/);
  });
});
