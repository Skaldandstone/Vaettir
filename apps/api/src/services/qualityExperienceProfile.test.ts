import { describe, expect, it } from "vitest";
import {
  boundedRunSnapshot,
  qualityProfileHash,
  readQualityExperience,
  readRunExperienceSnapshot,
  runConfigurationSchema,
} from "./qualityExperienceProfile.js";

describe("experience snapshots and revision hashes", () => {
  it("includes unknown fields and ignores JSON object key ordering, not array ordering", () => {
    expect(qualityProfileHash({ objective: "A", future: { b: 2, a: 1 } })).toBe(
      qualityProfileHash({ future: { a: 1, b: 2 }, objective: "A" }),
    );
    expect(qualityProfileHash({ future: 1 })).not.toBe(
      qualityProfileHash({ future: 2 }),
    );
    expect(qualityProfileHash({ items: [1, 2] })).not.toBe(
      qualityProfileHash({ items: [2, 1] }),
    );
  });
  it("does not infer an experience from old preference labels or assign a profile to old runs", () => {
    expect(
      readQualityExperience({ softwareTypes: ["Game"], hardwareTypes: ["HIL"] })
        .experience,
    ).toBeNull();
    expect(readRunExperienceSnapshot({})).toBeNull();
    expect(readRunExperienceSnapshot({ rig: "Legacy bench" })).toBeNull();
  });
  it("rejects unsupported persisted profile data instead of silently overwriting it", () => {
    expect(() =>
      readQualityExperience({ experience: { version: 999 } }),
    ).toThrow("unsupported");
    expect(() => readQualityExperience(["legacy-array"])).toThrow(
      "saved profile needs review",
    );
  });
  it("bounds metadata and rejects undeclared acceptance limits or compliance claims", () => {
    expect(
      runConfigurationSchema.safeParse({ configuration: "a".repeat(2001) })
        .success,
    ).toBe(false);
    expect(
      runConfigurationSchema.safeParse({ safeTemperature: 75 }).success,
    ).toBe(false);
    expect(
      runConfigurationSchema.parse({ batchOrLot: "  synthetic-lot  " })
        .batchOrLot,
    ).toBe("synthetic-lot");
  });
  it("explicitly fails snapshots over the total byte cap without truncating case definitions", () => {
    const caseDefinition = {
      testCaseId: "case",
      title: "Synthetic",
      validationDomain: "SOFTWARE",
      reviewStatus: "APPROVED",
      background: null,
      given: ["a".repeat(10000)],
      when: [],
      then: [],
      verificationProfile: {
        setup: "",
        safety: "",
        instruments: "",
        acceptanceCriteria: "",
      },
      steps: [],
    };
    expect(() =>
      boundedRunSnapshot({
        version: 1,
        experience: null,
        profileHash: qualityProfileHash({}),
        configuration: {},
        stepFieldLabels: {},
        caseDefinitions: Array.from({ length: 250 }, () => caseDefinition),
      }),
    ).toThrow("bounded run snapshot");
    const normal = boundedRunSnapshot({
      version: 1,
      experience: null,
      profileHash: qualityProfileHash({}),
      configuration: {},
      stepFieldLabels: {},
      caseDefinitions: [caseDefinition],
    });
    expect(normal.caseDefinitions[0]?.given[0]).toHaveLength(10000);
  });
  it("supports 851 complete definitions but keeps nested procedure and suite limits", () => {
    const definition = {
      testCaseId: "synthetic",
      title: "Synthetic",
      validationDomain: "SOFTWARE",
      reviewStatus: "APPROVED",
      background: null,
      given: [],
      when: [],
      then: [],
      verificationProfile: {
        setup: "",
        safety: "",
        instruments: "",
        acceptanceCriteria: "",
      },
      steps: [],
    };
    const snapshot = {
      version: 1,
      experience: null,
      profileHash: qualityProfileHash({}),
      configuration: {},
      stepFieldLabels: {},
      caseDefinitions: Array.from({ length: 851 }, (_, i) => ({
        ...definition,
        testCaseId: `synthetic-${i}`,
      })),
    };
    expect(boundedRunSnapshot(snapshot).caseDefinitions).toHaveLength(851);
    expect(() =>
      boundedRunSnapshot({
        ...snapshot,
        caseDefinitions: Array.from({ length: 1001 }, () => definition),
      }),
    ).toThrow("bounded run snapshot");
    expect(() =>
      boundedRunSnapshot({
        ...snapshot,
        caseDefinitions: [
          {
            ...definition,
            given: Array.from({ length: 501 }, () => "instruction"),
          },
        ],
      }),
    ).toThrow("bounded run snapshot");
  });
});
