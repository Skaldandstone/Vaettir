// Authored only; validation deferred until morning.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { approvedFolderChangeSchema } from "./caseFolderSchema.js";
describe("optional captured folder identity", () => {
  const input = {
    projectId: "synthetic",
    action: "CREATE" as const,
    toPath: "New folder",
    expectedHash: "a".repeat(64),
    requestId: randomUUID(),
    confirmed: true,
    reason: "Reviewed",
  };
  it("keeps absence unchanged for legacy requests", () => {
    expect(
      Object.hasOwn(approvedFolderChangeSchema.parse(input), "expectedScope"),
    ).toBe(false);
  });
  it("only accepts strict bounded actor and organization binding", () => {
    expect(
      approvedFolderChangeSchema.parse({
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
      expect(
        approvedFolderChangeSchema.safeParse({ ...input, expectedScope })
          .success,
      ).toBe(false);
  });
});
