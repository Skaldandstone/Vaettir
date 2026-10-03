import { z } from "zod";
export const MAX_ANALYSIS_SELECTION = 1000;
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
export const caseAnalysisSelectionSchema = z
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
  })
  .strict();
export const caseAnalysisApprovalSchema = z
  .object({
    projectId: z.string().min(1).max(120),
    id: z.string().min(1).max(120),
    scopeHash: z.string().regex(/^[a-f0-9]{64}$/),
    maximumCredits: z.number().int().min(0).max(12000),
    approved: z.literal(true),
    allowCaseProcessing: z.literal(true),
  })
  .strict();
export const caseAnalysisJobInputSchema = z
  .object({
    projectId: z.string().min(1).max(120),
    id: z.string().min(1).max(120),
  })
  .strict();
export const caseAnalysisRequestSchema = caseAnalysisJobInputSchema
  .extend({ reason: z.string().trim().min(1).max(500) })
  .strict();
export type CaseAnalysisAction = z.infer<typeof caseAnalysisActionSchema>;
