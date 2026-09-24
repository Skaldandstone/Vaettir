// P11-01/P11-02: the generic import pipeline's CSV side -- unlike the fixed
// header set testCases.importCsv (P11-07) expects, this accepts ANY CSV and
// proposes a best-guess mapping from source columns to TestCase fields, so
// the field-mapping UI has something sensible to show before the user
// adjusts it. Nothing here writes a TestCase -- see importJobs.ts's commit
// mutation for that, which takes the user-confirmed mapping, never the
// suggestion.

// P11-11: "externalId" is optional and never auto-created (skipped in
// preview until the user maps it deliberately) - mapping it turns a plain
// one-shot import into a re-runnable one: the commit step matches each row
// back to a TestCase it created before by this id instead of duplicating.
export const TARGET_FIELDS = [
  "title",
  "given",
  "when",
  "then",
  "priority",
  "tags",
  "testType",
  "automationStatus",
  "externalId",
] as const;
export type TargetField = (typeof TARGET_FIELDS)[number];

const HEADER_ALIASES: Record<TargetField, string[]> = {
  title: [
    "title",
    "name",
    "test case",
    "testcase",
    "test title",
    "test scenario",
    "summary",
    "scenario description",
    "scenario description/test case",
    "test case description",
  ],
  given: [
    "given",
    "precondition",
    "preconditions",
    "pre-condition",
    "pre-conditions",
    "setup",
  ],
  when: [
    "when",
    "action",
    "actions",
    "step",
    "steps",
    "test step",
    "test steps",
    "procedure",
  ],
  then: [
    "then",
    "expected",
    "expected result",
    "expected results",
    "expected outcome",
  ],
  priority: ["priority", "severity"],
  tags: [
    "tags",
    "labels",
    "categories",
    "module",
    "test module/scenario",
    "test module/scenerio",
  ],
  testType: ["type", "test type", "test category", "category"],
  automationStatus: [
    "automation",
    "automated",
    "automation status",
    "is automated",
  ],
  externalId: [
    "id",
    "test id",
    "test case id",
    "testcase id",
    "tc id",
    "key",
    "qid",
  ],
};

const VALID_PRIORITIES = new Set(["CRITICAL", "HIGH", "MEDIUM", "LOW"]);
export const TEST_CASE_TYPES = [
  "UNIT",
  "FUNCTIONAL",
  "CONTRACT",
  "INSTRUMENTATION",
  "SMOKE",
  "SANITY",
  "REGRESSION",
  "E2E",
  "PERFORMANCE",
  "SECURITY",
  "ACCESSIBILITY",
  "EXPLORATORY",
  "COMPLIANCE",
  "OTHER",
] as const;
export type InferredTestCaseType = (typeof TEST_CASE_TYPES)[number];
export const AUTOMATION_STATUSES = [
  "MANUAL",
  "AUTOMATED",
  "PARTIALLY_AUTOMATED",
  "NEEDS_AUTOMATION",
] as const;
export type InferredAutomationStatus = (typeof AUTOMATION_STATUSES)[number];

export function normalizeTestType(value: string | undefined) {
  if (!value) return null;
  const normalized = value
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  return TEST_CASE_TYPES.find((type) => type === normalized) ?? null;
}

export function normalizeAutomationStatus(value: string | undefined) {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (/partial/.test(normalized)) return "PARTIALLY_AUTOMATED" as const;
  if (/needs? automation|not automated|to automate/.test(normalized))
    return "NEEDS_AUTOMATION" as const;
  if (/^(yes|true|automated|automation)$/.test(normalized))
    return "AUTOMATED" as const;
  if (/^(no|false|manual)$/.test(normalized)) return "MANUAL" as const;
  return null;
}

export function inferTestCaseType(input: {
  title: string;
  given?: string[];
  when?: string[];
  then?: string[];
  tags?: string[];
}): InferredTestCaseType {
  const text = [
    input.title,
    ...(input.given ?? []),
    ...(input.when ?? []),
    ...(input.then ?? []),
    ...(input.tags ?? []),
  ]
    .join(" ")
    .toLowerCase();

  const rules: [InferredTestCaseType, RegExp][] = [
    [
      "ACCESSIBILITY",
      /\b(accessibility|a11y|screen reader|voiceover|talkback|aria|keyboard navigation|color contrast)\b/,
    ],
    [
      "PERFORMANCE",
      /\b(performance|load test|stress test|latency|throughput|response time|requests per second|concurrent users|render time)\b/,
    ],
    [
      "SECURITY",
      /\b(security|authorization|permission|unauthori[sz]ed|forbidden|xss|csrf|sql injection|encryption|privilege escalation|vulnerability)\b/,
    ],
    [
      "INSTRUMENTATION",
      /\b(analytics|telemetry|instrumentation|event tracking|mixpanel|appsflyer|firebase analytics|datadog|metric|dau|wau|mau)\b/,
    ],
    [
      "CONTRACT",
      /\b(api contract|contract test|schema validation|endpoint|http status|status code|request payload|response payload|webhook)\b/,
    ],
    [
      "COMPLIANCE",
      /\b(compliance|regulatory|audit control|gdpr|hipaa|soc 2|pci[- ]dss|wcag)\b/,
    ],
    [
      "SMOKE",
      /\b(smoke|critical path|app launches?|service starts?|health check)\b/,
    ],
    ["SANITY", /\b(sanity check|sanity test)\b/],
    ["REGRESSION", /\b(regression|previously fixed|does not regress)\b/],
    ["E2E", /\b(e2e|end[- ]to[- ]end|full user journey|complete journey)\b/],
    ["UNIT", /\b(unit test|pure function|method returns|function returns)\b/],
    ["EXPLORATORY", /\b(exploratory|charter|time box)\b/],
  ];
  return rules.find(([, pattern]) => pattern.test(text))?.[0] ?? "FUNCTIONAL";
}

