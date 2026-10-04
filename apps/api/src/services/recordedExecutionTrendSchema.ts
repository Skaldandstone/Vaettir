import { z } from "zod";
import { reportDateIntervalSchema } from "./reportDateIntervalSchema.js";

const id = z.string().min(1).max(200);
const base = z
  .object({
    projectId: id,
    originalOrganizationId: id,
    start: z.string().max(10),
    end: z.string().max(10),
    platform: z
      .string()
      .min(1)
      .max(300)
      .refine((value) => value.trim().length > 0)
      .optional(),
    environment: z
      .string()
      .min(1)
      .max(2000)
      .refine((value) => value.trim().length > 0)
      .optional(),
    build: z
      .string()
      .min(1)
      .max(300)
      .refine((value) => value.trim().length > 0)
      .optional(),
  })
  .strict();
function validateWindow(
  value: { start: string; end: string },
  ctx: z.RefinementCtx,
) {
  const calendar = reportDateIntervalSchema.safeParse({
    start: value.start,
    end: value.end,
  });
  if (!calendar.success) {
    for (const issue of calendar.error.issues) ctx.addIssue(issue);
    return;
  }
  if (Date.parse(value.end) - Date.parse(value.start) >= 90 * 86400000)
    ctx.addIssue({
      code: "custom",
      message: "Select at most 90 inclusive UTC days.",
    });
  if (value.end > new Date().toISOString().slice(0, 10))
    ctx.addIssue({
      code: "custom",
      message: "Future UTC days cannot be selected.",
    });
}
export const recordedExecutionTrendInput = base.superRefine(validateWindow);
export type RecordedExecutionTrendInput = z.infer<
  typeof recordedExecutionTrendInput
>;
/** Browser-pure canonical original-org scope key. No credential or stored approval. */
export const recordedExecutionTrendKey = (input: RecordedExecutionTrendInput) =>
  JSON.stringify({
    projectId: input.projectId,
    originalOrganizationId: input.originalOrganizationId,
    start: input.start,
    end: input.end,
    ...(input.platform === undefined ? {} : { platform: input.platform }),
    ...(input.environment === undefined
      ? {}
      : { environment: input.environment }),
    ...(input.build === undefined ? {} : { build: input.build }),
  });
export const recordedExecutionTrendRunsInput = base
  .extend({ day: z.string().max(10), page: z.number().int().min(0).max(999) })
  .strict()
  .superRefine((value, ctx) => {
    validateWindow(value, ctx);
    const calendar = reportDateIntervalSchema.safeParse({
      start: value.day,
      end: value.day,
    });
    if (!calendar.success || value.day < value.start || value.day > value.end)
      ctx.addIssue({
        code: "custom",
        message: "Choose a UTC day within the applied trend interval.",
      });
  });
const count = z.number().int().min(0).max(100000);
const outcomes = z
  .object({
    PASS: count,
    FAIL: count,
    FLAKY: count,
    SKIP: count,
    BLOCKED: count,
  })
  .strict();
const totals = z
  .object({
    runs: count,
    results: count,
    mapped: count,
    unmatched: count,
    unavailableMapping: count,
    inProgressRuns: count,
    finishedRecordedRuns: count,
    completionUnavailableRuns: count,
    inProgressResults: count,
    timedResults: count,
    missingDurations: count,
    invalidDurations: count,
    sumDurationMs: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    outcomes,
  })
  .strict();
const scope = z
  .object({
    start: z.string(),
    end: z.string(),
    platform: z.string().optional(),
    environment: z.string().optional(),
    build: z.string().optional(),
  })
  .strict();
const echo = z
  .object({
    projectId: id,
    organizationId: id,
    clerkActorId: id,
    requestKey: z.string().max(12000),
    asOf: z.string().datetime(),
    windowStart: z.string().datetime(),
    windowEnd: z.string().datetime(),
    scope,
    limitations: z.array(z.string()).max(12),
  })
  .strict();
export const recordedExecutionTrendOutput = echo
  .extend({
    totals,
    days: z.array(totals.extend({ day: z.string() }).strict()).max(90),
  })
  .strict();
export type RecordedExecutionTrend = z.infer<
  typeof recordedExecutionTrendOutput
>;
export const recordedExecutionTrendRunsOutput = echo
  .extend({
    day: z.string(),
    page: z.number().int().min(0).max(999),
    total: count,
    hasMore: z.boolean(),
    runs: z
      .array(
        z
          .object({
            id,
            startedAt: z.string().datetime(),
            finishedAt: z.string().datetime().nullable(),
            status: z.enum(["RUNNING", "PASSED", "FAILED", "PARTIAL"]),
            provider: z.string().max(80),
            providerExcerpt: z.boolean(),
            build: z.string().max(160).nullable(),
            buildExcerpt: z.boolean(),
            platform: z.string().max(160).nullable(),
            platformExcerpt: z.boolean(),
            environment: z.string().max(160).nullable(),
            environmentExcerpt: z.boolean(),
          })
          .strict(),
      )
      .max(20),
  })
  .strict();
