import { z } from "zod";
import { reportDateIntervalSchema } from "./reportDateIntervalSchema.js";
import { caseHistoryRunFiltersShape, caseHistoryRunFiltersKeyFields } from "./caseHistoryRunFiltersSchema.js";

const id = z.string().min(1).max(200);
const literal = (max: number) => z.string().min(1).max(max).refine(value => value.trim().length > 0);
export const caseHistoryFiltersSchema = z.object({
  ...caseHistoryRunFiltersShape,
  interval: reportDateIntervalSchema.optional(),
  platform: literal(300).optional(),
  build: literal(300).optional(),
  environment: literal(2000).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.interval && Date.parse(value.interval.end) - Date.parse(value.interval.start) >= 90 * 86400000)
    ctx.addIssue({ code: "custom", message: "Choose at most 90 inclusive UTC days." });
  if (value.interval && value.interval.end > new Date().toISOString().slice(0, 10))
    ctx.addIssue({ code: "custom", message: "Future UTC dates cannot be selected." });
});
export const caseExecutionHistoryInputSchema = z.object({
  projectId: id,
  testCaseId: id,
  originalOrganizationId: id.optional(),
  expectedClerkActorId: id.optional(),
  limit: z.number().int().min(1).max(25).default(10),
  before: z.object({ runId: id, filterKey: z.string().max(32768).optional() }).strict().optional(),
  filters: caseHistoryFiltersSchema.optional(),
}).strict();
export type CaseExecutionHistoryInput = z.infer<typeof caseExecutionHistoryInputSchema>;
/** Browser-pure identity; optional omitted legacy filters have no invented values. */
export function caseHistoryFilterKey(input: CaseExecutionHistoryInput) {
  return JSON.stringify({ projectId: input.projectId, testCaseId: input.testCaseId,
    ...(input.originalOrganizationId === undefined ? {} : { originalOrganizationId: input.originalOrganizationId }),
    ...(input.expectedClerkActorId === undefined ? {} : { expectedClerkActorId: input.expectedClerkActorId }),
    ...(input.filters === undefined ? {} : { filters: {
      ...caseHistoryRunFiltersKeyFields(input.filters),
      ...(input.filters.interval === undefined ? {} : { interval: { start: input.filters.interval.start, end: input.filters.interval.end } }),
      ...(input.filters.platform === undefined ? {} : { platform: input.filters.platform }),
      ...(input.filters.build === undefined ? {} : { build: input.filters.build }),
      ...(input.filters.environment === undefined ? {} : { environment: input.filters.environment }),
    } }),
  });
}
export const caseHistoryRequestKey = (input: CaseExecutionHistoryInput) => JSON.stringify({
  filter: caseHistoryFilterKey(input), limit: input.limit,
  ...(input.before === undefined ? {} : { before: input.before }),
});
export const caseHistoryMetadataSchema = z.object({
  version: z.literal(1), profileHash: z.string().regex(/^[a-f0-9]{64}$/),
  caseCount: z.number().int().min(1).max(500), matchedCount: z.literal(1), metadataValid: z.literal(true),
  title: z.string().max(10000), stepCount: z.number().int().min(0).max(500),
  platform: z.string().max(300), build: z.string().max(300), environment: z.string().max(2000),
});
export const caseHistoryScopeLimits = [
  "Recorded source matches the stored provider: literal manual versus other imported providers. This does not verify original automation or provider delivery. Overall run status is not this case's outcome; in-progress and partial runs may contain recorded passing or failing cases.",
  "One entry per native run. Repeated result rows and step corrections are not inferred independent attempts, regressions or flaky-test detections.",
  "Dates filter stored run-start timestamps using inclusive UTC days. Imported dates may not be original execution dates; outcomes are current stored observations, not an as-of reconstruction.",
  "Configuration filters match complete supported selected-case manual snapshots exactly, including whitespace and case. Missing/unsupported metadata and CI imports are excluded; CI commits are not invented build or platform values.",
  "Configuration filtering supports at most 20,000 linked/planned candidate runs and 4 MiB of bounded metadata; larger populations refuse rather than silently truncate. Refine the date interval.",
  "Current original-organization and actor binding is an access boundary, not proof of historical tenancy or release qualification.",
];
