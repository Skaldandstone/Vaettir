import { z } from "zod";

// Deliberately qualitative human categories, not a validated risk score/matrix.
export const qualityLikelihood = z.enum(["UNKNOWN", "RARE", "POSSIBLE", "FREQUENT"]);
export const qualityConsequence = z.enum(["UNKNOWN", "MINOR", "SIGNIFICANT", "SEVERE"]);
const ids = z.array(z.string().min(1).max(120)).max(20).refine(values => new Set(values).size === values.length, "Use each linked record once");
export const qualityRiskDefinition = z.object({
  title: z.string().trim().min(1).max(160), component: z.string().trim().min(1).max(160),
  failureMode: z.string().trim().min(1).max(1000), cause: z.string().trim().min(1).max(1500),
  effect: z.string().trim().min(1).max(1500), likelihood: qualityLikelihood,
  consequence: qualityConsequence, rationale: z.string().trim().min(1).max(2000),
  mitigation: z.string().trim().max(2000), requirementIds: ids, caseIds: ids,
}).strict().refine(value => new TextEncoder().encode(JSON.stringify(value, null, 1)).length <= 18000,
  "Keep this bounded risk definition within 18,000 UTF-8 bytes");
export const qualityResidualDecision = z.object({
  likelihood: qualityLikelihood, consequence: qualityConsequence,
  rationale: z.string().trim().min(1).max(2000), evidenceNotes: z.string().trim().max(2000),
  disposition: z.enum(["FURTHER_ACTION", "REVIEW_RECORDED", "HUMAN_ACCEPTANCE_RECORDED"]),
  resultIds: ids, acknowledgeNotQualifiedApproval: z.literal(true),
}).strict().refine(value => new TextEncoder().encode(JSON.stringify(value, null, 1)).length <= 9000,
  "Keep this bounded decision within 9,000 UTF-8 bytes");
export const qualityRiskEvidence = z.array(z.object({ resultId: z.string().min(1).max(120),
  caseId: z.string().min(1).max(120), runId: z.string().min(1).max(120), caseDisplayId: z.string().max(160),
  status: z.enum(["PASS", "FAIL", "SKIP", "FLAKY", "BLOCKED"]),
  observedAt: z.string().datetime(), runStartedAt: z.string().datetime(),
}).strict()).max(20);
const projectId = z.string().min(1).max(120), requestId = z.string().uuid();
// Legacy omission is intentional: no default/key is added to prior write hashes.
// New requests bind the originally reviewed tenant and authenticated actor.
const expectedScope = z.object({ organizationId: z.string().min(1).max(120), clerkActorId: z.string().min(1).max(200) }).strict().optional();
export const qualityRiskWriteInput = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("CREATE"), projectId, requestId, expectedScope, definition: qualityRiskDefinition }).strict(),
  z.object({ operation: z.literal("UPDATE"), projectId, requestId, expectedScope, id: z.string().min(1).max(120),
    expectedVersion: z.number().int().min(1).max(999999), dropUnavailableLinks: z.boolean(),
    definition: qualityRiskDefinition }).strict(),
  z.object({ operation: z.literal("REVIEW"), projectId, requestId, expectedScope, id: z.string().min(1).max(120),
    expectedVersion: z.number().int().min(1).max(999999), decision: qualityResidualDecision }).strict(),
]);
export type QualityRiskDefinition = z.infer<typeof qualityRiskDefinition>;
export type QualityRiskWriteInput = z.infer<typeof qualityRiskWriteInput>;
export const qualityRiskReceipt = z.object({ requestId, operation: z.enum(["CREATE", "UPDATE", "REVIEW"]),
  entry: z.object({ id: z.string(), displayId: z.string(), version: z.number().int().min(1) }).strict(),
  decisionId: z.string().nullable(),
}).strict();
export const qualityRiskLookupInput = z.object({ projectId, kind: z.enum(["CASE", "REQUIREMENT", "RESULT"]),
  search: z.string().trim().max(80) }).strict();
