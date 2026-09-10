import { parseGherkin } from "@vaettir/core";

// P11-05: Xray (Jira) importer, file-based. Xray has no single "export"
// shape - the two that customers actually end up with are:
//
//   1. A Jira issue CSV export of Test issues (Issues → search by JQL,
//      e.g. `project = ABC AND issuetype = Test` → Export → CSV (all
//      fields)). Jira emits Xray's fields as `Custom field (Test Type)`,
//      `Custom field (Manual Test Steps)` (a JSON array of steps),
//      `Custom field (Cucumber Scenario)`, `Custom field (Generic Test
//      Definition)`, `Custom field (Test Repository Path)`; multi-valued
//      columns like `Labels` are repeated, one value per column.
//   2. Xray's own JSON test export (REST `export/test`, or the JSON option
//      on the Test Repository), an array of tests with `key`, `summary`,
//      `type`, `steps` and/or `definition`.
//
// Both are recognized here. Everything is derived from the exported
// columns/fields Xray documents; there is no live Jira/Xray instance in
// this environment, so the fixtures in xrayImport.test.ts are constructed
// from that documentation, not captured from a real export - the header
// matching is deliberately tolerant (case-insensitive, with or without
// the `Custom field (...)` wrapper) for that reason.
//
// Automation *results* are not handled here on purpose: Xray consumes and
// emits JUnit/Cucumber, which Phase 5's ingestion already accepts.

export interface XrayStep {
  action: string;
  expectedActionOrData: string | null;
  expectedResult: string | null;
}

export interface ParsedXrayTest {
  rowNumber: number;
  key: string;
  title: string;
  testType: string; // Manual | Cucumber | Generic | anything else Xray reports
  priority: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  tags: string[];
  suitePath: string | null;
  background: string | null;
  given: string[];
  when: string[];
  then: string[];
  steps: XrayStep[];
}

export interface XrayParseResult {
  format: "jira-csv" | "xray-json";
  cases: ParsedXrayTest[];
  skipped: { rowNumber: number; reason: string }[];
}

// Same RFC 4180 splitter as csvFieldMapping.ts / testCaseCsvImport.ts,
// duplicated by the same reasoning: a self-contained primitive, not worth
// a cross-service dependency.
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

// Jira priorities (default scheme + the common custom ones) → Vaettir's.
export function mapXrayPriority(raw: string | undefined | null): ParsedXrayTest["priority"] {
  const p = (raw ?? "").trim().toLowerCase();
  if (p === "blocker" || p === "critical" || p === "highest" || p === "p0") return "CRITICAL";
  if (p === "high" || p === "major" || p === "p1") return "HIGH";
  if (p === "low" || p === "lowest" || p === "minor" || p === "trivial" || p === "p3" || p === "p4") return "LOW";
  return "MEDIUM";
}

// Normalizes a Jira export header to a bare Xray/Jira field name:
// "Custom field (Manual Test Steps)" → "manual test steps".
function normalizeHeader(h: string): string {
  const m = h.trim().match(/^custom field \((.+)\)$/i);
  return (m ? m[1]! : h).trim().toLowerCase();
}

// Xray's Manual Test Steps JSON. Server/DC exports
// `[{"index":1,"fields":{"Action":"…","Data":"…","Expected Result":"…"}}]`;
// Cloud exports `[{"action":"…","data":"…","result":"…"}]` (occasionally
// `expectedResult`). Both are accepted; anything unrecognizable yields
// no steps rather than a throw, so one odd row can't fail the file.
export function parseXraySteps(raw: unknown): XrayStep[] {
  let value: unknown = raw;
  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text) return [];
    try {
      value = JSON.parse(text);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  const steps: XrayStep[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const fields = (obj.fields && typeof obj.fields === "object" ? obj.fields : obj) as Record<string, unknown>;
    const pick = (...names: string[]): string | null => {
      for (const n of names) {
        const v = fields[n];
        if (typeof v === "string" && v.trim()) return v.trim();
      }
      return null;
    };
    const action = pick("Action", "action", "step", "Step");
    if (!action) continue;
    steps.push({
      action,
      expectedActionOrData: pick("Data", "data"),
      expectedResult: pick("Expected Result", "expectedResult", "result", "Result", "expected"),
    });
  }
  return steps;
}

interface RawXrayTest {
  rowNumber: number;
  key: string;
  summary: string;
  testType: string;
  priority: string | null;
  labels: string[];
  description: string | null;
  repositoryPath: string | null;
  steps: XrayStep[];
  cucumberScenario: string | null;
  genericDefinition: string | null;
}

function firstLine(text: string | null): string | null {
  if (!text) return null;
  const line = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return line ?? null;
}

