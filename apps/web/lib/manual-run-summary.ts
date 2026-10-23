import { renderBoundedSpreadsheetCsv } from "@vaettir/core";
import type { manualRunDashboardOutputSchema } from "@vaettir/api/src/services/manualRunDashboardSchema";
import type { RecordedExecutionTrendInput } from "@vaettir/api/src/services/recordedExecutionTrendSchema";
export type ManualRunSummary = ReturnType<typeof manualRunDashboardOutputSchema.parse>;
export const MANUAL_SUMMARY_OUTCOMES = ["PASS", "FAIL", "BLOCKED", "SKIP", "FLAKY"] as const;
export const MANUAL_SUMMARY_EXCLUSIONS = ["UNSUPPORTED_FROZEN_SCOPE", "AMBIGUOUS_RESULT", "UNTRACKED_RESULT", "HEAD_PROJECTION_MISMATCH"] as const;
export const MANUAL_SUMMARY_EXCLUSION_LABELS = { UNSUPPORTED_FROZEN_SCOPE: "Unsupported saved scope/procedure shape", AMBIGUOUS_RESULT: "Ambiguous or duplicate verdict", UNTRACKED_RESULT: "Untracked legacy result", HEAD_PROJECTION_MISMATCH: "Current head/status projection disagreement" } as const;
const countKeys = ["runs", "trustedRuns", "excludedRuns", "inProgressTrustedRuns", "plannedInstances", "recordedInstances", "remainingInstances", "partialStepInstances", "ignoredOutsideScopeResultRows"] as const;
function utcDay(value: string) { const date = new Date(`${value}T00:00:00.000Z`); if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw Error("Unsupported UTC scope date. No dates were substituted."); return date.getTime(); }
/** Validate complete ordered native aggregates before presentation or export. */
export function validateManualRunSummary(value: ManualRunSummary): ManualRunSummary {
  const start = utcDay(value.scope.start), end = utcDay(value.scope.end), length = (end - start) / 86400000 + 1;
  if (length < 1 || length > 90 || value.days.length !== length || value.days.some((day, index) => day.day !== new Date(start + index * 86400000).toISOString().slice(0, 10))) throw Error("Complete ordered UTC days are required. Missing days are not zero evidence.");
  if (!Number.isFinite(Date.parse(value.asOf)) || !value.asOf.endsWith("Z") || value.scope.end > value.asOf.slice(0, 10)) throw Error("The read-time UTC timestamp/window is unsupported.");
  const validCount = (count: number) => Number.isInteger(count) && count >= 0 && count <= 100000;
  for (const row of [value.totals, ...value.days]) {
    if (![...countKeys.map(key => row[key]), ...MANUAL_SUMMARY_OUTCOMES.map(status => row.outcomes[status]), ...MANUAL_SUMMARY_EXCLUSIONS.map(reason => row.exclusions[reason])].every(validCount) || row.runs !== row.trustedRuns + row.excludedRuns || row.excludedRuns !== MANUAL_SUMMARY_EXCLUSIONS.reduce((sum, reason) => sum + row.exclusions[reason], 0) || row.recordedInstances !== MANUAL_SUMMARY_OUTCOMES.reduce((sum, status) => sum + row.outcomes[status], 0) || row.plannedInstances !== row.recordedInstances + row.remainingInstances || row.partialStepInstances > row.remainingInstances || row.inProgressTrustedRuns > row.trustedRuns) throw Error("Manual summary counts are inconsistent. No partial aggregate was shown or exported.");
  }
  if (countKeys.some(key => value.totals[key] !== value.days.reduce((sum, row) => sum + row[key], 0)) || MANUAL_SUMMARY_OUTCOMES.some(status => value.totals.outcomes[status] !== value.days.reduce((sum, row) => sum + row.outcomes[status], 0)) || MANUAL_SUMMARY_EXCLUSIONS.some(reason => value.totals.exclusions[reason] !== value.days.reduce((sum, row) => sum + row.exclusions[reason], 0))) throw Error("Manual summary daily totals do not cover the exact selected scope.");
  if (value.limitations.length > 20 || value.limitations.some(item => typeof item !== "string" || item.length > 4000)) throw Error("Unsupported summary limitation metadata. No text was truncated.");
  return value;
}
export function manualSummaryScopeMatches(value: ManualRunSummary, input: RecordedExecutionTrendInput, clerkActorId: string, expectedKey: string): boolean {
  return value.projectId === input.projectId && value.organizationId === input.originalOrganizationId && value.clerkActorId === clerkActorId && value.requestKey === expectedKey && ["start", "end", "platform", "environment", "build"].every(key => value.scope[key as keyof typeof value.scope] === input[key as keyof RecordedExecutionTrendInput]);
}
export type ManualSummaryExportSnapshot = { ready: boolean; value: ManualRunSummary | null; epoch: number; revision: number };
export type ManualSummaryReadState = { ready: boolean; key: string; sessionId: string | null; baseline: number; epoch: number };
/** An activation must obtain a later native read revision; cached query data is
 * not made fresh by collapse/reopen or a transient session loss/recovery. */
