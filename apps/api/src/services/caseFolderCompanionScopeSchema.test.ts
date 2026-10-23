// Authored only, not executed during source-only work.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { folderCopyApprovalSchema } from "./caseFolderCopySchema.js";
import { approvedFolderRecoverySchema } from "./caseFolderRecoverySchema.js";
describe("captured companion identity is optional and strict", () => {
  const common = {
    projectId: "synthetic",
    expectedHash: "a".repeat(64),
    requestId: randomUUID(),
    confirmed: true,
    reason: "Reviewed",
  };
  for (const [name, schema, input] of [
    [
      "copy",
      folderCopyApprovalSchema,
      { ...common, fromPath: "Source", toPath: "Copy" },
    ],
    [
      "recovery",
      approvedFolderRecoverySchema,
      { ...common, originalReceiptId: "original" },
    ],
  ] as const)
    it(`${name} preserves absence and rejects incomplete/oversized identity`, () => {
      expect(Object.hasOwn(schema.parse(input), "expectedScope")).toBe(false);
      expect(
        schema.parse({
          ...input,
          expectedScope: { organizationId: "org", clerkActorId: "actor" },
        }).expectedScope,
      ).toEqual({ organizationId: "org", clerkActorId: "actor" });
      for (const expectedScope of [
        null,
        {},
        { organizationId: "", clerkActorId: "actor" },
        { organizationId: "org", clerkActorId: "a".repeat(201) },
        { organizationId: "org", clerkActorId: "actor", override: true },
      ])
        expect(schema.safeParse({ ...input, expectedScope }).success).toBe(
          false,
        );
    });
});