// Turns one raw Xray test into Vaettir's BDD-normalized shape. Manual tests
// keep their structured steps AND get a derived Given/When/Then so every
// surface that only reads the BDD fields (search, AI review, exports) sees
// something meaningful: given = first line of the description (Xray users
// conventionally put preconditions there), when = the step actions, then =
// the expected results. Cucumber tests parse through the same Gherkin
// parser the .feature importer uses; a Scenario Outline expands to one
// case per Examples row exactly as it does there.
function toParsed(raw: RawXrayTest): { cases: ParsedXrayTest[]; reason?: string } {
  const base = {
    rowNumber: raw.rowNumber,
    key: raw.key,
    testType: raw.testType,
    priority: mapXrayPriority(raw.priority),
    tags: raw.labels,
    suitePath: raw.repositoryPath,
  };
  const type = raw.testType.toLowerCase();

  if (type === "cucumber" && raw.cucumberScenario) {
    // Xray stores just the scenario body (no Feature: line); wrap it so
    // the parser sees a well-formed feature.
    const body = /^\s*(scenario|scenario outline|background):/im.test(raw.cucumberScenario)
      ? raw.cucumberScenario
      : `Scenario: ${raw.summary}\n${raw.cucumberScenario}`;
    const { scenarios } = parseGherkin(`Feature: ${raw.summary}\n${body}`);
    const cases: ParsedXrayTest[] = [];
    for (const sc of scenarios) {
      const rows = sc.isOutline && sc.exampleRows && sc.exampleRows.length > 0 ? sc.exampleRows : [null];
      for (const row of rows) {
        const sub = (s: string) =>
          row && sc.exampleHeader ? s.replace(/<([^<>]+)>/g, (m, n) => sc.exampleHeader!.indexOf(n.trim()) >= 0 ? (row[sc.exampleHeader!.indexOf(n.trim())] ?? m) : m) : s;
        const given = sc.given.map(sub);
        const when = sc.when.map(sub);
        const then = sc.then.map(sub);
        if (given.length + when.length + then.length === 0) continue;
        cases.push({
          ...base,
          title: scenarios.length > 1 || row ? `${raw.summary} — ${sub(sc.title)}` : raw.summary,
          background: null,
          given,
          when,
          then,
          steps: [],
          tags: [...new Set([...raw.labels, ...sc.tags])],
        });
      }
    }
    if (cases.length === 0) return { cases: [], reason: "Cucumber scenario has no Given/When/Then steps" };
    // One Jira issue can expand into several cases (multiple scenarios, or
    // an outline's Examples rows). TestCaseSource.externalTestId is unique,
    // so each expansion after the first gets a stable "#n" suffix - stable
    // because expansion order follows the scenario/Examples order in the
    // export, so a re-import lines up with what it created before.
    return { cases: cases.map((c, i) => (i === 0 ? c : { ...c, key: `${raw.key}#${i + 1}` })) };
  }

  if (raw.steps.length > 0) {
    const precondition = firstLine(raw.description);
    return {
      cases: [
        {
          ...base,
          title: raw.summary,
          background: raw.description && raw.description.trim() !== precondition ? raw.description.trim() : null,
          given: precondition ? [precondition] : [],
          when: raw.steps.map((s) => s.action),
          then: raw.steps.map((s) => s.expectedResult).filter((s): s is string => Boolean(s)),
          steps: raw.steps,
        },
      ],
    };
  }

  if (raw.genericDefinition) {
    const precondition = firstLine(raw.description);
    return {
      cases: [
        {
          ...base,
          title: raw.summary,
          background: null,
          given: precondition ? [precondition] : [],
          when: [raw.genericDefinition.trim()],
          then: [],
          steps: [],
        },
      ],
    };
  }

  return { cases: [], reason: `No steps, Cucumber scenario, or generic definition (test type "${raw.testType || "unknown"}")` };
}

