export type ReportBucket = { key: string; count: number };

export type ProjectReport = {
  asOf: Date | string;
  windowStart: Date | string | null;
  inventory: {
    active: number; archived: number; withSource: number; riskAssessed: number; flaky: number;
    byType: ReportBucket[]; byPriority: ReportBucket[]; byReview: ReportBucket[];
  };
  requirements: { total: number; withCriteria: number; linkedCriteria: number; criteria: ReportBucket[] };
  execution: { runs: number; byRunStatus: ReportBucket[]; results: number; matchedResults: number; byResultStatus: ReportBucket[] };
  recentRuns: { id: string; ciProvider: string; status: string; startedAt: Date | string; branch: string; commitSha: string; resultCount: number }[];
};

export function reportBucketCount(buckets: ReportBucket[], key: string): number {
  return buckets.find(bucket => bucket.key === key)?.count ?? 0;
}

// Skipped and blocked are not pass/fail verdicts. Flaky counts as an executed
// non-pass; this is a result-outcome share, not release/case coverage.
export function outcomePassShare(report: ProjectReport): number | null {
  const pass = reportBucketCount(report.execution.byResultStatus, "PASS");
  const denominator = pass + reportBucketCount(report.execution.byResultStatus, "FAIL") + reportBucketCount(report.execution.byResultStatus, "FLAKY");
  return denominator ? Math.round(pass / denominator * 100) : null;
}

function markdownText(value: string): string {
  return [...value].map(character => "\\`*_{}[]()#+.!|<>".includes(character) ? `\\${character}` : character).join("").replace(/[\r\n]+/g, " ");
}

function listBuckets(buckets: ReportBucket[]): string {
  return buckets.length ? buckets.map(bucket => `- ${markdownText(bucket.key.replaceAll("_", " "))}: ${bucket.count}`).join("\n") : "- No recorded values";
}

export function renderProjectReportMarkdown(projectName: string, report: ProjectReport): string {
  const passShare = outcomePassShare(report);
  return [
    `# ${markdownText(projectName)} · Project report`,
    "",
    `Generated: ${new Date(report.asOf).toISOString()}`,
    `Execution window: ${report.windowStart ? `${new Date(report.windowStart).toISOString()} to ${new Date(report.asOf).toISOString()}` : "all recorded runs through generation time"}`,
    "Source: Vaettir project records. This is not a release-readiness or deployed-code claim.",
    "",
    "## Test inventory (current)",
    `- Active cases: ${report.inventory.active}`,
    `- Archived cases: ${report.inventory.archived}`,
    `- Active cases with linked test source: ${report.inventory.withSource}`,
    `- Active cases with risk assessment: ${report.inventory.riskAssessed}`,
    `- Active cases marked flaky: ${report.inventory.flaky}`,
    "",
    "### Types", listBuckets(report.inventory.byType),
    "", "### Priorities", listBuckets(report.inventory.byPriority),
    "", "### Review state", listBuckets(report.inventory.byReview),
    "",
    "## Requirements (current)",
    `- Requirements: ${report.requirements.total}`,
    `- Requirements with one or more acceptance criteria: ${report.requirements.withCriteria}`,
    `- Test-plan criteria explicitly linked to a requirement: ${report.requirements.linkedCriteria}`,
    "- All test-plan criteria by recorded status (including unlinked criteria; this is not requirement coverage):",
    listBuckets(report.requirements.criteria),
    "",
    "## Execution (selected window)",
    `- Runs: ${report.execution.runs}`,
    `- Results: ${report.execution.results}`,
    `- Results linked to a case: ${report.execution.matchedResults}`,
    `- Outcome pass share (PASS / PASS + FAIL + FLAKY; SKIP and BLOCKED excluded): ${passShare === null ? "Not available" : `${passShare}%`}`,
    "", "### Run state", listBuckets(report.execution.byRunStatus),
    "", "### Result state", listBuckets(report.execution.byResultStatus),
    "", "## Recent runs",
    ...(report.recentRuns.length ? report.recentRuns.map(run => `- ${new Date(run.startedAt).toISOString()} · ${markdownText(run.ciProvider)} · ${markdownText(run.status)} · ${run.resultCount} results · ${run.ciProvider === "manual" ? "manual execution (no commit reference)" : `${markdownText(run.branch)} · ${markdownText(run.commitSha)}`} · ID ${markdownText(run.id)}`) : ["- No runs in this window"]),
    "",
  ].join("\n");
}
