import { z } from "zod";

export const forgeReleaseLink = z
  .object({
    jiraVersionId: z.string().regex(/^\d{1,40}$/),
    releaseId: z.string().min(1).max(120),
    runIds: z
      .array(z.string().min(1).max(120))
      .max(200)
      .refine((ids) => new Set(ids).size === ids.length),
  })
  .strict();
export const jiraVersionMetadata = z.object({
  id: z.string().regex(/^\d{1,40}$/),
  projectId: z.number().int().positive(),
  name: z.string().max(1000),
  released: z.boolean(),
  archived: z.boolean(),
  releaseDate: z.string().max(40).optional(),
});
export const releaseEvidenceSummary = z.object({
  protocol: z.literal("vaettir-release-quality/v1"),
  mode: z.enum(["LIVE", "FROZEN", "RELEASED_CAPTURE_UNAVAILABLE"]),
  releaseId: z.string(),
  releaseName: z.string(),
  projectId: z.string(),
  jiraVersionId: z.string(),
  jiraVersionName: z.string(),
  capturedAt: z.string().datetime(),
  closureId: z.string().length(64).optional(),
  counts: z.object({
    planned: z.number().int().nonnegative(),
    recorded: z.number().int().nonnegative(),
    pass: z.number().int().nonnegative(),
    fail: z.number().int().nonnegative(),
    blocked: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    flaky: z.number().int().nonnegative(),
    mixed: z.number().int().nonnegative(),
    ambiguous: z.number().int().nonnegative(),
    notRecorded: z.number().int().nonnegative(),
  }),
  tests: z
    .array(
      z.object({
        id: z.string(),
        displayId: z.string(),
        title: z.string(),
        priority: z.string(),
        reviewStatus: z.string(),
        outcome: z.string(),
        href: z.string().url(),
        runIds: z.array(z.string()),
      }),
    )
    .max(20000),
  runs: z
    .array(
      z.object({
        id: z.string(),
        status: z.string(),
        startedAt: z.string().datetime(),
        finishedAt: z.string().datetime().nullable(),
        commitSha: z.string(),
        branch: z.string(),
        href: z.string().url(),
      }),
    )
    .max(200),
  risks: z
    .array(
      z.object({ severity: z.string(), count: z.number().int().nonnegative() }),
    )
    .max(20),
  unmatchedObservations: z.number().int().nonnegative(),
  outsideCohortObservations: z.number().int().nonnegative(),
  recordedFailures: z.number().int().nonnegative(),
  failedRuns: z.number().int().nonnegative(),
  notice: z.string(),
});
export type ReleaseEvidenceSummary = z.infer<typeof releaseEvidenceSummary>;