function parseJiraCsv(text: string): XrayParseResult {
  const rows = splitCsvRows(text);
  const header = rows[0] ?? [];
  const norm = header.map(normalizeHeader);
  const col = (...names: string[]): number => {
    for (const n of names) {
      const i = norm.indexOf(n.toLowerCase());
      if (i !== -1) return i;
    }
    return -1;
  };
  const cols = (name: string): number[] => norm.map((h, i) => (h === name.toLowerCase() ? i : -1)).filter((i) => i !== -1);

  const summaryIdx = col("summary");
  const keyIdx = col("issue key", "key", "test key");
  if (summaryIdx === -1) {
    throw new Error('Not a Jira/Xray CSV export: no "Summary" column found');
  }
  const typeIdx = col("test type", "testtype");
  const stepsIdx = col("manual test steps", "steps");
  const cucumberIdx = col("cucumber scenario", "scenario");
  const genericIdx = col("generic test definition", "definition");
  const pathIdx = col("test repository path", "repository path", "folder");
  const priorityIdx = col("priority");
  const descriptionIdx = col("description");
  const labelIdxs = cols("labels");

  const cases: ParsedXrayTest[] = [];
  const skipped: { rowNumber: number; reason: string }[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]!;
    const rowNumber = r + 1;
    const cell = (i: number): string | null => (i === -1 ? null : (row[i] ?? "").trim() || null);
    const summary = cell(summaryIdx);
    if (!summary) {
      skipped.push({ rowNumber, reason: "Empty Summary" });
      continue;
    }
    const key = cell(keyIdx) ?? `row-${rowNumber}`;
    const steps = parseXraySteps(cell(stepsIdx));
    const cucumber = cell(cucumberIdx);
    const generic = cell(genericIdx);
    const declaredType = cell(typeIdx) ?? (cucumber ? "Cucumber" : generic ? "Generic" : "Manual");
    const raw: RawXrayTest = {
      rowNumber,
      key,
      summary,
      testType: declaredType,
      priority: cell(priorityIdx),
      labels: labelIdxs.flatMap((i) => (row[i] ?? "").split(/[|,]/)).map((s) => s.trim()).filter(Boolean),
      description: cell(descriptionIdx),
      repositoryPath: cell(pathIdx),
      steps,
      cucumberScenario: cucumber,
      genericDefinition: generic,
    };
    const result = toParsed(raw);
    if (result.reason) skipped.push({ rowNumber, reason: result.reason });
    cases.push(...result.cases);
  }
  return { format: "jira-csv", cases, skipped };
}

function parseXrayJson(value: unknown): XrayParseResult {
  const list = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { tests?: unknown }).tests)
      ? (value as { tests: unknown[] }).tests
      : null;
  if (!list) throw new Error("Not an Xray JSON export: expected an array of tests (or { tests: [...] })");

  const cases: ParsedXrayTest[] = [];
  const skipped: { rowNumber: number; reason: string }[] = [];
  list.forEach((item, i) => {
    const rowNumber = i + 1;
    if (!item || typeof item !== "object") {
      skipped.push({ rowNumber, reason: "Not an object" });
      return;
    }
    const t = item as Record<string, unknown>;
    const str = (...names: string[]): string | null => {
      for (const n of names) {
        const v = t[n];
        if (typeof v === "string" && v.trim()) return v.trim();
      }
      return null;
    };
    const summary = str("summary", "Summary", "name", "title");
    if (!summary) {
      skipped.push({ rowNumber, reason: "Empty summary" });
      return;
    }
    const labelsRaw = t.labels ?? t.Labels;
    const labels = Array.isArray(labelsRaw) ? labelsRaw.filter((l): l is string => typeof l === "string") : typeof labelsRaw === "string" ? labelsRaw.split(/[|,]/) : [];
    const steps = parseXraySteps(t.steps ?? t.Steps ?? t["Manual Test Steps"]);
    const cucumber = str("definition", "scenario", "cucumberScenario", "Cucumber Scenario");
    // No explicit type: steps mean Manual; a definition that reads as
    // Gherkin means Cucumber; any other definition is Generic.
    const looksLikeGherkin = Boolean(cucumber && /^\s*(given|when|then|scenario|scenario outline|background)\b/im.test(cucumber));
    const declaredType = str("type", "testType", "Test Type") ?? (steps.length > 0 ? "Manual" : looksLikeGherkin ? "Cucumber" : "Generic");
    const isCucumber = declaredType.toLowerCase() === "cucumber";
    const raw: RawXrayTest = {
      rowNumber,
      key: str("key", "Key", "issueKey", "testKey") ?? `item-${rowNumber}`,
      summary,
      testType: declaredType,
      priority: str("priority", "Priority"),
      labels: labels.map((l) => l.trim()).filter(Boolean),
      description: str("description", "Description", "precondition", "preconditions"),
      repositoryPath: str("repositoryPath", "testRepositoryPath", "folder", "Test Repository Path"),
      steps,
      cucumberScenario: isCucumber ? cucumber : null,
      genericDefinition: !isCucumber && steps.length === 0 ? cucumber : null,
    };
    const result = toParsed(raw);
    if (result.reason) skipped.push({ rowNumber, reason: result.reason });
    cases.push(...result.cases);
  });
  return { format: "xray-json", cases, skipped };
}

export function parseXrayExport(text: string): XrayParseResult {
  const trimmed = text.trim();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    let value: unknown;
    try {
      value = JSON.parse(trimmed);
    } catch (e) {
      throw new Error(`Xray JSON export could not be parsed: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
    }
    return parseXrayJson(value);
  }
  return parseJiraCsv(text);
}
