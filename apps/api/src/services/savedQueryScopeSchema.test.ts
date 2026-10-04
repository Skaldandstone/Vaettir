// Authored source-only; not executed during the overnight implementation.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { defaultCaseQuery } from "./caseQuerySchema.js";
import { savedCaseQueryWriteInput } from "./savedCaseQuerySchema.js";
describe("optional captured saved-query identity", () => {
  const base = {
    operation: "CREATE" as const,
    projectId: "synthetic",
    requestId: randomUUID(),
    definition: {
      name: "Typed query",
      visibility: "PRIVATE" as const,
      query: defaultCaseQuery(),
      columns: ["title"],
    },
  };
  it("preserves absence for legacy hash/replay compatibility", () => {
    expect(
      Object.hasOwn(savedCaseQueryWriteInput.parse(base), "expectedScope"),
    ).toBe(false);
  });
  it("allows only bounded exact identity echoes, never unknown identity fields", () => {
    expect(
      savedCaseQueryWriteInput.parse({
        ...base,
        expectedScope: { organizationId: "org", clerkActorId: "user" },
      }).expectedScope,
    ).toEqual({ organizationId: "org", clerkActorId: "user" });
    for (const expectedScope of [
      null,
      {},
      { organizationId: "", clerkActorId: "user" },
      { organizationId: "org", clerkActorId: "x".repeat(201) },
      { organizationId: "org", clerkActorId: "user", bypass: true },
    ])
      expect(
        savedCaseQueryWriteInput.safeParse({ ...base, expectedScope }).success,
      ).toBe(false);
  });
});
