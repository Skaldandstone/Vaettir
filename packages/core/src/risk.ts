import { z } from "zod";

// Shared between the AI risk-assessment agent and its callers. Reuses the
// same four-point scale as RiskFlag.severity (Prisma's RiskSeverity enum)
// rather than inventing a second one for the same concept.
export const RiskSeveritySchema = z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]);
export type RiskSeverityValue = z.infer<typeof RiskSeveritySchema>;

export const TestCaseRiskAssessmentSchema = z.object({
  severity: RiskSeveritySchema,
  riskScore: z.number().min(0).max(100),
  rationale: z.string().min(1),
});
export type TestCaseRiskAssessment = z.infer<typeof TestCaseRiskAssessmentSchema>;

// Fallback used when a test case has never been AI-assessed but a
// recommendation run still needs to rank it -- derives a rough score from
// the human-set authoring priority so ranking degrades gracefully instead
// of treating unassessed cases as zero-risk.
const PRIORITY_FALLBACK_SCORE: Record<string, number> = {
  CRITICAL: 90,
  HIGH: 70,
  MEDIUM: 50,
  LOW: 30,
};

export function fallbackRiskScoreFromPriority(priority: string): number {
  return PRIORITY_FALLBACK_SCORE[priority] ?? 50;
}
