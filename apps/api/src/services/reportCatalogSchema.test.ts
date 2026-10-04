import { describe, expect, it } from "vitest";
import {
  reportCatalogInput,
  reportCatalogKey,
  reportCatalogTitlePattern,
} from "./reportCatalogSchema.js";

// Authored source regressions only; no validation executed tonight.
describe("bounded report catalog inputs", () => {
  it("defaults to approved-catalog metadata browsing with a stable query identity", () => {
    const input = reportCatalogInput.parse({ projectId: "synthetic-project" });
    expect(input).toEqual({
      projectId: "synthetic-project",
      page: 0,
      search: "",
      audience: "all",
      purpose: "all",
      sort: "captured-desc",
    });
    expect(reportCatalogKey(input)).not.toBe(
      reportCatalogKey({ ...input, page: 1 }),
    );
    expect(reportCatalogKey(input)).not.toBe(
      reportCatalogKey({ ...input, purpose: "defect-review" }),
    );
  });
  it("rejects unbounded or arbitrary query fields", () => {
    for (const extra of [
      { page: 25 },
      { search: "x".repeat(81) },
      { audience: "owner" },
      { sort: "raw SQL" },
      { rawQuery: "SELECT *" },
    ])
      expect(
        reportCatalogInput.safeParse({
          projectId: "synthetic-project",
          ...extra,
        }).success,
      ).toBe(false);
  });
  it("keeps literal wildcard and backslash characters as title text", () => {
    expect(reportCatalogTitlePattern("a%_\\b")).toBe("%a\\%\\_\\\\b%");
    expect(reportCatalogTitlePattern("quote ' ; --")).toBe("%quote ' ; --%");
  });
  it("validates inclusive calendar capture dates without changing execution scope", () => {
    const base = { projectId: "synthetic-project" };
    expect(
      reportCatalogInput.safeParse({
        ...base,
        capturedInterval: { start: "2024-02-29", end: "2024-02-29" },
      }).success,
    ).toBe(true);
    expect(
      reportCatalogInput.safeParse({
        ...base,
        capturedInterval: { start: "2026-02-29", end: "2026-03-01" },
      }).success,
    ).toBe(false);
    expect(
      reportCatalogInput.safeParse({
        ...base,
        capturedInterval: { start: "2026-10-04", end: "2026-10-03" },
      }).success,
    ).toBe(false);
    expect(
      reportCatalogInput.safeParse({
        ...base,
        capturedInterval: { start: "2024-01-01", end: "2026-01-01" },
      }).success,
    ).toBe(false);
  });
});
