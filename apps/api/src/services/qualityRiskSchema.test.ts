import { describe, expect, it } from "vitest";
import { qualityRiskDefinition, qualityResidualDecision, qualityRiskWriteInput, qualityRiskEvidence } from "./qualityRiskSchema.js";

// Authored only. Do not treat this file as a passed check until morning execution.
const definition = { title: "Synthetic valve failure", component: "Bench valve", failureMode: "Valve remains closed",
  cause: "Drive failure", effect: "No delivery", likelihood: "UNKNOWN", consequence: "SEVERE",
  rationale: "Frequency has not been established", mitigation: "Independent flow check", requirementIds: [], caseIds: [] };
const decision = { likelihood: "UNKNOWN", consequence: "SIGNIFICANT", rationale: "Human review records remaining uncertainty",
  evidenceNotes: "No physical device used", disposition: "FURTHER_ACTION", resultIds: [], acknowledgeNotQualifiedApproval: true };
describe("manual quality risk bounds and qualification semantics", () => {
  it("preserves unknown qualitative categories without inventing a score or acceptability", () => {
    expect(qualityRiskDefinition.parse(definition)).toEqual(definition);
    expect(qualityResidualDecision.parse(decision)).toEqual(decision);
    expect(() => qualityRiskDefinition.parse({ ...definition, riskScore: 10 })).toThrow();
    expect(() => qualityResidualDecision.parse({ ...decision, qualifiedApproval: true })).toThrow();
  });
  it("requires explicit ordinary-review acknowledgement and rejects silent missing rationale", () => {
    expect(() => qualityResidualDecision.parse({ ...decision, acknowledgeNotQualifiedApproval: false })).toThrow();
    expect(() => qualityRiskDefinition.parse({ ...definition, rationale: " " })).toThrow();
    expect(() => qualityResidualDecision.parse({ ...decision, rationale: " " })).toThrow();
  });
  it("bounds reference uniqueness, count and serialized UTF-8 bytes", () => {
    expect(() => qualityRiskDefinition.parse({ ...definition, caseIds: ["one", "one"] })).toThrow();
    expect(() => qualityRiskDefinition.parse({ ...definition, requirementIds: Array.from({ length: 21 }, (_, n) => `${n}`) })).toThrow();
    expect(() => qualityRiskDefinition.parse({ ...definition, cause: "界".repeat(1500), effect: "界".repeat(1500),
      rationale: "界".repeat(2000), mitigation: "界".repeat(2000) })).toThrow();
  });
  it("rejects client identity, stale/nonpositive CAS and non-UUID receipts", () => {
    const input = { operation: "UPDATE", projectId: "project", id: "risk", expectedVersion: 1,
      requestId: "f74dbd60-7425-41b5-aa5a-481d8bc6a0bf", dropUnavailableLinks: false, definition };
    expect(qualityRiskWriteInput.parse(input)).toEqual(input);
    expect(() => qualityRiskWriteInput.parse({ ...input, actorId: "forged" })).toThrow();
    expect(() => qualityRiskWriteInput.parse({ ...input, expectedVersion: 0 })).toThrow();
    expect(() => qualityRiskWriteInput.parse({ ...input, requestId: "not-a-uuid" })).toThrow();
  });
  it("keeps status observation distinct from an invented result completion timestamp", () => {
    const evidence = { resultId: "result", caseId: "case", runId: "run", caseDisplayId: "SYN-01", status: "BLOCKED",
      observedAt: "2026-10-04T03:00:00.000Z", runStartedAt: "2026-10-04T02:00:00.000Z" };
    expect(qualityRiskEvidence.parse([evidence])).toEqual([evidence]);
    expect(() => qualityRiskEvidence.parse([{ ...evidence, resultCompletedAt: evidence.observedAt }])).toThrow();
  });
});
