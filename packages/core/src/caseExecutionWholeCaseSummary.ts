import { z } from "zod";

/** Read-time metadata from retained whole-case revisions, not an as-of verdict. */
export const caseExecutionWholeCaseSummarySchema = z.object({
  revisionCount: z.number().int().min(1).max(100),
  correctionCount: z.number().int().min(0).max(100),
  lastRecorderName: z.string().min(1).max(200),
  lastRecordedAt: z.string().datetime(),
  lastStatus: z.enum(["PASS", "FAIL", "BLOCKED", "SKIP"]),
}).strict().refine(value => value.correctionCount <= value.revisionCount, {
  message: "Recorded corrections cannot exceed retained revisions.",
});
export type CaseExecutionWholeCaseSummary = z.infer<typeof caseExecutionWholeCaseSummarySchema>;
