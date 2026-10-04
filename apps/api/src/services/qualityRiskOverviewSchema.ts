import { z } from "zod";
import { qualityLikelihood, qualityConsequence, qualityRiskEvidence } from "./qualityRiskSchema.js";

export const riskOverviewReview = z.enum(["ANY", "NO_REVIEW", "VERSION_MATCHING_REVIEW", "BASELINE_CHANGED"]);
export const riskOverviewDisposition = z.enum(["ANY", "NOT_RECORDED", "FURTHER_ACTION", "REVIEW_RECORDED", "HUMAN_ACCEPTANCE_RECORDED"]);
export const riskOverviewEvidence = z.enum(["ANY", "NO_REVIEW", "NONE_RECORDED", "ALL_REFERENCES_AVAILABLE", "SOME_REFERENCES_UNAVAILABLE", "ALL_REFERENCES_UNAVAILABLE"]);
export const riskOverviewMitigation = z.enum(["ANY", "NO_LINKS", "ALL_REFERENCES_AVAILABLE", "SOME_REFERENCES_UNAVAILABLE", "ALL_REFERENCES_UNAVAILABLE"]);
export const qualityRiskOverviewInput = z.object({
  projectId: z.string().min(1).max(120), originalOrganizationId: z.string().min(1).max(120).optional(),
  expectedClerkActorId: z.string().min(1).max(200).optional(),
  offset: z.number().int().min(0).max(980).multipleOf(20).default(0), search: z.string().trim().max(80).default(""),
  likelihood: qualityLikelihood.optional(), consequence: qualityConsequence.optional(),
  review: riskOverviewReview.default("ANY"), disposition: riskOverviewDisposition.default("ANY"),
  evidence: riskOverviewEvidence.default("ANY"), mitigation: riskOverviewMitigation.default("ANY"),
}).strict();
export const qualityRiskOverviewDetailInput = qualityRiskOverviewInput.pick({ projectId: true, originalOrganizationId: true, expectedClerkActorId: true })
  .extend({ id: z.string().min(1).max(120) }).strict();
export type QualityRiskOverviewInput = z.infer<typeof qualityRiskOverviewInput>;
export type QualityRiskOverviewDetailInput = z.infer<typeof qualityRiskOverviewDetailInput>;
const nativeIds = z.array(z.string().min(1).max(120)).max(20).refine(values => new Set(values).size === values.length);
export const riskOverviewProjection = z.object({
  id: z.string().min(1).max(120), number: z.number().int().min(1).max(1000), displayId: z.string().min(1).max(160),
  version: z.number().int().min(1).max(1000000), title: z.string().min(1).max(160),
  component: z.string().min(1).max(160), likelihood: qualityLikelihood, consequence: qualityConsequence,
  caseIds: nativeIds, requirementIds: nativeIds,
  latest: z.object({ id: z.string().min(1).max(120), createdVersion: z.number().int().min(2), assessedVersion: z.number().int().min(1),
    createdAt: z.string().datetime(), likelihood: qualityLikelihood, consequence: qualityConsequence,
    disposition: riskOverviewDisposition.exclude(["ANY", "NOT_RECORDED"]), resultIds: nativeIds,
    evidence: qualityRiskEvidence,
  }).strict().nullable(),
}).strict().superRefine((value, context) => {
  const latest = value.latest; if (!latest) return;
  if (latest.createdVersion !== latest.assessedVersion + 1 || latest.createdVersion > value.version)
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Recorded review versions are inconsistent" });
  const evidenceIds = latest.evidence.map(row => row.resultId);
  if (new Set(evidenceIds).size !== evidenceIds.length || evidenceIds.length !== latest.resultIds.length ||
    evidenceIds.some(id => !latest.resultIds.includes(id))) context.addIssue({ code: z.ZodIssueCode.custom, message: "Recorded evidence scope is inconsistent" });
});
export type RiskOverviewProjection = z.infer<typeof riskOverviewProjection>;
export function qualityRiskOverviewRequestKey(input: unknown): string {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonical(item)])) : value;
  return JSON.stringify(canonical(input));
}
export const qualityRiskOverviewLimits = [
  "Current human qualitative categories and latest ordinary recorded decisions only. No calibrated score, risk reduction, verified mitigation, safety qualification or regulatory acceptance is calculated.",
  "Version matching checks the risk entry version only. Later case procedures, requirements and result statuses are not automatically invalidated or reverified.",
  "Evidence availability checks current same-project result/case/run identities. Captured statuses and dates remain historical observations; available references do not prove effectiveness.",
  "Intended case/requirement links are current inventory references, not proven fulfillment. Missing references stay in their declared counts and lose native links.",
  "Population and counts are live for each response, not frozen snapshots. Latest-review counts omit earlier decisions; evidence references can repeat across different risks.",
  "At most 1,000 project entries, 8 MiB projected population metadata, twenty entries per drilldown page and twenty evidence/intended links per recorded category. Unsupported or overbound data refuses the overview rather than silently dropping records.",
];
