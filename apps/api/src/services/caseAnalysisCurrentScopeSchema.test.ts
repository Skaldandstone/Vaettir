import { describe, expect, it } from "vitest";
import {
  caseAnalysisApprovalSchema,
  caseAnalysisJobInputSchema,
  caseAnalysisMineSchema,
  caseAnalysisReadInputSchema,
  caseAnalysisRequestSchema,
  caseAnalysisSelectionSchema,
} from "./caseAnalysisQueueSchema.js";
describe("durable queue optional complete original scope", () => {
  const scope = {
    originalOrganizationId: "owned-org",
    expectedClerkActorId: "owned-clerk",
  };
  const examples = [
    [
      caseAnalysisSelectionSchema,
      {
        projectId: "p",
        action: "RISK",
        ids: ["c"],
        requestId: "00000000-0000-4000-8000-000000000001",
      },
    ],
    [
      caseAnalysisApprovalSchema,
      {
        projectId: "p",
        id: "q",
        scopeHash: "a".repeat(64),
        maximumCredits: 2,
        approved: true,
        allowCaseProcessing: true,
      },
    ],
    [caseAnalysisJobInputSchema, { projectId: "p", id: "q" }],
    [caseAnalysisReadInputSchema, { projectId: "p", id: "q", offset: 0 }],
    [
      caseAnalysisRequestSchema,
      { projectId: "p", id: "q", reason: "Original approved reason" },
    ],
    [caseAnalysisMineSchema, { projectId: "p" }],
  ] as const;
  it("preserves legacy omitted bodies without injecting client authorization fields", () => {
    for (const [schema, input] of examples)
      expect(schema.parse(input)).toEqual(input);
  });
  it("accepts only a bounded complete pair and rejects unknown authorization shortcuts", () => {
    for (const [schema, input] of examples) {
      expect(schema.parse({ ...input, ...scope })).toEqual({
        ...input,
        ...scope,
      });
      for (const bad of [
        { originalOrganizationId: scope.originalOrganizationId },
        { expectedClerkActorId: scope.expectedClerkActorId },
        { ...scope, expectedClerkActorId: "x".repeat(201) },
        { ...scope, originalOrganizationId: "" },
        { ...scope, canSpend: true },
      ])
        expect(schema.safeParse({ ...input, ...bad }).success).toBe(false);
    }
  });
});
