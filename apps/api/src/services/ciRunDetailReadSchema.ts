import { z } from "zod";
import { supportedManualExecutionIdentity } from "./manualExecutionReadScopeSchema.js";
const id = z.string().min(1).max(200).refine(supportedManualExecutionIdentity);
const utc = z
  .string()
  .max(32)
  .datetime()
  .refine((value) => {
    const date = new Date(value);
    return (
      Number.isFinite(date.getTime()) &&
      date.getUTCFullYear() >= 1 &&
      date.getUTCFullYear() <= 9999 &&
      date.toISOString() === value
    );
  }, "Use exact millisecond UTC time.");
const base = {
  projectId: id,
  testRunId: id,
  originalOrganizationId: id,
  expectedClerkActorId: id,
  requestId: z.string().uuid(),
};
export const ciRunDetailAccessInput = z
  .object({ ...base, expectedNativeActorId: id.optional() })
  .strict();
export const ciRunDetailPageInput = z
  .object({
    ...base,
    expectedNativeActorId: id,
    throughResultId: id.nullable(),
    afterId: id.optional(),
    limit: z.number().int().min(1).max(50),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (
      input.afterId &&
      (input.throughResultId === null ||
        ciRunDetailCompareId(input.afterId, input.throughResultId) > 0)
    )
      ctx.addIssue({
        code: "custom",
        message: "The next cursor must remain inside the admitted ID window.",
      });
  });
export type CiRunDetailAccessInput = z.infer<typeof ciRunDetailAccessInput>;
export type CiRunDetailPageInput = z.infer<typeof ciRunDetailPageInput>;
const scope = z
  .object({
    projectId: id,
    testRunId: id,
    organizationId: id,
    actorId: id,
    actorClerkUserId: id,
  })
  .strict();
const context = (projection: "ACCESS" | "PAGE") =>
  z
    .object({
      requestId: z.string().uuid(),
      requestedKey: z.string().max(4000),
      projection: z.literal(projection),
      scope,
    })
    .strict();
export const ciRunDetailAccessOutput = z
  .object({
    readContext: context("ACCESS"),
    throughResultId: id.nullable(),
    limitations: z.array(z.string().max(2000)).max(20),
  })
  .strict();
const text = z.string().max(131072),
  label = z.string().max(32768),
  integer = z.number().int().min(-2147483648).max(2147483647);
const source = z
  .object({
    id,
    filePath: label,
    functionName: label.nullable(),
    framework: label,
    frameworkFamily: z.string().max(200),
    externalTestId: text.nullable(),
    lastSyncedCommitSha: label.nullable(),
    lastSyncedAt: utc.nullable(),
  })
  .strict();
const linkedCase = z
  .object({
    id,
    displayId: z.string().max(200).nullable(),
    title: label,
    archived: z.boolean(),
    reviewStatus: z.string().max(200),
    source: source.nullable(),
    provenance: z.literal(
      "CURRENT_CASE_METADATA_NOT_FROZEN_EXECUTION_DEFINITION",
    ),
  })
  .strict();
export const ciRunDetailResult = z
  .object({
    id,
    testRunId: id,
    testCaseId: id.nullable(),
    linkState: z.enum(["LINKED_CURRENT_CASE", "UNMATCHED"]),
    linkedCase: linkedCase.nullable(),
    externalTestId: text.nullable(),
    externalFilePath: label.nullable(),
    status: z.string().min(1).max(200),
    durationMs: integer.nullable(),
    errorMessage: text.nullable(),
    note: text.nullable(),
    artifacts: z
      .array(
        z
          .object({
            id,
            type: z.string().min(1).max(200),
            capturedAt: utc,
            durationMs: integer.nullable(),
          })
          .strict(),
      )
      .max(200),
    bodyProvenance: z.literal("CURRENT_STORED_RESULT_NOT_IMMUTABLE_HISTORY"),
  })
  .strict()
  .superRefine((row, ctx) => {
    if (
      (row.linkState === "UNMATCHED" &&
        (row.testCaseId !== null || row.linkedCase !== null)) ||
      (row.linkState === "LINKED_CURRENT_CASE" &&
        (row.testCaseId === null || row.linkedCase?.id !== row.testCaseId))
    )
      ctx.addIssue({
        code: "custom",
        message: "Stored case identity and displayed linkage disagree.",
      });
  });
