import { z } from "zod";
const id = z.string().min(1).max(200),
  hash = z.string().regex(/^[a-f0-9]{64}$/);
export const recordedResultStatuses = [
  "PASS",
  "FAIL",
  "SKIP",
  "FLAKY",
  "BLOCKED",
] as const;
export const recordedStatusCounts = z
  .object({
    PASS: z.number().int().nonnegative(),
    FAIL: z.number().int().nonnegative(),
    SKIP: z.number().int().nonnegative(),
    FLAKY: z.number().int().nonnegative(),
    BLOCKED: z.number().int().nonnegative(),
  })
  .strict();
export const recordedRunMetadata = z
  .object({
    id,
    provider: z.string().max(80),
    providerClipped: z.boolean(),
    commit: z.string().max(160),
    commitClipped: z.boolean(),
    branch: z.string().max(160),
    branchClipped: z.boolean(),
    startedAt: z.string().datetime(),
    finishedAt: z.string().datetime().nullable(),
    status: z.enum(["RUNNING", "PASSED", "FAILED", "PARTIAL"]),
  })
  .strict();
const runCursor = z
  .object({ runId: id, startedAt: z.string().datetime() })
  .strict();
export const recordedRunListInput = z
  .object({
    projectId: id,
    originalOrganizationId: id.optional(),
    expectedClerkActorId: id.optional(),
    requestId: z.string().uuid(),
    cursor: runCursor.optional(),
  })
  .strict();
export const recordedRunListOutput = z
  .object({
    projectId: id,
    organizationId: id,
    clerkActorId: id,
    requestId: z.string().uuid(),
    items: z.array(recordedRunMetadata).max(20),
    nextCursor: runCursor.nullable(),
    limitations: z.array(z.string()).max(8),
  })
  .strict();
export const recordedRunComparisonInput = z
  .object({
    projectId: id,
    originalOrganizationId: id.optional(),
    expectedClerkActorId: id.optional(),
    baselineRunId: id,
    candidateRunId: id,
    requestId: z.string().uuid(),
    expectedPairHash: hash.optional(),
    cursor: z
      .object({ caseId: id, expectedPairHash: hash })
      .strict()
      .optional(),
  })
  .strict();
export const recordedResultSummary = z
  .object({
    resultCount: z.number().int().nonnegative(),
    counts: recordedStatusCounts,
    timedResults: z.number().int().nonnegative(),
    missingDurations: z.number().int().nonnegative(),
    invalidDurations: z.number().int().nonnegative(),
    minDurationMs: z.number().nonnegative().nullable(),
    maxDurationMs: z.number().nonnegative().nullable(),
    meanDurationMs: z.number().nonnegative().nullable(),
  })
  .strict();
const runSummary = recordedResultSummary.extend({
  mappedResults: recordedStatusCounts,
  unmatchedResults: recordedStatusCounts,
  unavailableLinks: recordedStatusCounts,
});
export const recordedRunComparisonOutput = z
  .object({
    projectId: id,
    organizationId: id,
    clerkActorId: id,
    requestId: z.string().uuid(),
    pairHash: hash,
    baseline: recordedRunMetadata,
    candidate: recordedRunMetadata,
    baselineSummary: runSummary,
    candidateSummary: runSummary,
    mappedCaseCount: z.number().int().nonnegative(),
    comparableConfiguration: z.literal(false),
    comparisonScope: z.literal("RECORDED_COUNTS_ONLY"),
    items: z
      .array(
        z
          .object({
            caseId: id,
            displayId: z.string().max(200),
            title: z.string().max(1000),
            titleClipped: z.boolean(),
            archived: z.boolean(),
            baseline: recordedResultSummary,
            candidate: recordedResultSummary,
            difference: z.enum([
              "SAME_COUNTS",
              "COUNTS_CHANGED",
              "BASELINE_ONLY",
              "CANDIDATE_ONLY",
            ]),
          })
          .strict(),
      )
      .max(50),
    nextCursor: z
      .object({ caseId: id, expectedPairHash: hash })
      .strict()
      .nullable(),
    limitations: z.array(z.string()).max(12),
  })
  .strict();
