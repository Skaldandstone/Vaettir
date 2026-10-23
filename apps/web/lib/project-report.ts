export type ReportBucket = { key: string; count: number };
export type ReportCaseFilters = {
  suitePath: string | null; search: string; type: string; automation: string; priority: string;
  review: string; origin: string; sortBy: "updated" | "title" | "type" | "automation" | "risk" | "priority" | "origin" | "review" | "suite" | "manual";
  sortDescending: boolean; showArchived: boolean;
};
export const DEFAULT_REPORT_CASE_FILTERS: ReportCaseFilters = {
  suitePath: null, search: "", type: "", automation: "", priority: "", review: "", origin: "",
  sortBy: "updated", sortDescending: true, showArchived: false,
};

export function reportCaseFilterLabels(filters: ReportCaseFilters): { label: string; value: string }[] {
  return [
    ...(filters.suitePath ? [{ label: "Suite", value: filters.suitePath === "__unassigned__" ? "Unassigned" : filters.suitePath }] : []),
    ...(filters.search ? [{ label: "Title or tag contains", value: filters.search }] : []),
    ...(["type", "automation", "priority", "review", "origin"] as const).flatMap(key => filters[key] ? [{ label: key, value: filters[key] }] : []),
    { label: "Archived cases", value: filters.showArchived ? "Included" : "Excluded" },
    { label: "Sample sort", value: `${filters.sortBy} ${filters.sortDescending ? "descending" : "ascending"}` },
  ];
}

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
  caseQuery: null | {
    source: "saved" | "preview"; name: string | null; filters: ReportCaseFilters; total: number; active: number; archived: number;
    withSource: number; riskAssessed: number; flaky: number; byType: ReportBucket[]; byPriority: ReportBucket[]; byReview: ReportBucket[];
    sample: { id: string; title: string; testType: string; priority: string; archived: boolean }[];
  };
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
    ...(report.caseQuery ? [
      "## Case query (current inventory only)",
      `- Scope: ${report.caseQuery.source === "saved" ? `saved query ${markdownText(report.caseQuery.name ?? "")}` : "unsaved preview"}`,
      ...reportCaseFilterLabels(report.caseQuery.filters).map(item => `- ${markdownText(item.label)}: ${markdownText(item.value)}`),
      `- Matching cases: ${report.caseQuery.total} (${report.caseQuery.active} active, ${report.caseQuery.archived} archived)`,
      `- Linked test source: ${report.caseQuery.withSource}`,
      `- Risk assessed: ${report.caseQuery.riskAssessed}`,
      `- Marked flaky: ${report.caseQuery.flaky}`,
      "- Execution and requirement sections below remain project-wide; this case query does not filter them.",
      "", "### Matching case types", listBuckets(report.caseQuery.byType),
      "", "### Matching case priorities", listBuckets(report.caseQuery.byPriority),
      "", `### Matching case sample (${report.caseQuery.sample.length} of ${report.caseQuery.total})`,
      ...(report.caseQuery.sample.length ? report.caseQuery.sample.map(row => `- ${markdownText(row.title)} · ${markdownText(row.testType)} · ${markdownText(row.priority)}${row.archived ? " · archived" : ""} · ID ${markdownText(row.id)}`) : ["- No matching cases"]),
      "",
    ] : []),
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

function csvCell(value: string | number): string {
  const text = typeof value === "number" ? String(value) : [...value].map(character => character === "\0" ? "" : character).join("");
  const safe = /^[\s]*[=+@-]/u.test(text) || /^[\t\n]/u.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function renderProjectReportCsv(projectName: string, report: ProjectReport): string {
  const rows: (string | number)[][] = [["section", "metric", "value", "project", "as_of_utc", "execution_window_start_utc"]];
  const add = (section: string, metric: string, value: string | number) => rows.push([section, metric, value, projectName, new Date(report.asOf).toISOString(), report.windowStart ? new Date(report.windowStart).toISOString() : "all recorded"]);
  const buckets = (section: string, prefix: string, values: ReportBucket[]) => values.forEach(row => add(section, `${prefix}:${row.key}`, row.count));
  if (report.caseQuery) {
    const scoped = report.caseQuery;
    add("case_query", "source", scoped.source === "saved" ? scoped.name ?? "saved query" : "unsaved preview");
    for (const item of reportCaseFilterLabels(scoped.filters)) add("case_query_filter", item.label, item.value);
    for (const key of ["total", "active", "archived", "withSource", "riskAssessed", "flaky"] as const) add("case_query", key, scoped[key]);
    buckets("case_query", "type", scoped.byType); buckets("case_query", "priority", scoped.byPriority); buckets("case_query", "review", scoped.byReview);
    for (const item of scoped.sample) {
      add("case_query_sample", `${item.id}:title`, item.title);
      add("case_query_sample", `${item.id}:type`, item.testType);
      add("case_query_sample", `${item.id}:priority`, item.priority);
      add("case_query_sample", `${item.id}:state`, item.archived ? "archived" : "active");
    }
  }
  for (const key of ["active", "archived", "withSource", "riskAssessed", "flaky"] as const) add("project_case_inventory", key, report.inventory[key]);
  buckets("project_case_inventory", "type", report.inventory.byType);
  buckets("project_case_inventory", "priority", report.inventory.byPriority);
  buckets("project_case_inventory", "review", report.inventory.byReview);
  add("project_requirements", "total", report.requirements.total);
  add("project_requirements", "withCriteria", report.requirements.withCriteria);
  add("project_requirements", "linkedCriteria", report.requirements.linkedCriteria);
  buckets("project_requirements", "test_plan_criterion_status", report.requirements.criteria);
  add("project_execution", "runs", report.execution.runs);
  add("project_execution", "results", report.execution.results);
  add("project_execution", "matchedResults", report.execution.matchedResults);
  buckets("project_execution", "run_status", report.execution.byRunStatus);
  buckets("project_execution", "result_status", report.execution.byResultStatus);
  return `${rows.map(row => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
