// SOURCE ONLY: authored, not executed tonight.
import { describe, expect, it } from "vitest";
import { qualityRiskOverviewInput, qualityRiskOverviewDetailInput, qualityRiskOverviewRequestKey } from "./qualityRiskOverviewSchema.js";
describe("optional original risk overview actor", () => {
  it("omitted legacy actor has no new default property or request key", () => {
    const legacy = qualityRiskOverviewInput.parse({ projectId: "synthetic-project" });
    expect(Object.hasOwn(legacy, "expectedClerkActorId")).toBe(false);
    expect(qualityRiskOverviewRequestKey(legacy)).toBe(qualityRiskOverviewRequestKey({ projectId: "synthetic-project", offset: 0, search: "", review: "ANY", disposition: "ANY", evidence: "ANY", mitigation: "ANY" }));
    expect(Object.hasOwn(qualityRiskOverviewDetailInput.parse({ projectId: "p", id: "risk" }), "expectedClerkActorId")).toBe(false);
  });
  it("actor scopes both summary and detail keys and refuses empty or overbound identity", () => {
    const a = qualityRiskOverviewInput.parse({ projectId: "p", expectedClerkActorId: "actor-a" });
    const b = qualityRiskOverviewInput.parse({ projectId: "p", expectedClerkActorId: "actor-b" });
    expect(qualityRiskOverviewRequestKey(a)).not.toBe(qualityRiskOverviewRequestKey(b));
    expect(qualityRiskOverviewDetailInput.parse({ projectId: "p", id: "risk", expectedClerkActorId: "actor-a" }).expectedClerkActorId).toBe("actor-a");
    for (const expectedClerkActorId of ["", "x".repeat(201)]) expect(qualityRiskOverviewInput.safeParse({ projectId: "p", expectedClerkActorId }).success).toBe(false);
  });
});
