// Authored, not run tonight.
import { describe, it, expect } from "vitest";
import {
  recordedRunComparisonInput,
  recordedRunListInput,
  recordedStatusCounts,
} from "./recordedRunComparisonSchema.js";
describe("recorded-run comparison typed read-only contract", () => {
  const input = {
    projectId: "project",
    baselineRunId: "baseline",
    candidateRunId: "candidate",
    requestId: "564e03d6-3307-452e-9323-ef98bb808158",
  };
  it("retains omitted legacy shapes and permits bounded original organization/current actor binding only", () => {
    expect(recordedRunComparisonInput.parse(input)).toEqual(input);
    const bound = { ...input, originalOrganizationId: "original-org", expectedClerkActorId: "original-clerk" };
    expect(recordedRunComparisonInput.parse(bound)).toEqual(bound);
    expect(recordedRunListInput.parse({ projectId: input.projectId, requestId: input.requestId, originalOrganizationId: "original-org", expectedClerkActorId: "original-clerk" }).originalOrganizationId).toBe("original-org");
    for (const bad of [{ originalOrganizationId: "" }, { expectedClerkActorId: "x".repeat(201) }, { organizationId: "not-the-contract" }, { actorRole: "OWNER" }])
      expect(recordedRunComparisonInput.safeParse({ ...input, ...bad }).success).toBe(false);
  });
  it("allows exact pair/cursor fingerprints without arbitrary predicates", () => {
    expect(recordedRunComparisonInput.parse(input)).toEqual(input);
    expect(
      recordedRunComparisonInput.safeParse({
        ...input,
        sql: "select",
        classifyFlaky: true,
      }).success,
    ).toBe(false);
    expect(
      recordedRunComparisonInput.safeParse({
        ...input,
        cursor: { caseId: "case", expectedPairHash: "bad" },
      }).success,
    ).toBe(false);
  });
  it("bounds native run and case identities and rejects invented page sizes", () => {
    expect(
      recordedRunListInput.safeParse({
        projectId: "x".repeat(201),
        requestId: input.requestId,
      }).success,
    ).toBe(false);
    expect(
      recordedRunComparisonInput.safeParse({ ...input, take: 100000 }).success,
    ).toBe(false);
    expect(
      recordedRunListInput.safeParse({
        projectId: "project",
        requestId: input.requestId,
        cursor: { runId: "run", startedAt: "not a date" },
      }).success,
    ).toBe(false);
  });
  it("retains all five statuses and rejects omitted negative or new inferred outcomes", () => {
    const counts = { PASS: 0, FAIL: 1, SKIP: 0, FLAKY: 2, BLOCKED: 0 };
    expect(recordedStatusCounts.parse(counts)).toEqual(counts);
    expect(
      recordedStatusCounts.safeParse({ ...counts, FAIL: -1 }).success,
    ).toBe(false);
    expect(
      recordedStatusCounts.safeParse({ ...counts, REGRESSION: 1 }).success,
    ).toBe(false);
  });
});
