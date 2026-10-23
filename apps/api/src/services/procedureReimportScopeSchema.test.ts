// SOURCE ONLY: authored scenarios, not executed tonight.
import { describe, expect, it } from "vitest";
import { procedureReimportApproval, procedureReimportInput } from "./caseProcedureReimport.js";
import { qualityProfileHash } from "./qualityExperienceProfile.js";

describe("optional procedure restore original scope", () => {
  const legacy = { projectId: "synthetic-project", serialized: "{}", expectedReviewHash: "a".repeat(64),
    actorId: "synthetic-actor", selections: [{ caseId: "synthetic-case", reason: "Reviewed reason", overwriteConfirmed: true as const }],
    confirmed: true as const, requestId: "c65d02aa-a561-4a89-a2a6-58770807d020" };
  it("omission retains the original legacy approval body and hash", () => {
    const parsed = procedureReimportApproval.parse(legacy);
    expect(parsed).toEqual(legacy);
    expect(Object.hasOwn(parsed, "expectedScope")).toBe(false);
    expect(qualityProfileHash(parsed)).toBe(qualityProfileHash(legacy));
  });
  it("a bounded explicit scope becomes part of the exact UUID approval hash", () => {
    const scope = { organizationId: "synthetic-org", clerkActorId: "synthetic-clerk" };
    const parsed = procedureReimportApproval.parse({ ...legacy, expectedScope: scope });
    expect(parsed.expectedScope).toEqual(scope);
    expect(qualityProfileHash(parsed)).not.toBe(qualityProfileHash(legacy));
    expect(procedureReimportInput.safeParse({ projectId: "p", serialized: "{}", expectedScope: { ...scope, grantsEditor: true } }).success).toBe(false);
    expect(procedureReimportInput.safeParse({ projectId: "p", serialized: "{}", expectedScope: { ...scope, clerkActorId: "" } }).success).toBe(false);
  });
});
