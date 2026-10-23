import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import {
  folderCopyApprovalSchema,
  folderCopyReviewSchema,
} from "./caseFolderCopySchema.js";
describe("folder-copy approval contract (authored, not executed)", () => {
  it("requires complete bounded source/destination and actor request identity", () => {
    const input = {
      projectId: "synthetic-project",
      fromPath: "Original",
      toPath: "New/Copy",
      expectedHash: "a".repeat(64),
      requestId: randomUUID(),
      confirmed: true,
      reason: "Exact reviewed independent copy",
    };
    expect(folderCopyApprovalSchema.safeParse(input).success).toBe(true);
    for (const value of [
      { ...input, confirmed: false },
      { ...input, reason: " " },
      { ...input, requestId: "copy" },
      { ...input, caseIds: ["partial-selection"] },
      { ...input, toPath: "Bad/../Path" },
    ])
      expect(folderCopyApprovalSchema.safeParse(value).success).toBe(false);
    expect(
      folderCopyReviewSchema.safeParse({
        projectId: "synthetic",
        fromPath: "Original",
        toPath: "Fresh",
        truncate: true,
      }).success,
    ).toBe(false);
  });
});
