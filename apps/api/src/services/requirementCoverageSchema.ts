import { z } from "zod";
import { reportDateIntervalSchema } from "./reportDateIntervalSchema.js";

// Pure browser/server input contract. No SQL, provider or database runtime.
const id = z.string().min(1).max(200);
export const requirementCoverageScope = z.object({
  planId: id.optional(), runId: id.optional(), platform: z.string().trim().min(1).max(300).optional(),
  environment: z.string().trim().min(1).max(2000).optional(), build: z.string().trim().min(1).max(300).optional(),
}).strict().refine(value => Object.keys(value).length > 0, "Choose at least one exact recorded scope");
export const requirementCoverageInput = z.object({
  projectId: id, originalOrganizationId: id.optional(), asOf: z.string().datetime({ offset: true }),
  expectedClerkActorId: z.string().min(1).max(200).optional(),
  interval: reportDateIntervalSchema.optional(), scope: requirementCoverageScope.optional(),
}).strict();
export const requirementCoverageListInput = requirementCoverageInput.extend({
  offset: z.number().int().min(0).max(9980).multipleOf(20).default(0), search: z.string().trim().max(80).default(""),
});
export const requirementCoverageCasesInput = requirementCoverageInput.extend({
  requirementId: id, offset: z.number().int().min(0).max(980).multipleOf(20).default(0),
});
export const requirementCoverageEvidenceInput = requirementCoverageInput.extend({
  requirementId: id, caseId: id, resultOffset: z.number().int().min(0).max(9980).multipleOf(20).default(0),
  defectOffset: z.number().int().min(0).max(90).multipleOf(10).default(0),
});
export type RequirementCoverageInput = z.infer<typeof requirementCoverageInput>;
export type RequirementCoverageListInput = z.infer<typeof requirementCoverageListInput>;
export type RequirementCoverageCasesInput = z.infer<typeof requirementCoverageCasesInput>;
export type RequirementCoverageEvidenceInput = z.infer<typeof requirementCoverageEvidenceInput>;
/** Stable request identity independent of JSON property insertion order. */
export function requirementCoverageRequestKey(value: unknown): string {
  const canonical = (entry: unknown): unknown => Array.isArray(entry) ? entry.map(canonical)
    : entry && typeof entry === "object" ? Object.fromEntries(Object.entries(entry).filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : entry;
  return JSON.stringify(canonical(value));
}
export const requirementCoverageLimitations = [
  "Current native requirements, case identities and explicit relationships, joined to currently recorded results. Not a frozen snapshot or reconstruction of historical requirement coverage.",
  "Only direct native requirement links count. Acceptance-criterion plans and issue keyword matches are not inferred as direct coverage.",
  "Execution filters use inclusive run-start UTC bounds and exact recorded plan, platform, environment or build metadata. Results have no recorded result timestamp in this model.",
  "PASS is a recorded case outcome, not proof of requirement fulfilment, verified mitigation, release readiness or regulatory acceptance. FLAKY, SKIP and BLOCKED remain separate.",
  "Current defect relationships are not filtered by execution date/configuration: there is no case-result-to-cluster evidence binding. Task closure and passing cases never declare a defect resolved.",
  "Each response is a fresh transaction. Paging holds temporal filters stable, not inventory or outcome revisions; refresh if records change while browsing.",
];
