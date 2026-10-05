import { z } from "zod";
export const MAX_ANALYSIS_SELECTION = 1000;
export const caseAnalysisScopeFields = {
  originalOrganizationId: z.string().min(1).max(120).optional(),
  expectedClerkActorId: z.string().min(1).max(200).optional(),
};
export type CaseAnalysisClientScope = {
  originalOrganizationId?: string;
  expectedClerkActorId?: string;
};
export type CaseAnalysisReadScope = {
  projectId: string;
  organizationId: string;
  actorId: string;
  actorClerkUserId: string;
};
function completeScope<T extends z.ZodRawShape>(schema: z.ZodObject<T>) {
  return schema.refine((value) => {
    const input = value as CaseAnalysisClientScope;
    return (
      Boolean(input.originalOrganizationId) ===
      Boolean(input.expectedClerkActorId)
    );
  }, "Original organization and expected Clerk actor must be supplied together");
}
export const caseAnalysisActionSchema = z.enum(["RISK", "TYPE_DESIGN"]);
export const caseAnalysisJobStatusSchema = z.enum([
  "REVIEW",
  "QUEUED",
  "RUNNING",
  "STOPPED",
  "COMPLETE",
  "CANCELLED",
]);
export const caseAnalysisItemStatusSchema = z.enum([
  "QUEUED",
  "RUNNING",
  "SAVED",
  "SKIPPED",
  "READY",
  "FAILED",
  "UNKNOWN",
]);
export const caseAnalysisSelectionSchema = completeScope(
  z
    .object({
      projectId: z.string().min(1).max(120),
      action: caseAnalysisActionSchema,
      ids: z
        .array(z.string().min(1).max(120))
        .min(1)
        .max(MAX_ANALYSIS_SELECTION)
        .refine(
          (ids) => new Set(ids).size === ids.length,
          "Duplicate case IDs are not allowed",
        ),
      requestId: z.string().uuid(),
      ...caseAnalysisScopeFields,
    })
    .strict(),
);
export const caseAnalysisApprovalSchema = completeScope(
  z
    .object({
      projectId: z.string().min(1).max(120),
      id: z.string().min(1).max(120),
      scopeHash: z.string().regex(/^[a-f0-9]{64}$/),
      maximumCredits: z.number().int().min(0).max(12000),
      approved: z.literal(true),
      allowCaseProcessing: z.literal(true),
      ...caseAnalysisScopeFields,
    })
    .strict(),
);
const jobInput = z
  .object({
    projectId: z.string().min(1).max(120),
    id: z.string().min(1).max(120),
    ...caseAnalysisScopeFields,
  })
  .strict();
export const caseAnalysisJobInputSchema = completeScope(jobInput);
export const caseAnalysisReadInputSchema = completeScope(
  jobInput
    .extend({
      offset: z.number().int().min(0).max(950).default(0),
    })
    .strict(),
);
export const caseAnalysisMineSchema = completeScope(
  z
    .object({
      projectId: z.string().min(1).max(120),
      ...caseAnalysisScopeFields,
    })
    .strict(),
);
export const caseAnalysisRequestSchema = completeScope(
  jobInput.extend({ reason: z.string().trim().min(1).max(500) }).strict(),
);
export type CaseAnalysisAction = z.infer<typeof caseAnalysisActionSchema>;
