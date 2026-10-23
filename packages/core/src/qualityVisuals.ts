/** Vaettir owns chart semantics. Integrations receive this display-only model. */
export type QualityVisual = {
  id: string;
  title: string;
  kind: "donut" | "bars";
  unit: string;
  note: string;
  empty: string;
  rows: Array<{ label: string; value: number; color: string }>;
};
export type QualityVisualReport = { version: 1; charts: QualityVisual[] };
type Count = { key: string; count: number };
export type QualityVisualSource = {
  definition?: { sections: readonly string[] };
  inventory: { active: number; automation?: Count[]; priority?: Count[] };
  execution: {
    results: number;
    outcomes: Count[];
    distinctCases: number;
    plannedCaseRunPairs?: number;
    notRecordedCaseRunPairs?: number;
  };
  traceability?: { requirements: number; coveredRequirements: number };
};
const palette: Record<string, string> = {
  PASS: "#16856A",
  FAIL: "#D04443",
  BLOCKED: "#A66B08",
  FLAKY: "#8264CF",
  SKIP: "#7D8B9D",
  SKIPPED: "#7D8B9D",
  MIXED: "#A66B08",
  AMBIGUOUS: "#697F98",
  NOT_RECORDED: "#B5C0D0",
  AUTOMATED: "#337CB8",
  MANUAL: "#8264CF",
  PARTIALLY_AUTOMATED: "#278E93",
  NEEDS_AUTOMATION: "#A66B08",
  CRITICAL: "#D04443",
  HIGH: "#C57827",
  MEDIUM: "#337CB8",
  LOW: "#7D8B9D",
};
const count = (n: number) => Number.isSafeInteger(n) && n >= 0;
const label = (s: string) =>
  s
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase());
function distribution(
  id: string,
  title: string,
  unit: string,
  rows: Count[] | undefined,
  note: string,
  kind: QualityVisual["kind"] = "donut",
): QualityVisual {
  return {
    id,
    title,
    unit,
    kind,
    note,
    empty: `No ${unit} recorded in this capture.`,
    rows: (rows ?? [])
      .filter((r) => count(r.count) && r.count > 0)
      .map((r) => ({
        label: label(r.key),
        value: r.count,
        color: palette[r.key] ?? "#697F98",
      })),
  };
}
function coverage(
  id: string,
  title: string,
  done: number | undefined,
  total: number | undefined,
  complete: string,
  remaining: string,
  note: string,
  unit = "cases",
): QualityVisual {
  const valid =
    total !== undefined &&
    done !== undefined &&
    count(total) &&
    count(done) &&
    total > 0 &&
    done <= total;
  return {
    id,
    title,
    unit,
    kind: "donut",
    note,
    empty:
      total === 0
        ? "No items in this capture's scope."
        : "Coverage was not captured or its counts are inconsistent.",
    rows: valid
      ? [
          { label: complete, value: done, color: "#337CB8" },
          { label: remaining, value: total - done, color: "#B5C0D0" },
        ].filter((r) => r.value > 0)
      : [],
  };
}
export function buildQualityVisualReport(
  source: QualityVisualSource,
): QualityVisualReport {
  // Legacy captures without a retained definition expose only their existing execution projection.
  const sections = new Set(source.definition?.sections ?? ["execution"]);
  const charts: QualityVisual[] = [];
  if (sections.has("automation"))
    charts.push(
      distribution(
        "automation",
        "Automation mix",
        "cases",
        source.inventory.automation,
        "Recorded case labels; not verified automation runs.",
      ),
    );
  if (sections.has("execution")) {
    charts.push(
      distribution(
        "outcomes",
        "Recorded outcomes",
        "observations",
        source.execution.outcomes,
        "Repeated observations count separately; this is not a release-readiness score.",
      ),
    );
    charts.push(
      coverage(
        "coverage",
        "Case execution coverage",
        source.execution.distinctCases,
        source.inventory.active,
        "Executed",
        "No execution recorded",
        "Distinct active cases with Pass, Fail or Flaky in the captured window.",
      ),
    );
    const { plannedCaseRunPairs: planned, notRecordedCaseRunPairs: remaining } =
      source.execution;
    charts.push(
      coverage(
        "plan-progress",
        "Planned execution",
        planned !== undefined && remaining !== undefined
          ? planned - remaining
          : undefined,
        planned,
        "Result recorded",
        "Awaiting result",
        "Planned case/run pairs. A recorded result may be blocked or skipped.",
        "case/run pairs",
      ),
    );
  }
  if (sections.has("inventory"))
    charts.push(
      distribution(
        "priority",
        "Test priority",
        "cases",
        source.inventory.priority,
        "Captured priority assignments.",
        "bars",
      ),
    );
  if (sections.has("traceability"))
    charts.push(
      coverage(
        "requirements",
        "Requirement coverage",
        source.traceability?.coveredRequirements,
        source.traceability?.requirements,
        "Linked to tests",
        "No test link",
        "Explicit test links; a link does not establish a passing result.",
        "requirements",
      ),
    );
  return { version: 1, charts };
}
export function buildReleaseVisualReport(source: {
  counts: {
    planned: number;
    recorded: number;
    pass: number;
    fail: number;
    blocked: number;
    skipped: number;
    flaky: number;
    mixed: number;
    ambiguous: number;
    notRecorded: number;
  };
  risks: Array<{ severity: string; count: number }>;
}): QualityVisualReport {
  const keys = [
    "pass",
    "fail",
    "blocked",
    "skipped",
    "flaky",
    "mixed",
    "ambiguous",
    "notRecorded",
  ] as const;
  return {
    version: 1,
    charts: [
      coverage(
        "release-progress",
        "Release validation progress",
        source.counts.recorded,
        source.counts.planned,
        "Result recorded",
        "Awaiting result",
        "Latest recorded outcome per planned test; recorded does not mean passed.",
      ),
      distribution(
        "release-outcomes",
        "Release test outcomes",
        "tests",
        keys.map((key) => ({
          key: key === "notRecorded" ? "NOT_RECORDED" : key.toUpperCase(),
          count: source.counts[key],
        })),
        "Latest outcomes in the selected release cohort.",
      ),
      distribution(
        "release-risks",
        "Unresolved release risks",
        "risks",
        source.risks.map((r) => ({ key: r.severity, count: r.count })),
        "Recorded unresolved risks by severity; no calculated readiness score.",
        "bars",
      ),
    ],
  };
}
