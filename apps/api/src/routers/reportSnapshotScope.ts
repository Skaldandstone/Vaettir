import { z } from "zod";
import { Prisma } from "@vaettir/db";

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return (
      !Number.isNaN(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  }, "Choose a valid calendar date");
export const reportDateIntervalSchema = z
  .object({ start: day, end: day })
  .strict()
  .refine((value) => value.start <= value.end, "Start must be on or before end")
  .refine(
    (value) => Date.parse(value.end) - Date.parse(value.start) < 366 * 86400000,
    "Keep the interval within 366 days",
  );
export const reportExecutionScopeSchema = z
  .object({
    planId: z.string().min(1).max(200).optional(),
    runId: z.string().min(1).max(200).optional(),
    platform: z.string().trim().min(1).max(300).optional(),
    environment: z.string().trim().min(1).max(2000).optional(),
    build: z.string().trim().min(1).max(300).optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    "Choose at least one scope filter",
  );
export type ReportExecutionScope = z.infer<typeof reportExecutionScopeSchema>;

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
): Prisma.TestRunWhereInput {
  const AND: Prisma.TestRunWhereInput[] = [];
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
  if (scope?.planId || scope?.platform || scope?.environment)
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
