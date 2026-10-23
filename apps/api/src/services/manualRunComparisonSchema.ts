import { z } from "zod";
import { reportDateIntervalSchema } from "./reportDateIntervalSchema.js";
import { supportedManualExecutionIdentity } from "./manualExecutionReadScopeSchema.js";
const identity = z.string().min(1).max(200).refine(supportedManualExecutionIdentity);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const scope = z.object({ projectId: identity, originalOrganizationId: identity, expectedClerkActorId: identity, requestId: z.string().uuid() }).strict();
const runCursor = z.object({ id: identity, startedAt: z.string().datetime() }).strict();
export const manualRunCatalogInputSchema = scope.extend({
  interval: reportDateIntervalSchema,
  cursor: runCursor.optional(),
}).strict().superRefine((input, ctx) => {
  if (Date.parse(input.interval.end) - Date.parse(input.interval.start) >= 90 * 86400000)
    ctx.addIssue({ code: "custom", message: "Choose at most 90 inclusive UTC run-start days." });
  if (input.interval.end > new Date().toISOString().slice(0, 10))
    ctx.addIssue({ code: "custom", message: "Future UTC run-start dates cannot be selected." });
});
export const manualRunComparisonInputSchema = scope.extend({
  baselineRunId: identity,
  candidateRunId: identity,
  expectedPairHash: hash.optional(),
  cursor: z.object({ caseId: identity, expectedPairHash: hash }).strict().optional(),
}).strict().refine(input => input.baselineRunId !== input.candidateRunId, "Choose two different manual runs.");
const runMetadata = z.object({
  id: identity, status: z.enum(["RUNNING", "PASSED", "FAILED", "PARTIAL"]),
  startedAt: z.string().datetime(), finishedAt: z.string().datetime().nullable(),
  plannedCases: z.number().int().min(0).max(1000).nullable(), scopeUnsupported: z.boolean(), versionOneSnapshotPresent: z.boolean(),
}).strict();
const responseScope = z.object({ projectId: identity, organizationId: identity, clerkActorId: identity, requestId: z.string().uuid(), requestKey: z.string().max(10000) }).strict();
export const manualRunCatalogOutputSchema = responseScope.extend({
  items: z.array(runMetadata).max(20), nextCursor: runCursor.nullable(), limitations: z.array(z.string()).max(12),
}).strict();
const counts = z.object({ pass: z.number().int().nonnegative(), fail: z.number().int().nonnegative(), blocked: z.number().int().nonnegative(), skip: z.number().int().nonnegative(), flaky: z.number().int().nonnegative(), total: z.number().int().min(0).max(1000), recorded: z.number().int().min(0).max(1000), remaining: z.number().int().min(0).max(1000), percentComplete: z.number().min(0).max(100), ignoredOutsideScopeResults: z.number().int().nonnegative() }).strict();
const savedCaseSide = z.object({
  title: z.string().max(1000), titleClipped: z.boolean(), definitionHash: hash,
  outcome: z.enum(["PASS", "FAIL", "BLOCKED", "SKIP", "FLAKY", "NO_CASE_VERDICT"]),
}).strict();
export const manualRunComparisonOutputSchema = responseScope.extend({
  pairHash: hash,
  baseline: runMetadata, candidate: runMetadata,
  baselineSummary: counts, candidateSummary: counts,
  configuration: z.object({ baselineHash: hash, candidateHash: hash, sameRecordedConfiguration: z.boolean() }).strict(),
  unionCaseCount: z.number().int().min(0).max(2000),
  items: z.array(z.object({ caseId: identity, currentCaseIdLabel: identity.nullable(), baseline: savedCaseSide.nullable(), candidate: savedCaseSide.nullable(), definitionState: z.enum(["SAME_SAVED_DEFINITION", "SAVED_DEFINITION_CHANGED", "BASELINE_ONLY", "CANDIDATE_ONLY"]) }).strict()).max(50),
  nextCursor: z.object({ caseId: identity, expectedPairHash: hash }).strict().nullable(),
  limitations: z.array(z.string()).max(12),
}).strict();
export type ManualRunCatalogInput = z.infer<typeof manualRunCatalogInputSchema>;
export type ManualRunComparisonInput = z.infer<typeof manualRunComparisonInputSchema>;
export type ManualRunComparison = z.infer<typeof manualRunComparisonOutputSchema>;
/** Pure request echo; not a permission token or historic tenant/session proof. */
export function manualRunComparisonRequestKey(input: ManualRunCatalogInput | ManualRunComparisonInput): string {
  return JSON.stringify({ projectId: input.projectId, originalOrganizationId: input.originalOrganizationId, expectedClerkActorId: input.expectedClerkActorId, requestId: input.requestId,
    ...("interval" in input ? { interval: input.interval, ...(input.cursor ? { cursor: input.cursor } : {}) } : { baselineRunId: input.baselineRunId, candidateRunId: input.candidateRunId, ...(input.expectedPairHash ? { expectedPairHash: input.expectedPairHash } : {}), ...(input.cursor ? { cursor: input.cursor } : {}) }),
  });
}
