export type RunOutcomeCounts = {
  pass: number;
  fail: number;
  blocked: number;
  skip: number;
  flaky: number;
  other: number;
};
export type GroupedRunOutcome = {
  testCaseId: string | null;
  status: string;
  count: number;
};
const emptyCounts = (): RunOutcomeCounts => ({
  pass: 0,
  fail: 0,
  blocked: 0,
  skip: 0,
  flaky: 0,
  other: 0,
});
function outcomeKey(status: string): keyof RunOutcomeCounts {
  switch (status) {
    case "PASS":
      return "pass";
    case "FAIL":
      return "fail";
    case "BLOCKED":
      return "blocked";
    case "SKIP":
      return "skip";
    case "FLAKY":
      return "flaky";
    default:
      return "other";
  }
}
export function runProgress(
  provider: string,
  plannedIds: string[],
  outcomes: GroupedRunOutcome[],
) {
  const planned = new Set(plannedIds);
  if (provider === "manual" && planned.size > 1000) return null;
  const counts = emptyCounts();
  if (provider === "manual") {
    const statuses = new Map<string, string>();
    for (const row of outcomes) {
      if (!row.testCaseId || !planned.has(row.testCaseId)) continue;
      if (!Number.isSafeInteger(row.count) || row.count < 1) return null;
      const previous = statuses.get(row.testCaseId);
      // No reliable result timestamp/uniqueness contract selects a newer
      // conflicting row. Never invent a last-write-wins outcome.
      if (previous !== undefined && previous !== row.status) return null;
      statuses.set(row.testCaseId, row.status);
    }
    for (const status of statuses.values()) counts[outcomeKey(status)] += 1;
  } else {
    // CI counts ingested observations, including parameterized/unmatched ones.
    for (const row of outcomes) {
      if (!Number.isSafeInteger(row.count) || row.count < 1) return null;
      counts[outcomeKey(row.status)] += row.count;
    }
  }
  const recorded = Object.values(counts).reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(recorded)) return null;
  const total = provider === "manual" ? planned.size : recorded;
  const remaining = Math.max(0, total - recorded);
  return {
    ...counts,
    total,
    recorded,
    remaining,
    percentComplete: total
      ? Math.min(100, Math.round((recorded / total) * 100))
      : 0,
  };
}
