import { describe, it, expect } from "vitest";
import {
  caseAuthoringPresetDefinition,
  caseAuthoringPresetReview,
  caseAuthoringPresetApproval,
  caseAuthoringPresetScope,
  caseAuthoringPresetPrefill,
  caseAuthoringPresetCatalogScope,
} from "./caseAuthoringPresetSchema.js";
const definition = {
  version: 1,
  titleSuggestion: "",
  background: "Separate execution conditions",
  given: ["Original setup"],
  when: ["Original action"],
  then: ["Original expected outcome"],
  steps: [
    {
      action: "Exact action",
      expectedActionOrData: "Exact data",
      expectedResult: "Exact outcome",
      expectedResponse: "Exact response",
    },
  ],
  testType: "FUNCTIONAL",
  priority: "MEDIUM",
  tags: [],
  validationDomain: "SOFTWARE",
  verificationProfile: {
    setup: "",
    safety: "",
    instruments: "",
    acceptanceCriteria: "",
  },
  customFields: {},
  applicability: null,
};
describe("controlled authoring preset contracts (authored; not executed tonight)", () => {
  it("preserves omitted legacy identity shapes and accepts only complete original-organization actor bindings", () => {
    const legacy = { projectId: "project", presetId: "preset" };
    expect(caseAuthoringPresetScope.parse(legacy)).toEqual(legacy);
    expect(Object.hasOwn(caseAuthoringPresetScope.parse(legacy), "expectedScope")).toBe(false);
    const expectedScope = { organizationId: "original-org", clerkActorId: "original-clerk" };
    expect(caseAuthoringPresetCatalogScope.parse({ projectId: "project", expectedScope })).toEqual({ projectId: "project", expectedScope });
    expect(caseAuthoringPresetPrefill.parse({ ...legacy, expectedScope, expectedHash: "a".repeat(64), confirmed: true }).expectedScope).toEqual(expectedScope);
    for (const unsupported of [{ organizationId: "org" }, { clerkActorId: "clerk" }, { organizationId: "", clerkActorId: "clerk" }, { ...expectedScope, role: "OWNER" }])
      expect(caseAuthoringPresetScope.safeParse({ ...legacy, expectedScope: unsupported }).success).toBe(false);
  });
  it("retains separate background, mixed GWT and ordered expected columns without reference/approval fields", () => {
    expect(caseAuthoringPresetDefinition.parse(definition)).toEqual(definition);
    for (const key of [
      "sharedStepGroupId",
      "testPlanId",
      "prerequisiteIds",
      "dataset",
      "riskAssessment",
      "reviewStatus",
      "automationDraft",
      "source",
    ])
      expect(
        caseAuthoringPresetDefinition.safeParse({
          ...definition,
          [key]: "unsupported",
        }).success,
      ).toBe(false);
    expect(
      caseAuthoringPresetDefinition.safeParse({
        ...definition,
        steps: [
          { ...definition.steps[0], mediaAttachmentIds: ["unavailable"] },
        ],
      }).success,
    ).toBe(false);
    expect(
      caseAuthoringPresetDefinition.safeParse({
        ...definition,
        steps: Array.from({ length: 101 }, () => definition.steps[0]),
      }).success,
    ).toBe(false);
  });
  it("requires exact operation identity, reason and explicit actor-bound approval inputs", () => {
    const review = {
      projectId: "project",
      operation: "CREATE",
      name: "Owner scaffold",
      definition,
    };
    expect(caseAuthoringPresetReview.safeParse(review).success).toBe(true);
    expect(
      caseAuthoringPresetReview.safeParse({ ...review, presetId: "existing" })
        .success,
    ).toBe(false);
    expect(
      caseAuthoringPresetReview.safeParse({
        projectId: "project",
        operation: "UPDATE",
        presetId: "existing",
      }).success,
    ).toBe(false);
    expect(
      caseAuthoringPresetReview.safeParse({
        projectId: "project",
        operation: "RESTORE",
        presetId: "existing",
        restoreReceiptId: "receipt",
      }).success,
    ).toBe(true);
    expect(
      caseAuthoringPresetApproval.safeParse({
        ...review,
        expectedHash: "a".repeat(64),
        requestId: "00000000-0000-4000-8000-000000000001",
        confirmed: true,
        reason: "Owner-reviewed scaffold",
      }).success,
    ).toBe(true);
    expect(
      caseAuthoringPresetApproval.safeParse({
        ...review,
        expectedHash: "a".repeat(64),
        requestId: "bad",
        confirmed: false,
        reason: "",
      }).success,
    ).toBe(false);
  });
});
