import { describe, expect, it } from "vitest";
import { importJobsRouter } from "./importJobs.js";

describe("import preview transport", () => {
  it("uses POST-backed mutations for files and credentials", () => {
    const procedures = importJobsRouter._def.procedures as Record<
      string,
      { _def: { type?: string } }
    >;
    for (const name of [
      "previewXlsx",
      "previewXlsxSheet",
      "previewCsv",
      "previewWithMapping",
      "previewXray",
      "previewTestRail",
      "previewQTest",
      "previewZephyr",
    ]) {
      expect(procedures[name]?._def.type, name).toBe("mutation");
    }
  });

  it("keeps import history as a read-only query", () => {
    const procedures = importJobsRouter._def.procedures as Record<
      string,
      { _def: { type?: string } }
    >;
    expect(procedures.list?._def.type).toBe("query");
  });
});
