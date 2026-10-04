// SOURCE ONLY: authored NOT RUN. These assertions are not acceptance evidence.
import { describe, it, expect } from "vitest";
import { savedCaseQueryReadInput } from "./savedCaseQuerySchema.js";

describe("selected saved-definition original read scope (NOT RUN)", () => {
  it("keeps the omitted legacy shape and preserves exact scoped identities", () => {
    expect(savedCaseQueryReadInput.parse({ projectId: "p", id: "q" })).toEqual({
      projectId: "p",
      id: "q",
    });
    const input = {
      projectId: "p",
      id: "q",
      expectedScope: {
        organizationId: "original-org",
        clerkActorId: "original-clerk",
      },
    };
    expect(savedCaseQueryReadInput.parse(input)).toEqual(input);
  });
  it("refuses malformed, extra and overbound identity inputs rather than dropping them", () => {
    for (const expectedScope of [
      {},
      { organizationId: "org", clerkActorId: "" },
      { organizationId: "x".repeat(121), clerkActorId: "actor" },
      { organizationId: "org", clerkActorId: "x".repeat(201) },
      { organizationId: "org", clerkActorId: "actor", role: "OWNER" },
    ])
      expect(
        savedCaseQueryReadInput.safeParse({
          projectId: "p",
          id: "q",
          expectedScope,
        }).success,
      ).toBe(false);
  });
});