const summary = z
  .object({
    total: z.number().int().min(0).max(100000),
    pass: z.number().int().min(0),
    fail: z.number().int().min(0),
    skip: z.number().int().min(0),
    flaky: z.number().int().min(0),
    blocked: z.number().int().min(0),
    other: z.number().int().min(0),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.pass +
        value.fail +
        value.skip +
        value.flaky +
        value.blocked +
        value.other !==
      value.total
    )
      ctx.addIssue({
        code: "custom",
        message: "Complete raw-result counts disagree.",
      });
  });
export const ciRunDetailPageOutput = z
  .object({
    readContext: context("PAGE"),
    header: z
      .object({
        id,
        projectId: id,
        ciProvider: z
          .string()
          .min(1)
          .max(32768)
          .refine((value) => value !== "manual"),
        branch: label,
        commitSha: label,
        status: z.string().min(1).max(200),
        startedAt: utc,
        finishedAt: utc.nullable(),
      })
      .strict(),
    throughResultId: id.nullable(),
    rows: z.array(ciRunDetailResult).max(50),
    summary,
    limit: z.number().int().min(1).max(50),
    hasMore: z.boolean(),
    nextAfterId: id.nullable(),
    limitations: z.array(z.string().max(2000)).max(20),
  })
  .strict()
  .superRefine((page, ctx) => {
    const last = page.rows.at(-1);
    if (
      page.rows.length > page.limit ||
      new Set(page.rows.map((row) => row.id)).size !== page.rows.length ||
      page.header.id !== page.readContext.scope.testRunId ||
      page.header.projectId !== page.readContext.scope.projectId ||
      page.rows.some(
        (row, index) =>
          row.testRunId !== page.header.id ||
          page.throughResultId === null ||
          ciRunDetailCompareId(row.id, page.throughResultId) > 0 ||
          (index > 0 &&
            ciRunDetailCompareId(page.rows[index - 1]!.id, row.id) >= 0),
      ) ||
      page.rows.reduce((count, row) => count + row.artifacts.length, 0) > 200 ||
      page.rows.length > page.summary.total ||
      (page.hasMore &&
        (page.rows.length !== page.limit ||
          !last ||
          page.nextAfterId !== last.id)) ||
      (!page.hasMore && page.nextAfterId !== null) ||
      (page.throughResultId === null &&
        (page.rows.length !== 0 || page.summary.total !== 0 || page.hasMore))
    )
      ctx.addIssue({
        code: "custom",
        message: "The complete current page/window is inconsistent.",
      });
  });
export function ciRunDetailReadKey(
  input: CiRunDetailAccessInput | CiRunDetailPageInput,
) {
  return JSON.stringify({
    projectId: input.projectId,
    testRunId: input.testRunId,
    originalOrganizationId: input.originalOrganizationId,
    expectedClerkActorId: input.expectedClerkActorId,
    ...(input.expectedNativeActorId === undefined
      ? {}
      : { expectedNativeActorId: input.expectedNativeActorId }),
    requestId: input.requestId,
    ...("limit" in input
      ? {
          throughResultId: input.throughResultId,
          ...(input.afterId === undefined ? {} : { afterId: input.afterId }),
          limit: input.limit,
        }
      : {}),
  });
}
export function ciRunDetailCompareId(left: string, right: string) {
  const a = new TextEncoder().encode(left),
    b = new TextEncoder().encode(right);
  for (let index = 0; index < Math.min(a.length, b.length); index++)
    if (a[index] !== b[index]) return a[index]! - b[index]!;
  return a.length - b.length;
}
