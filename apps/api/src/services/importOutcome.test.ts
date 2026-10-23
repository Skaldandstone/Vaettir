import { describe, expect, it } from "vitest";
import { completedImportStatus, HUMAN_EDIT_SKIP_REASON, importSkippedRows, importStatusLabel } from "./importOutcome.js";

const protectedJob = { status: "FAILED", createdCount: 0, updatedCount: 0, skippedCount: 1, errors: [{ rowNumber: 2, reason: HUMAN_EDIT_SKIP_REASON }] };

describe("import outcomes", () => {
  it("distinguishes a completed protection decision from a validation failure, including retained history", () => {
    expect(completedImportStatus(protectedJob)).toBe("SUCCEEDED");
    expect(importStatusLabel(protectedJob)).toBe("Needs review");
    expect(protectedJob.status).toBe("FAILED");
    expect(importStatusLabel({ ...protectedJob, status: "PENDING" })).toBe("PENDING");
    for (const errors of [null, [], "missing", [{ rowNumber: 2, reason: "no verified source baseline" }], [{ rowNumber: 2, reason: HUMAN_EDIT_SKIP_REASON + " unverified" }]]) {
      expect(completedImportStatus({ ...protectedJob, errors })).toBe("FAILED");
      expect(importStatusLabel({ ...protectedJob, errors })).toBe("Failed");
    }
  });
  it("does not hide mixed validation errors or incomplete historical reasons", () => {
    const mixed = { ...protectedJob, skippedCount: 2, errors: [...protectedJob.errors, { rowNumber: 3, reason: "Title is required" }] };
    expect(completedImportStatus(mixed)).toBe("FAILED");
    expect(importStatusLabel(mixed)).toBe("Failed");
    expect(importStatusLabel({ ...protectedJob, skippedCount: 2 })).toBe("Failed");
    expect(importStatusLabel({ ...mixed, status: "SUCCEEDED", createdCount: 1 })).toBe("Completed with skipped rows");
    expect(completedImportStatus({ ...mixed, createdCount: 1 })).toBe("SUCCEEDED");
    expect(importStatusLabel({ ...protectedJob, status: "SUCCEEDED", skippedCount: 0, errors: [] })).toBe("Completed");
  });
  it("returns only structurally valid row details", () => {
    expect(importSkippedRows(protectedJob.errors)).toEqual(protectedJob.errors);
    expect(importSkippedRows([{ reason: "missing row" }])).toEqual([]);
    expect(importSkippedRows([{ rowNumber: -1, reason: "bad row" }])).toEqual([]);
  });
});
