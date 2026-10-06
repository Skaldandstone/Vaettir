import { renderBoundedSpreadsheetCsv } from "@vaettir/core";
import type { ManualRunComparison } from "@vaettir/api/src/services/manualRunComparisonSchema";
function requirePage(value: ManualRunComparison) {
  if (!Array.isArray(value.items) || value.items.length > 50 || !Number.isInteger(value.unionCaseCount) || value.unionCaseCount < value.items.length || value.unionCaseCount > 2000 || new Set(value.items.map(item => item.caseId)).size !== value.items.length)
    throw new Error("Unsupported or ambiguous comparison page. No rows were truncated or substituted.");
}
export function renderManualRunComparisonCsv(value: ManualRunComparison): string {
  requirePage(value);
  const scope = `Current page: ${value.items.length} of ${value.unionCaseCount} union cases. No full history/media, runtime equivalence or verified repair.`;
  const prefix = [value.projectId, value.baseline.id, value.candidate.id, value.baseline.startedAt, value.candidate.startedAt, value.pairHash];
  const report = (name: string, run: ManualRunComparison["baseline"], summary: ManualRunComparison["baselineSummary"]) => `${name}: ${run.status}; finished ${run.finishedAt ?? "not recorded"}; ${summary.total} planned, ${summary.recorded} recorded, ${summary.remaining} without a verdict. Recorded is not passed or release readiness.`;
  return renderBoundedSpreadsheetCsv([
    "Project ID", "Baseline run", "Candidate run", "Baseline started UTC", "Candidate started UTC", "Compared pair hash", "Saved case identity", "Current case ID label (not captured)", "Baseline saved title", "Baseline title is excerpt", "Candidate saved title", "Candidate title is excerpt", "Baseline recorded outcome", "Candidate recorded outcome", "Saved definition state", "Baseline definition hash", "Candidate definition hash", "Export scope", "Row kind",
  ], [
    // Report context survives a legitimate empty pair/page without inventing a
    // case identity, verdict or completion denominator. Never export auth echoes.
    [...prefix, ...Array<string>(11).fill(""), `${scope} ${report("Baseline", value.baseline, value.baselineSummary)} ${report("Candidate", value.candidate, value.candidateSummary)}`, "COMPARISON_PAGE_METADATA"],
    ...value.items.map(item => [...prefix, item.caseId, item.currentCaseIdLabel ?? "Unavailable", item.baseline?.title ?? "Not in saved scope", item.baseline ? String(item.baseline.titleClipped) : "Not in saved scope", item.candidate?.title ?? "Not in saved scope", item.candidate ? String(item.candidate.titleClipped) : "Not in saved scope", item.baseline?.outcome ?? "NOT_IN_SAVED_SCOPE", item.candidate?.outcome ?? "NOT_IN_SAVED_SCOPE", item.definitionState, item.baseline?.definitionHash ?? "Not in saved scope", item.candidate?.definitionHash ?? "Not in saved scope", scope, "CASE_COMPARISON"]),
  ], 51);
}
export function renderManualRunComparisonJson(value: ManualRunComparison): string {
  requirePage(value);
  // Export only this report's declared public evidence fields, never incidental
  // authorization echoes or private fields added to an in-memory payload.
  const run = (entry: ManualRunComparison["baseline"]) => ({ id: entry.id, status: entry.status, startedAt: entry.startedAt, finishedAt: entry.finishedAt, plannedCases: entry.plannedCases, scopeUnsupported: entry.scopeUnsupported, versionOneSnapshotPresent: entry.versionOneSnapshotPresent });
  const summary = (entry: ManualRunComparison["baselineSummary"]) => ({ pass: entry.pass, fail: entry.fail, blocked: entry.blocked, skip: entry.skip, flaky: entry.flaky, total: entry.total, recorded: entry.recorded, remaining: entry.remaining, percentComplete: entry.percentComplete, ignoredOutsideScopeResults: entry.ignoredOutsideScopeResults });
  const side = (entry: ManualRunComparison["items"][number]["baseline"]) => entry ? ({ title: entry.title, titleClipped: entry.titleClipped, definitionHash: entry.definitionHash, outcome: entry.outcome }) : null;
  const page = { projectId: value.projectId, organizationId: value.organizationId, pairHash: value.pairHash, baseline: run(value.baseline), candidate: run(value.candidate), baselineSummary: summary(value.baselineSummary), candidateSummary: summary(value.candidateSummary), configuration: { baselineHash: value.configuration.baselineHash, candidateHash: value.configuration.candidateHash, sameRecordedConfiguration: value.configuration.sameRecordedConfiguration }, unionCaseCount: value.unionCaseCount, items: value.items.map(item => ({ caseId: item.caseId, currentCaseIdLabel: item.currentCaseIdLabel, baseline: side(item.baseline), candidate: side(item.candidate), definitionState: item.definitionState })), nextCursor: value.nextCursor ? { caseId: value.nextCursor.caseId, expectedPairHash: value.nextCursor.expectedPairHash } : null, limitations: [...value.limitations] };
  const content = JSON.stringify({ formatVersion: 1, kind: "current_manual_run_comparison_page", exportScope: "Only these comparison rows, not all pages or full procedures/notes/history/media. Current case ID labels are not captured historical labels. This is read-time recorded evidence, not release acceptance or verified recovery.", ...page }, null, 2);
  if (new TextEncoder().encode(content).byteLength > 16 * 1024 * 1024) throw new Error("Comparison page exceeds the 16 MiB export limit. No content was truncated.");
  return content;
}