export function manualSummaryReadActivation(previous: ManualSummaryReadState, current: { ready: boolean; key: string; sessionId: string | null; revision: number }) {
  const changed = previous.ready !== current.ready || previous.key !== current.key || previous.sessionId !== current.sessionId;
  const state = changed ? { ready: current.ready, key: current.key, sessionId: current.sessionId, baseline: current.revision, epoch: previous.epoch + 1 } : previous;
  return { changed, state, fresh: current.ready && !changed && Number.isFinite(current.revision) && current.revision > state.baseline };
}
export function sameManualSummaryExport(original: ManualSummaryExportSnapshot | null, current: ManualSummaryExportSnapshot): boolean {
  return !!original?.ready && current.ready && !!original.value && original.value === current.value && original.epoch === current.epoch && original.revision === current.revision;
}
/** Status-only summary metadata. Does not export raw cases/notes/media/history. */
export function renderManualRunSummaryCsv(raw: ManualRunSummary): string {
  const value = validateManualRunSummary(raw);
  const rows: Array<Array<string | number>> = [];
  const meta = (key: string, detail: string) => rows.push(["Scope", key, detail]);
  meta("Format", "Vaettir reviewed read-time manual case-head summary CSV v1");
  meta("Project ID", value.projectId); meta("Original organization ID", value.organizationId); meta("As of UTC", value.asOf);
  meta("Inclusive UTC run-start dates", `${value.scope.start} through ${value.scope.end}`);
  meta("Recorded platform", value.scope.platform ?? "No platform filter"); meta("Recorded environment", value.scope.environment ?? "No environment filter"); meta("Recorded build", value.scope.build ?? "No build filter");
  meta("Denominator", "Trusted saved manual-run case instances only. The same case in two runs counts twice. Excluded runs are not counted as untested, zero or complete. Not globally unique repository cases.");
  meta("Remaining", "No trusted current whole-case verdict; may include partial steps. Skip and Blocked are recorded, not passed. No release readiness or verified repair is inferred.");
  meta("Export scope", "Only current summary counts and scope/limitations. No raw cases, notes, procedure bodies, media, revision history or authentication echoes.");
  const row = (kind: string, day: string, counts: ManualRunSummary["totals"]) => rows.push([kind, day, ...countKeys.map(key => counts[key]), ...MANUAL_SUMMARY_OUTCOMES.map(status => counts.outcomes[status]), ...MANUAL_SUMMARY_EXCLUSIONS.map(reason => counts.exclusions[reason])]);
  row("Total", "Entire applied scope", value.totals);
  for (const day of value.days) row("UTC run-start day", day.day, day);
  for (const limitation of value.limitations) rows.push(["Limitation", limitation]);
  const headers = ["Row kind", "Day or metadata key", "Runs / metadata detail", "Trusted runs", "Excluded runs", "In-progress trusted runs", "Planned case instances", "Recorded whole-case instances", "Remaining case instances", "Partial-step instances (subset of remaining)", "Ignored outside-scope result rows", ...MANUAL_SUMMARY_OUTCOMES.map(status => `${status} instances`), ...MANUAL_SUMMARY_EXCLUSIONS.map(reason => `${MANUAL_SUMMARY_EXCLUSION_LABELS[reason]} runs`)];
  return renderBoundedSpreadsheetCsv(headers, rows.map(row => [...row, ...Array(headers.length - row.length).fill("")]));
}
