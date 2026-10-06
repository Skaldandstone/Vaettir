import { z } from "zod";
import { supportedManualExecutionIdentity } from "./manualExecutionReadScopeSchema.js";
const id = z.string().min(1).max(200).refine(supportedManualExecutionIdentity);
// Browser-safe DTO schema: do not import native authorization/Prisma modules.
const readScope = z
  .object({
    projectId: id,
    organizationId: id,
    actorId: id,
    actorClerkUserId: id,
  })
  .strict();
const utc = z
  .string()
  .max(32)
  .datetime()
  .refine((value) => {
    const stamp = Date.parse(value);
    return (
      Number.isFinite(stamp) &&
      new Date(stamp).getUTCFullYear() >= 1 &&
      new Date(stamp).getUTCFullYear() <= 9999 &&
      new Date(stamp).toISOString() === value
    );
  }, "Use an exact millisecond UTC timestamp.");
const base = z
  .object({
    projectId: id,
    originalOrganizationId: id,
    expectedClerkActorId: id,
    expectedNativeActorId: id.optional(),
    requestId: z.string().uuid(),
  })
  .strict();
export const runHistoryAccessInput = base;
export const runHistoryCursor = z.object({ startedAt: utc, id }).strict();
export const runHistoryPageInput = base
  .extend({
    expectedNativeActorId: id,
    limit: z.number().int().min(1).max(21),
    asOf: utc,
    before: runHistoryCursor.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (Date.parse(value.asOf) > Date.now())
      ctx.addIssue({
        code: "custom",
        message: "A future history anchor is unavailable.",
      });
    if (value.before && value.before.startedAt > value.asOf)
      ctx.addIssue({
        code: "custom",
        message: "The cursor is outside the applied run-start anchor.",
      });
  });
const count = z.number().int().min(0).max(100000);
export const runHistoryProgress = z
  .object({
    total: count,
    recorded: count,
    remaining: count,
    percentComplete: z.number().min(0).max(100),
    pass: count,
    fail: count,
    blocked: count,
    skip: count,
    flaky: count,
    other: count,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.recorded !==
        value.pass +
          value.fail +
          value.blocked +
          value.skip +
          value.flaky +
          value.other ||
      value.total !== value.recorded + value.remaining ||
      value.percentComplete !==
        (value.total
          ? Math.min(100, Math.round((value.recorded / value.total) * 100))
          : 0)
    )
      ctx.addIssue({
        code: "custom",
        message: "Progress does not reconcile its complete admitted scope.",
      });
  });
export const runHistoryRow = z
  .object({
    id,
    ciProvider: z.string().max(256),
    ciRunUrl: z.string().max(4096).nullable(),
    commitSha: z.string().max(1024),
    branch: z.string().max(1024),
    status: z.string().max(200),
    startedAt: utc,
    finishedAt: utc.nullable(),
    resultCount: count,
    startedByEmail: z.string().max(320).nullable(),
    progress: runHistoryProgress.nullable(),
    progressUnavailableReason: z.string().max(1000).nullable(),
    progressBasis: z.enum([
      "PLANNED_IDENTITIES_CURRENT_RESULTS",
      "CI_INGESTED_RESULTS",
    ]),
  })
  .strict()
  .superRefine((row, ctx) => {
    if ((row.progress === null) !== (row.progressUnavailableReason !== null))
      ctx.addIssue({
        code: "custom",
        message:
          "Unavailable progress must have an explicit reason, not a fabricated zero.",
      });
    if (
      (row.ciProvider === "manual") !==
        (row.progressBasis === "PLANNED_IDENTITIES_CURRENT_RESULTS") ||
      (row.progress &&
        (row.ciProvider === "manual"
          ? row.progress.total > 1000 || row.progress.recorded > row.resultCount
          : row.progress.total !== row.resultCount))
    )
      ctx.addIssue({
        code: "custom",
        message: "Progress basis does not match its native source/denominator.",
      });
  });
const readContext = z
  .object({
    requestId: z.string().uuid(),
    requestedKey: z.string().max(5600),
    projection: z.enum(["ACCESS", "PAGE"]),
    scope: readScope,
    asOf: utc,
  })
  .strict();
export const runHistoryAccessOutput = z
  .object({
    readContext: readContext.extend({ projection: z.literal("ACCESS") }),
  })
  .strict();
export const runHistoryPageOutput = z
  .object({
    readContext: readContext.extend({ projection: z.literal("PAGE") }),
    rows: z.array(runHistoryRow).max(21),
    hasMore: z.boolean(),
    nextBefore: runHistoryCursor.nullable(),
    limit: z.number().int().min(1).max(21),
    limitations: z.array(z.string().max(2000)).max(10),
  })
  .strict()
  .superRefine((page, ctx) => {
    const last = page.rows.at(-1);
    if (
      page.rows.length > page.limit ||
      new Set(page.rows.map((row) => row.id)).size !== page.rows.length ||
      page.rows.some((row) => row.startedAt > page.readContext.asOf) ||
      (page.hasMore &&
        (page.rows.length !== page.limit ||
          !last ||
          !page.nextBefore ||
          page.nextBefore.id !== last.id ||
          page.nextBefore.startedAt !== last.startedAt)) ||
      (!page.hasMore && page.nextBefore !== null)
    )
      ctx.addIssue({
        code: "custom",
        message:
          "The complete current page, anchor or lookahead cursor is inconsistent.",
      });
  });
export type RunHistoryPage = z.infer<typeof runHistoryPageInput>;
export function runHistoryReadKey(
  input: z.infer<typeof runHistoryAccessInput> | RunHistoryPage,
) {
  return JSON.stringify({
    projectId: input.projectId,
    originalOrganizationId: input.originalOrganizationId,
    expectedClerkActorId: input.expectedClerkActorId,
    ...(input.expectedNativeActorId === undefined
      ? {}
      : { expectedNativeActorId: input.expectedNativeActorId }),
    requestId: input.requestId,
    ...("limit" in input
      ? {
          limit: input.limit,
          asOf: input.asOf,
          ...(input.before === undefined
            ? {}
            : {
                before: {
                  startedAt: input.before.startedAt,
                  id: input.before.id,
                },
              }),
        }
      : {}),
  });
}
