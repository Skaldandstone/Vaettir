import {
  reportMetricQuerySchema,
  type ReportMetricQuery,
} from "./reportMetricQuerySchema.js";
import { TRPCError } from "@trpc/server";
import type { Prisma } from "@vaettir/db";
import type { QualityVisual } from "@vaettir/core";

const cap = 20000;
export function reportTimeBucket(date: Date, dimension: string) {
  const value = new Date(date);
  if (dimension === "week") {
    value.setUTCDate(value.getUTCDate() - ((value.getUTCDay() + 6) % 7));
  }
  return value.toISOString().slice(0, dimension === "month" ? 7 : 10);
}
/** Bounded typed aggregate reader. No user SQL, case content, member identities
 * or invented history. Must run inside the caller's authorized transaction. */
export async function readReportMetric(
  tx: Prisma.TransactionClient,
  projectId: string,
  query: ReportMetricQuery,
  windowDays: number,
  asOf: Date,
  id: string,
): Promise<QualityVisual> {
  query = reportMetricQuerySchema.parse(query);
  const start = new Date(asOf.getTime() - windowDays * 86400000),
    dates = { gte: start, lte: asOf };
  const colors = [
    "#167d70",
    "#3979b7",
    "#9a6fb0",
    "#b6792b",
    "#c25964",
    "#607d8b",
  ];
  const totals = new Map<string, number>();
  let observations = 0,
    missing = 0;
  const time = ["day", "week", "month"].includes(query.dimension);
  const add = (key: string, value: number | null) => {
    observations++;
    if (value === null) {
      missing++;
      return;
    }
    if (!Number.isSafeInteger(value) || value < 0)
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Recorded metric contains unsupported values.",
      });
    totals.set(key, (totals.get(key) ?? 0) + value);
  };
  const overflow = (length: number) => {
    if (length > cap)
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "This metric exceeds 20,000 source records. Narrow the window or filters; no partial total is shown.",
      });
  };
  let note: string, title: string;
  if (query.entity === "cases") {
    const rows = await tx.testCase.findMany({
      where: {
        projectId,
        archived: false,
        priority: query.priority,
        automationStatus: query.automationStatus,
        ...(time ? { createdAt: dates } : {}),
      },
      select: {
        priority: true,
        testType: true,
        automationStatus: true,
        createdAt: true,
      },
      take: cap + 1,
    });
    overflow(rows.length);
    for (const row of rows)
      add(
        time
          ? reportTimeBucket(row.createdAt, query.dimension)
          : String(
              row[
                query.dimension as "priority" | "testType" | "automationStatus"
              ],
            ),
        1,
      );
    title = time ? "Case creation activity" : "Current case distribution";
    note = time
      ? "Creation dates of currently active, retained cases. Deleted or archived cases are not reconstructed; this is not historical inventory."
      : "Current active cases, grouped by their current properties. The rolling execution window does not filter current inventory.";
  } else if (query.entity === "caseVersions") {
    const rows = await tx.testCaseVersion.findMany({
      where: {
        testCase: { projectId },
        createdAt: dates,
        priority: query.priority,
      },
      select: { priority: true, testType: true, createdAt: true },
      take: cap + 1,
    });
    overflow(rows.length);
    for (const row of rows)
      add(
        time
          ? reportTimeBucket(row.createdAt, query.dimension)
          : String(row[query.dimension as "priority" | "testType"]),
        1,
      );
    title = "Recorded case version activity";
    note =
      "Counts retained version records, not distinct cases or a complete audit of every edit. Version properties reflect the recorded version.";
  } else {
    const caseFilter =
      query.priority || query.automationStatus
        ? {
            testCase: {
              projectId,
              priority: query.priority,
              automationStatus: query.automationStatus,
            },
          }
        : { OR: [{ testCaseId: null }, { testCase: { projectId } }] };
    const rows = await tx.testResult.findMany({
      where: {
        testRun: { projectId, startedAt: dates },
        status: query.status,
        ...caseFilter,
      },
      select: {
        status: true,
        durationMs: true,
        testRun: { select: { startedAt: true } },
      },
      take: cap + 1,
    });
    overflow(rows.length);
    for (const row of rows)
      add(
        time
          ? reportTimeBucket(row.testRun.startedAt, query.dimension)
          : row.status,
        query.operation === "durationMs" ? row.durationMs : 1,
      );
    title =
      query.operation === "durationMs"
        ? "Recorded execution duration"
        : "Recorded result observations";
    note =
      "Run start time determines the UTC bucket. Repeated results count separately. Case filters use current retained case properties. Missing outcomes are not passes; duration is machine/test time, not human effort or a forecast.";
  }
  if (missing)
    note += ` ${missing} of ${observations} observations have no recorded duration and are excluded, not treated as zero.`;
  const rows = [...totals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value], index) => ({
      label: key,
      value,
      color: colors[index % colors.length]!,
    }));
  if (rows.some((row) => !Number.isSafeInteger(row.value)))
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Metric total exceeds supported numeric precision.",
    });
  return {
    id,
    title,
    kind: "bars",
    unit: query.operation === "durationMs" ? "milliseconds" : "records",
    note,
    empty: missing
      ? "No duration values were recorded."
      : "No matching recorded data.",
    rows,
  };
}
