import type { z } from "zod";
import { Prisma } from "@vaettir/db";
import { reportDateIntervalSchema } from "../services/reportDateIntervalSchema.js";
import {
  reportExecutionScopeSchema,
  type ReportExecutionScope,
} from "../services/reportExecutionScopeSchema.js";
export { reportDateIntervalSchema };
export { reportExecutionScopeSchema, type ReportExecutionScope };

/** Inclusive UTC calendar days, capped at the transaction's immutable capture time. */
export function reportWindow(
  asOf: Date,
  windowDays: number,
  interval?: z.infer<typeof reportDateIntervalSchema>,
) {
  if (!interval)
    return {
      start: new Date(asOf.getTime() - windowDays * 86400000),
      end: asOf,
    };
  if (interval.end > asOf.toISOString().slice(0, 10))
    throw new Error("Report dates cannot be in the future");
  const start = new Date(`${interval.start}T00:00:00.000Z`);
  const end = new Date(
    Math.min(
      Date.parse(`${interval.end}T00:00:00.000Z`) + 86400000 - 1,
      asOf.getTime(),
    ),
  );
  return { start, end };
}
/** Exact recorded references; never infer a platform from current project settings. */
export function reportRunWhere(
  projectId: string,
  start: Date,
  end: Date,
  scope?: ReportExecutionScope,
  releasePlanIds?: readonly string[],
): Prisma.TestRunWhereInput {
  const AND: Prisma.TestRunWhereInput[] = [];
  if (scope?.releaseId) {
    if (!releasePlanIds || releasePlanIds.length > 200)
      throw new Error(
        "Release scope must be resolved completely before filtering runs",
      );
    AND.push({
      OR: releasePlanIds.length
        ? releasePlanIds.map((id) => ({
            executionContext: { path: ["plan", "testPlanId"], equals: id },
          }))
        : [{ id: { in: [] } }],
    });
  }
  if (scope?.runId) AND.push({ id: scope.runId });
  if (scope?.planId)
    AND.push({
      executionContext: { path: ["plan", "testPlanId"], equals: scope.planId },
    });
  for (const key of ["platform", "environment"] as const) {
    if (scope?.[key])
      AND.push({
        executionContext: { path: ["configuration", key], equals: scope[key] },
      });
  }
  if (
    scope?.releaseId ||
    scope?.planId ||
    scope?.platform ||
    scope?.environment
  )
    AND.push({ executionContext: { path: ["version"], equals: 1 } });
  if (scope?.build)
    AND.push({
      OR: [
        {
          ciProvider: "manual",
          AND: [
            { executionContext: { path: ["version"], equals: 1 } },
            {
              executionContext: {
                path: ["configuration", "build"],
                equals: scope.build,
              },
            },
          ],
        },
        { ciProvider: { not: "manual" }, commitSha: scope.build },
      ],
    });
  return {
    projectId,
    startedAt: { gte: start, lte: end },
    ...(AND.length ? { AND } : {}),
  };
}
