import { describe, it, expect } from "vitest";
import { retestClosure, retestStartInputSchema } from "./manualRetest.js";
import { manualRetestMetadataSchema } from "./manualRetestSchema.js";
import {
  boundedRunSnapshot,
  qualityProfileHash,
  runConfigurationSchema,
} from "./qualityExperienceProfile.js";

describe("explicit retest identity and frozen prerequisites", () => {
  it("orders only original prerequisite closure without borrowing other scope", () => {
    expect(
      retestClosure(["a", "b", "c", "other"], { c: ["b"], b: ["a"] }, "c"),
    ).toEqual({
      ordered: ["a", "b", "c"],
      prerequisites: { a: [], b: ["a"], c: ["b"] },
    });
  });
  it("fails closed cycles, missing scope, duplicate prerequisites and unsupported graph", () => {
    expect(() =>
      retestClosure(["a", "b"], { a: ["b"], b: ["a"] }, "a"),
    ).toThrow("cycle");
    expect(() => retestClosure(["a"], { a: ["foreign"] }, "a")).toThrow(
      "original scope",
    );
    expect(() => retestClosure(["a", "b"], { a: ["b", "b"] }, "a")).toThrow(
      "original scope",
    );
    expect(() => retestClosure(["a"], { a: "b" }, "a")).toThrow("invalid");
    expect(() => retestClosure(["a"], {}, "missing")).toThrow("invalid");
  });
  it("requires exact review hash and durable actor-bound request key shape", () => {
    expect(
      retestStartInputSchema.safeParse({
        projectId: "p",
        sourceRunId: "r",
        testCaseId: "c",
        expectedReviewHash: "x",
        idempotencyKey: "bad",
      }).success,
    ).toBe(false);
    expect(
      retestStartInputSchema.safeParse({
        projectId: "p",
        sourceRunId: "r",
        testCaseId: "c",
        expectedReviewHash: "a".repeat(64),
        idempotencyKey: "7dff6875-9d02-4426-a17a-7132fdd9e960",
        configuration: { build: "changed" },
      }).success,
    ).toBe(false);
  });
  it("adds bounded captured source evidence without changing legacy snapshots", () => {
    const snapshot = {
      version: 1,
      experience: null,
      profileHash: qualityProfileHash({}),
      configuration: runConfigurationSchema.parse({}),
      stepFieldLabels: {},
      caseDefinitions: [],
    };
    expect(boundedRunSnapshot(snapshot).retest).toBeUndefined();
    const retest = {
      version: 1,
      sourceRunId: "r",
      sourceCaseId: "c",
      sourceDisplayId: "project-01",
      sourceOutcome: "FAIL",
      sourceEvidenceHash: "a".repeat(64),
      sourceDefinitionHash: "b".repeat(64),
      configurationHash: "c".repeat(64),
      sourceResults: [
        {
          id: "result",
          testCaseId: "c",
          status: "FAIL",
          note: "Original failure",
          errorMessage: null,
          observations: {},
        },
      ],
      sourceStepRevisions: [],
    };
    expect(
      boundedRunSnapshot({ ...snapshot, retest }).retest?.sourceResults[0]
        ?.note,
    ).toBe("Original failure");
    expect(
      manualRetestMetadataSchema.safeParse({ ...retest, sourceOutcome: "PASS" })
        .success,
    ).toBe(false);
    expect(
      manualRetestMetadataSchema.safeParse({ ...retest, sourceResults: [] })
        .success,
    ).toBe(false);
  });
});
