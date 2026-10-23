import { describe, expect, it } from "vitest";
import { reassignImportColumn, remainingNonCaseRows } from "./reassign-import-column";

describe("editable smart import mappings", () => {
  it("moves a guessed column to the human-corrected role without duplicate assignments", () => {
    const original = { title: "Scenario", when: "Steps", tags: "Module" };
    expect(reassignImportColumn(original, "title", "Module")).toEqual({ title: "Module", when: "Steps" });
    expect(original).toEqual({ title: "Scenario", when: "Steps", tags: "Module" });
  });
  it("allows a correction even when the header normally suggests another role", () => {
    expect(reassignImportColumn({ title: "Title", when: "Steps" }, "title", "Steps")).toEqual({ title: "Steps" });
  });
  it("can unmap one optional field without clearing unrelated mappings", () => {
    expect(reassignImportColumn({ title: "Scenario", tags: "Module" }, "tags", "")).toEqual({ title: "Scenario", tags: undefined });
  });
  it("keeps an unchanged selection and can restore a previously unmapped required title", () => {
    expect(reassignImportColumn({ title: "Scenario", when: "Steps" }, "title", "Scenario")).toEqual({ title: "Scenario", when: "Steps" });
    expect(reassignImportColumn({ when: "Steps" }, "title", "Description")).toEqual({ title: "Description", when: "Steps" });
  });
  it("keeps non-case exclusions visible until a person supplies a case name", () => {
    const rows = [{ rowNumber: 2 }, { rowNumber: 4 }];
    expect(remainingNonCaseRows(rows, { 2: { title: "" } })).toEqual(rows);
    expect(remainingNonCaseRows(rows, { 2: { title: "Reviewed case" } })).toEqual([{ rowNumber: 4 }]);
    expect(remainingNonCaseRows(undefined, {})).toEqual([]);
  });
});
