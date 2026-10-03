import { z } from "zod";

const outcomes = z
  .array(z.object({ key: z.string(), count: z.number().int().nonnegative() }))
  .max(10);
export const reportEvidenceSchema = z.object({
  version: z.literal(1),
  cases: z
    .array(
      z.object({
        id: z.string(),
        displayId: z.string(),
        priority: z.string(),
        automationStatus: z.string(),
        outcomes,
        plannedRuns: z.number().int().nonnegative(),
        notRecordedRuns: z.number().int().nonnegative(),
      }),
    )
    .max(20000),
  runs: z
    .array(
      z.object({
        id: z.string(),
        startedAt: z.string().datetime(),
        provider: z.string(),
        outcomes,
        plannedCases: z.number().int().nonnegative(),
        notRecordedCases: z.number().int().nonnegative(),
      }),
    )
    .max(20000),
});
type Group = {
  testCaseId?: string | null;
  testRunId?: string;
  status: string;
  _count: { _all: number };
};

/** All values supplied by the same capture transaction. No later result/entity lookup. */
export function capturedReportEvidence(
  cases: Array<{
    id: string;
    displayId: string;
    priority: string;
    automationStatus: string;
  }>,
  runs: Array<{
    id: string;
    startedAt: Date;
    ciProvider: string;
    manualTestCaseIds: string[];
  }>,
  caseGroups: Group[],
  runGroups: Group[],
  recordedPairs: ReadonlySet<string>,
) {
  const grouped = (rows: Group[], key: "testCaseId" | "testRunId") => {
    const map = new Map<string, Array<{ key: string; count: number }>>();
    for (const row of rows)
      if (row[key]) {
        const list = map.get(row[key]!) ?? [];
        list.push({ key: row.status, count: row._count._all });
        map.set(row[key]!, list);
      }
    for (const list of map.values())
      list.sort((a, b) => a.key.localeCompare(b.key));
    return map;
  };
  const caseCounts = grouped(caseGroups, "testCaseId"),
    runCounts = grouped(runGroups, "testRunId");
  const planned = new Map<string, { planned: number; missing: number }>();
  const runEvidence = runs.map((run) => {
    const ids = [...new Set(run.manualTestCaseIds)];
    let missing = 0;
    for (const id of ids) {
      const has = recordedPairs.has(`${run.id}:${id}`);
      if (!has) missing++;
      const count = planned.get(id) ?? { planned: 0, missing: 0 };
      count.planned++;
      if (!has) count.missing++;
      planned.set(id, count);
    }
    return {
      id: run.id,
      startedAt: run.startedAt.toISOString(),
      provider: run.ciProvider,
      outcomes: runCounts.get(run.id) ?? [],
      plannedCases: ids.length,
      notRecordedCases: missing,
    };
  });
  return reportEvidenceSchema.parse({
    version: 1,
    cases: cases.map((row) => ({
      ...row,
      outcomes: caseCounts.get(row.id) ?? [],
      plannedRuns: planned.get(row.id)?.planned ?? 0,
      notRecordedRuns: planned.get(row.id)?.missing ?? 0,
    })),
    runs: runEvidence,
  });
}
