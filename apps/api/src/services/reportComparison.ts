import { z } from "zod";
import type { FrozenReportPayload } from "../routers/reportSnapshots.js";

export const reportComparisonInput = z
  .object({
    projectId: z.string().min(1).max(120),
    baselineId: z.string().length(64),
    targetId: z.string().length(64),
  })
  .strict()
  .refine(
    (value) => value.baselineId !== value.targetId,
    "Choose two different snapshots.",
  );

// Only approved, original-tenant snapshots reach this pure comparison. No live
// case/result/source lookup and no raw cohort, author note or provenance export.
type Snapshot = { id: string; payload: FrozenReportPayload };
export function compareApprovedReports(baseline: Snapshot, target: Snapshot) {
  const before = baseline.payload,
    after = target.payload;
  if (before.state !== "approved" || after.state !== "approved")
    throw new Error("Only approved snapshots can be compared.");
  if (!(Date.parse(before.asOf) < Date.parse(after.asOf)))
    throw new Error("The baseline must have an earlier capture time.");
  const scopeKey = (report: FrozenReportPayload) => {
    const scope = report.scope;
    if (!scope || scope.kind === "project") {
      if (report.definition.executionScope || scope?.filters)
        throw new Error("This capture lacks a reliable exact scope.");
      return JSON.stringify(["project"]);
    }
    if (!scope.filters)
      throw new Error("This capture lacks its recorded filters.");
    const filters = scope.filters ?? {};
    return JSON.stringify([
      "recorded-execution",
      filters.planId ?? null,
      filters.runId ?? null,
      filters.platform ?? null,
      filters.environment ?? null,
      filters.build ?? null,
    ]);
  };
  if (scopeKey(before) !== scopeKey(after))
    throw new Error(
      "These reports have different scopes. Choose the same project-wide or exact recorded scope.",
    );
  for (const report of [before, after]) {
    if (
      !Number.isFinite(Date.parse(report.windowStart)) ||
      !Number.isFinite(Date.parse(report.windowEnd ?? report.asOf)) ||
      Date.parse(report.windowStart) >
        Date.parse(report.windowEnd ?? report.asOf)
    )
      throw new Error("This capture has an unsupported execution window.");
    if (
      report.limitations.length > 80 ||
      report.limitations.some((note) => note.length > 4000)
    )
      throw new Error(
        "Original report limitations exceed the supported comparison size.",
      );
  }
  const sections = before.definition.sections.filter((section) =>
    after.definition.sections.includes(section),
  );
  if (!sections.length)
    throw new Error(
      "These snapshots have no selected metric sections in common.",
    );
  const rows: Array<{
    section: string;
    label: string;
    baseline: number | null;
    target: number | null;
    delta: number | null;
    note: string;
  }> = [];
  const add = (
    section: (typeof sections)[number],
    label: string,
    a: number | undefined | null,
    b: number | undefined | null,
    note = "Recorded count change, not a quality or readiness judgment.",
  ) => {
    if (!sections.includes(section)) return;
    const valid = (value: number | undefined | null) =>
      value === undefined || value === null
        ? null
        : Number.isSafeInteger(value) && value >= 0
          ? value
          : (() => {
              throw new Error("A recorded metric is unsupported.");
            })();
    const x = valid(a),
      y = valid(b);
    rows.push({
      section,
      label,
      baseline: x,
      target: y,
      delta: x === null || y === null ? null : y - x,
      note,
    });
  };
  const bucket = (
    section: (typeof sections)[number],
    label: string,
    a: Array<{ key: string; count: number }>,
    b: Array<{ key: string; count: number }>,
  ) => {
    if (!sections.includes(section)) return;
    if (
      a.length > 40 ||
      b.length > 40 ||
      new Set(a.map((x) => x.key)).size !== a.length ||
      new Set(b.map((x) => x.key)).size !== b.length
    )
      throw new Error("Recorded metric buckets cannot be compared safely.");
    const left = new Map(a.map((x) => [x.key, x.count])),
      right = new Map(b.map((x) => [x.key, x.count]));
    const keys = [...new Set([...left.keys(), ...right.keys()])].sort();
    for (const key of keys) {
      if (key.length > 80) throw new Error("A metric label is unsupported.");
      add(
        section,
        `${label}: ${key}`,
        left.get(key) ?? 0,
        right.get(key) ?? 0,
        section === "automation"
          ? "Recorded labels, not verified automated execution or time saved."
          : "Absent bucket means zero in a captured complete distribution; cohorts may differ.",
      );
    }
  };
  add(
    "inventory",
    "Active cases",
    before.inventory.active,
    after.inventory.active,
  );
  add(
    "inventory",
    "Risk-assessed cases",
    before.inventory.riskAssessed,
    after.inventory.riskAssessed,
  );
  add(
    "inventory",
    "Cases marked flaky",
    before.inventory.flaky,
    after.inventory.flaky,
    "Case flags, not a measured flake rate.",
  );
  bucket(
    "inventory",
    "Priority",
    before.inventory.priority,
    after.inventory.priority,
  );
  add(
    "execution",
    "Runs in execution window",
    before.execution.runs,
    after.execution.runs,
  );
  add(
    "execution",
    "Recorded results",
    before.execution.results,
    after.execution.results,
  );
  add(
    "execution",
    "Distinct active cases executed",
    before.execution.distinctCases,
    after.execution.distinctCases,
  );
  add(
    "execution",
    "High/critical-priority cases",
    before.execution.highPriorityCases,
    after.execution.highPriorityCases,
  );
  add(
    "execution",
    "High/critical-priority cases executed",
    before.execution.highPriorityExecuted,
    after.execution.highPriorityExecuted,
  );
  add(
    "execution",
    "Results linked to project cases",
    before.execution.matchedResults,
    after.execution.matchedResults,
  );
  add(
    "execution",
    "Unmatched/foreign case results",
    before.execution.unmatchedResults,
    after.execution.unmatchedResults,
  );
  add(
    "execution",
    "Planned manual case/run pairs",
    before.execution.plannedCaseRunPairs,
    after.execution.plannedCaseRunPairs,
  );
  add(
    "execution",
    "Planned pairs without a result",
    before.execution.notRecordedCaseRunPairs,
    after.execution.notRecordedCaseRunPairs,
    "No result is not pass, skip or blocked.",
  );
  bucket(
    "execution",
    "Outcome",
    before.execution.outcomes,
    after.execution.outcomes,
  );
  add(
    "traceability",
    "Requirements in scope",
    before.traceability.requirements,
    after.traceability.requirements,
  );
  add(
    "traceability",
    "Requirements linked to active cases",
    before.traceability.coveredRequirements,
    after.traceability.coveredRequirements,
    "Explicit links, not verified requirements or passing execution.",
  );
  add(
    "traceability",
    "Active cases with traceability links",
    before.traceability.casesWithLinks,
    after.traceability.casesWithLinks,
  );
  add(
    "traceability",
    "Active traceability links",
    before.traceability.links,
    after.traceability.links,
  );
  add(
    "defects",
    "Retained defect clusters",
    before.defects?.clusters,
    after.defects?.clusters,
    "Missing/import-excluded evidence remains unavailable, not zero defects.",
  );
  add(
    "defects",
    "Clusters with confirmed task links",
    before.defects?.confirmed,
    after.defects?.confirmed,
  );
  add(
    "defects",
    "Clusters with suggested task matches",
    before.defects?.suggested,
    after.defects?.suggested,
  );
  add(
    "defects",
    "Unavailable defect sources",
    before.defects?.unavailableSources,
    after.defects?.unavailableSources,
  );
  bucket(
    "automation",
    "Automation status",
    before.inventory.automation,
    after.inventory.automation,
  );
  const header = (snapshot: Snapshot) => ({
    id: snapshot.id,
    title: snapshot.payload.title,
    asOf: snapshot.payload.asOf,
    windowStart: snapshot.payload.windowStart,
    windowEnd: snapshot.payload.windowEnd ?? snapshot.payload.asOf,
  });
  const baselineCases = new Set(before.cohort.map((row) => row.id)),
    targetCases = new Set(after.cohort.map((row) => row.id));
  const filters = before.scope?.filters;
  const scopeDescription =
    before.scope?.kind !== "recorded-execution"
      ? "Project-wide scope"
      : [
          filters?.planId
            ? `Plan: ${before.scope.planName ?? "Selected plan"}`
            : null,
          filters?.runId ? "Selected recorded run" : null,
          filters?.platform ? `Platform: ${filters.platform}` : null,
          filters?.environment ? `Environment: ${filters.environment}` : null,
          filters?.build ? `Build: ${filters.build}` : null,
        ]
          .filter(Boolean)
          .join(" · ");
  return {
    baseline: header(baseline),
    target: header(target),
    sections,
    rows,
    scopeDescription,
    sourceLimitations: {
      baseline: before.limitations,
      target: after.limitations,
    },
    scope: before.scope?.kind ?? "project",
    sameExecutionWindow:
      before.windowStart === after.windowStart &&
      (before.windowEnd ?? before.asOf) === (after.windowEnd ?? after.asOf),
    cohort: {
      common: [...baselineCases].filter((id) => targetCases.has(id)).length,
      added: [...targetCases].filter((id) => !baselineCases.has(id)).length,
      removed: [...baselineCases].filter((id) => !targetCases.has(id)).length,
    },
    limitations: [
      "Two immutable approved snapshots. Only sections selected in both are compared; no live data or author commentary is substituted.",
      "Execution counts use each original UTC window. Different or overlapping windows are not independent observations or a measured trend.",
      "Inventory and relationships describe capture time. Active case cohorts can change; aggregate deltas are not same-case improvements.",
      "Positive or negative changes are neutral recorded counts, not pass rate, regression proof, productivity, risk acceptance or release readiness.",
      "Unavailable legacy/import-excluded metrics remain unavailable. Original report evidence and limitations still apply.",
      "This reviewed comparison is not a newly approved stored report. Downloaded files contain internal project metrics; check recipients before sharing.",
    ],
  };
}
export type ApprovedReportComparison = ReturnType<
  typeof compareApprovedReports
>;
