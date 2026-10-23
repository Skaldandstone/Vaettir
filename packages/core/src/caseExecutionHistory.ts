import { z } from "zod";
import { caseExecutionWholeCaseSummarySchema } from "./caseExecutionWholeCaseSummary.js";

export const caseOutcomeSchema = z.enum([
  "PASS",
  "FAIL",
  "BLOCKED",
  "SKIP",
  "FLAKY",
  "NOT_RECORDED",
  "MIXED",
]);
export const executionResultStatusSchema = z.enum([
  "PASS",
  "FAIL",
  "BLOCKED",
  "SKIP",
  "FLAKY",
]);
export const executionOutcomeCountSchema = z.object({
  status: executionResultStatusSchema,
  count: z.number().int().positive(),
});

/** One execution is one run, not one parameter result or observation correction. */
export function summarizeCaseOutcomes(
  counts: Array<z.infer<typeof executionOutcomeCountSchema>>,
) {
  const active = counts.filter((c) => c.count > 0);
  return active.length === 0
    ? ("NOT_RECORDED" as const)
    : active.length === 1
      ? active[0]!.status
      : ("MIXED" as const);
}

export const caseExecutionHistoryItemSchema = z.object({
  runId: z.string(),
  source: z.enum(["MANUAL", "CI_IMPORT"]),
  provider: z.string(),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime().nullable(),
  runStatus: z.enum(["RUNNING", "PASSED", "FAILED", "PARTIAL"]),
  planned: z.boolean(),
  outcome: caseOutcomeSchema,
  outcomeCounts: z.array(executionOutcomeCountSchema).max(5),
  outcomeMode: z.enum([
    "CASE_RESULT",
    "STEP_RESULTS",
    "PARTIAL_STEPS",
    "MULTIPLE_REPORTED_RESULTS",
    "PLANNED_ONLY",
    "NO_CASE_RESULT",
  ]),
  platform: z.string().nullable(),
  build: z.string().nullable(),
  environment: z.string().nullable(),
  reportedCommit: z.string().nullable(),
  starter: z
    .object({
      id: z.string(),
      label: z.string(),
      source: z.literal("CURRENT_PROFILE"),
    })
    .nullable(),
  definition: z.object({
    source: z.enum([
      "FROZEN_MANUAL_SUMMARY",
      "NOT_RECORDED",
      "UNSUPPORTED_METADATA",
    ]),
    originalCaseId: z.string(),
    titleAtRun: z.string().nullable(),
    stepCount: z.number().int().nonnegative().nullable(),
  }),
  steps: z.object({
    recordedCount: z.number().int().nonnegative(),
    correctionCount: z.number().int().nonnegative(),
    lastObservation: z
      .object({
        actorId: z.string(),
        recordedActorName: z.string(),
        recordedAt: z.string().datetime(),
      })
      .nullable(),
  }),
  artifactCount: z.number().int().nonnegative(),
  // Optional preserves older serialized pages; null is an explicit untracked summary.
  wholeCase: caseExecutionWholeCaseSummarySchema.nullable().optional(),
  limitations: z.array(z.string()),
});
export const caseExecutionHistoryPageSchema = z.object({
  testCase: z.object({
    id: z.string(),
    displayId: z.string(),
    title: z.string(),
    archived: z.boolean(),
  }),
  items: z.array(caseExecutionHistoryItemSchema).max(25),
  nextCursor: z.object({ runId: z.string(), filterKey: z.string().max(32768).optional() }).nullable(),
  // Additive current-access echoes; omitted legacy requests remain supported.
  projectId: z.string().max(200).optional(),
  organizationId: z.string().max(200).optional(),
  actorClerkUserId: z.string().max(200).optional(),
  requested: z.string().max(65536).optional(),
  observedAt: z.string().datetime().optional(),
  window: z.object({ start: z.string().datetime(), end: z.string().datetime() }).nullable().optional(),
  limits: z.array(z.string()).max(8).optional(),
});
export type CaseExecutionHistoryPage = z.infer<
  typeof caseExecutionHistoryPageSchema
>;
export type CaseExecutionHistoryItem = z.infer<
  typeof caseExecutionHistoryItemSchema
>;
