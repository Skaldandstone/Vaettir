import { describe, expect, it } from "vitest";
import { boundedSharedLibrary } from "./sharedStepHistory.js";
import { sharedLibraryWriteSchema } from "./sharedStepHistorySchema.js";

describe("retained shared library content", () => {
  it("preserves whitespace, media references and missing legacy optional fields", () => {
    const content = {
      name: "Exact name",
      description: "  exact\n背景 ",
      steps: [
        {
          order: 0,
          action: "  exact action\n",
          mediaAttachmentIds: ["media-1"],
        },
      ],
      archived: false,
    };
    expect(boundedSharedLibrary(content)).toEqual(content);
  });
  it("rejects oversized, unknown and missing original content instead of truncating", () => {
    for (const content of [
      { name: "x", description: null, steps: [], archived: false },
      {
        name: "x",
        description: null,
        steps: [{ order: 0, action: "x", unknown: "retained raw" }],
        archived: false,
      },
      {
        name: "x",
        description: null,
        steps: Array.from({ length: 100 }, (_, order) => ({
          order,
          action: "x".repeat(5000),
        })),
        archived: false,
      },
    ])
      expect(() => boundedSharedLibrary(content)).toThrow();
  });
  it("requires explicit approval, stable CAS, reasons, and exact action inputs", () => {
    const input = {
      projectId: "p",
      id: "g",
      expectedRevisionHash: "0".repeat(64),
      requestId: "11111111-1111-4111-8111-111111111111",
      confirmed: true,
      reason: "Reviewed restoration",
      action: "RESTORE",
      sourceRevision: 1,
    };
    expect(sharedLibraryWriteSchema.safeParse(input).success).toBe(true);
    for (const patch of [
      { confirmed: false },
      { reason: " " },
      { sourceRevision: undefined },
      {
        content: {
          name: "x",
          description: null,
          steps: [{ order: 0, action: "x" }],
        },
      },
      { action: "ARCHIVE" },
      { expectedRevisionHash: "" },
    ])
      expect(
        sharedLibraryWriteSchema.safeParse({ ...input, ...patch }).success,
      ).toBe(false);
  });
});