// Same RFC 4180 splitter as testCaseCsvImport.ts, duplicated rather than
// imported -- it's a tiny, self-contained parsing primitive, not worth a
// cross-service dependency for four lines of behavior.
function splitCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim().length > 0));
}

function splitMultiValue(cell: string | undefined): string[] {
  if (!cell) return [];
  return cell
    .replace(/([.!?])(\d+[.)])\s*/g, "$1\n$2 ")
    .split(/\||\r?\n/)
    .map((s) => s.trim().replace(/^\d+[.)]\s*/, ""))
    .filter(Boolean);
}

export function suggestCsvMapping(
  headers: string[],
): Partial<Record<TargetField, string>> {
  const lowerHeaders = headers.map((h) => h.trim().toLowerCase());
  const suggestedMapping: Partial<Record<TargetField, string>> = {};
  for (const field of TARGET_FIELDS) {
    const alias = HEADER_ALIASES[field].find((candidate) =>
      lowerHeaders.includes(candidate),
    );
    if (alias) suggestedMapping[field] = headers[lowerHeaders.indexOf(alias)];
  }
  return suggestedMapping;
}

export interface CsvHeaders {
  headers: string[];
  suggestedMapping: Partial<Record<TargetField, string>>;
  rowCount: number;
}

export function inspectCsv(text: string): CsvHeaders {
  const rows = splitCsvRows(text);
  const headers = (rows[0] ?? []).map((h) => h.trim());
  const suggestedMapping = suggestCsvMapping(headers);

  return { headers, suggestedMapping, rowCount: Math.max(0, rows.length - 1) };
}

export interface MappedRow {
  rowNumber: number;
  title: string;
  given: string[];
  when: string[];
  then: string[];
  priority: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  tags: string[];
  testType: InferredTestCaseType;
  automationStatus: InferredAutomationStatus;
  externalId?: string;
}

export interface MapCsvResult {
  rows: MappedRow[];
  skipped: { rowNumber: number; reason: string }[];
  incompleteRows: MappedRow[];
}

export type MappedRowOverride = Partial<Omit<MappedRow, "rowNumber">> & {
  rowNumber: number;
};

// Applies a CONFIRMED mapping (source column header -> target field) to
// every data row. Used both for the preview (a small slice, `limit`) and
// the real commit (no limit) so the two can never disagree about what a
// given mapping produces.
export function mapCsvRows(
  text: string,
  mapping: Partial<Record<TargetField, string>>,
  limit?: number,
  overrides: MappedRowOverride[] = [],
): MapCsvResult {
  const rows = splitCsvRows(text);
  if (rows.length < 2) return { rows: [], skipped: [], incompleteRows: [] };
  const header = rows[0] ?? [];
  const colIndex = (field: TargetField): number => {
    const col = mapping[field];
    return col ? header.indexOf(col) : -1;
  };
  const idx: Record<TargetField, number> = {
    title: colIndex("title"),
    given: colIndex("given"),
    when: colIndex("when"),
    then: colIndex("then"),
    priority: colIndex("priority"),
    tags: colIndex("tags"),
    testType: colIndex("testType"),
    automationStatus: colIndex("automationStatus"),
    externalId: colIndex("externalId"),
  };
  if (idx.title === -1) {
    throw new Error('The "title" field must be mapped to a CSV column');
  }

  const mapped: MappedRow[] = [];
  const skipped: { rowNumber: number; reason: string }[] = [];
  const incompleteRows: MappedRow[] = [];
  const overrideByRow = new Map(overrides.map((row) => [row.rowNumber, row]));
  const dataRows = limit ? rows.slice(1, 1 + limit) : rows.slice(1);

  dataRows.forEach((r, i) => {
    const rowNumber = i + 2;
    const override = overrideByRow.get(rowNumber);
    const title = (override?.title ?? r[idx.title] ?? "").trim();
    const given = idx.given >= 0 ? splitMultiValue(r[idx.given]) : [];
    const when = idx.when >= 0 ? splitMultiValue(r[idx.when]) : [];
    const then = idx.then >= 0 ? splitMultiValue(r[idx.then]) : [];
    const rawPriority = (idx.priority >= 0 ? r[idx.priority] : "")
      ?.trim()
      .toUpperCase();
    const priority = (
      VALID_PRIORITIES.has(rawPriority ?? "") ? rawPriority : "MEDIUM"
    ) as MappedRow["priority"];
    const tags = idx.tags >= 0 ? splitMultiValue(r[idx.tags]) : [];
    const testType =
      normalizeTestType(idx.testType >= 0 ? r[idx.testType] : undefined) ??
      inferTestCaseType({ title, given, when, then, tags });
    const automationStatus =
      normalizeAutomationStatus(
        idx.automationStatus >= 0 ? r[idx.automationStatus] : undefined,
      ) ?? "MANUAL";
    const externalId =
      idx.externalId >= 0
        ? (r[idx.externalId] ?? "").trim() || undefined
        : undefined;

    const candidate: MappedRow = {
      rowNumber,
      title,
      given: override?.given ?? given,
      when: override?.when ?? when,
      then: override?.then ?? then,
      priority: override?.priority ?? priority,
      tags: override?.tags ?? tags,
      testType: override?.testType ?? testType,
      automationStatus: override?.automationStatus ?? automationStatus,
      externalId: override?.externalId ?? externalId,
    };
    if (!candidate.title) {
      skipped.push({ rowNumber, reason: "missing title" });
      incompleteRows.push(candidate);
      return;
    }
    mapped.push(candidate);
  });

  return { rows: mapped, skipped, incompleteRows };
}
