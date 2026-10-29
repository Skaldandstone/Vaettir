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
    "case title",
    "case name",
    "test case title",
    "test case name",
    "test name",
    "summary",
    "test case summary",
    "test summary",
  ],
  given: [
    "given",
    "precondition",
    "preconditions",
    "pre-condition",
    "pre-conditions",
    "setup",
    "test setup",
    "prerequisites",
    "pre requisites",
    "prerequisite",
    "initial conditions",
  ],
  when: [
    "when",
    "action",
    "actions",
    "test action",
    "test actions",
    "step action",
    "step actions",
    "step",
    "steps",
    "test step",
    "test steps",
    "procedure",
    "steps to reproduce",
    "execution steps",
    "step description",
    "test step description",
    "action description",
    "test procedure",
  ],
  then: [
    "then",
    "expected",
    "expected result",
    "expected results",
    "expected outcome",
    "expected behavior",
    "expected behaviour",
    "expected response",
    "expected output",
  ],
  priority: ["priority", "severity"],
  tags: [
    "tags",
    "labels",
    "categories",
    "module",
    "component",
    "feature",
    "test module",
  ],
  testType: ["type", "test type", "case type", "test case type", "test category", "category", "classification"],
  automationStatus: [
    "automation",
    "automated",
    "automation status",
    "is automated",
    "execution type",
    "execution mode",
  ],
  externalId: [
    "case id",
    "external id",
    "id",
    "test id",
    "test case id",
    "testcase id",
    "tc id",
    "key",
    "qid",
    "tcid",
    "testcaseid",
  ],
};

// These labels describe a case in many vendor exports. Prefer an explicit
// name/title when present, but propose the descriptive column rather than
// requiring every ordinary scenario/checklist workbook to be mapped by hand.
const DESCRIPTIVE_TITLE_ALIASES = new Set([
  "scenario", "test scenario", "scenario description", "test scenario description",
  "scenario description test case", "scenario description testcase",
  "test case description", "testcase description", "case description", "test description",
].map(normalizeHeader));
const MODULE_SCENARIO_ALIASES = new Set([
  "test module scenario", "test module scenerio", "module scenario", "module scenerio",
].map(normalizeHeader));

// Normalize the fixed vocabulary once. Workbook header discovery considers
// up to 25 rows per sheet; repeatedly normalizing every alias for every cell
// wastes the isolated parser's bounded CPU budget without changing matches.
const NORMALIZED_HEADER_ALIASES = Object.fromEntries(
  TARGET_FIELDS.map(field => [field, new Set(HEADER_ALIASES[field].map(normalizeHeader))]),
) as Record<TargetField, Set<string>>;

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
  return recommendTestCaseType(input).testType;
}

export function recommendTestCaseType(input: {
  title: string; given?: string[]; when?: string[]; then?: string[]; tags?: string[];
}): { testType: InferredTestCaseType; reason: string } {
  // Parsing is not semantic analysis. Keep the wire enum valid without
  // inventing a type; the separate background review reads the full definition.
  void input;
  return { testType: "OTHER", reason: "Unclassified: awaiting a full-definition AI review. No type has been guessed." };
}

// Same RFC 4180 splitter as testCaseCsvImport.ts, duplicated rather than
// imported -- it's a tiny, self-contained parsing primitive, not worth a
// cross-service dependency for four lines of behavior.
export function splitCsvRows(text: string, preserveBlankRows = false): string[][] {
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
  return preserveBlankRows ? rows : rows.filter((r) => r.some((f) => f.trim().length > 0));
}

function splitMultiValue(cell: string | undefined): string[] {
  if (!cell) return [];
  return cell
    .replace(/([.!?])(\d+[.)])\s*/g, "$1\n$2 ")
    .split(/\||\r?\n/)
    .map((s) => s.trim().replace(/^\d+[.)]\s*/, ""))
    .filter(Boolean);
}

function preserveProcedureCell(cell: string | undefined): string[] {
  // A source cell is prose, not a grammar for inventing steps. Keep numbering,
  // multiline layout, indentation, and literal pipes exactly as supplied.
  return cell?.trim() ? [cell] : [];
}

export function suggestCsvMapping(
  headers: string[],
  sampleRows: string[][] = [],
): Partial<Record<TargetField, string>> {
  const lowerHeaders = headers.map(normalizeHeader);
  const suggestedMapping: Partial<Record<TargetField, string>> = {};
  for (const field of TARGET_FIELDS) {
    const candidates = lowerHeaders.flatMap((header, index) => {
      let score = NORMALIZED_HEADER_ALIASES[field].has(header) ? 100 : 0;
      if (field === "title" && DESCRIPTIVE_TITLE_ALIASES.has(header)) score = 80;
      if (field === "title" && header === "description" && lowerHeaders.some(value =>
        ["given", "when", "then", "externalId"].some(target =>
          NORMALIZED_HEADER_ALIASES[target as TargetField].has(value),
        ),
      )) score = 60;
      // Do not turn an action/expected/ID column into a title by looking at its
      // contents. Samples only distinguish competing plausible header roles.
      if (!score || lowerHeaders.filter(value => value === header).length !== 1) return [];
      if (sampleRows.length) {
        const populated = sampleRows.filter(row => row[index]?.trim()).length;
        score += populated ? populated / sampleRows.length : -50;
      }
      return [{ index, score }];
    }).sort((a, b) => b.score - a.score);
    const best = candidates[0];
    if (best && best.score !== candidates[1]?.score) suggestedMapping[field] = headers[best.index];
  }
  // A combined module/scenario column is grouping metadata only when another
  // column has already been identified as the case name. Never use it for both.
  if (suggestedMapping.title && !suggestedMapping.tags) {
    const matches = lowerHeaders.flatMap((header, index) => MODULE_SCENARIO_ALIASES.has(header) ? [index] : []);
    if (matches.length === 1) suggestedMapping.tags = headers[matches[0]!];
  }
  return suggestedMapping;
}

function normalizeHeader(header: string): string {
  return header.normalize("NFKC").replace(/\(s\)/gi, "s").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export interface CsvHeaders {
  headers: string[];
  suggestedMapping: Partial<Record<TargetField, string>>;
  rowCount: number;
}

export function inspectCsv(text: string): CsvHeaders {
  const rows = splitCsvRows(text);
  const headers = (rows[0] ?? []).map((h) => h.trim());
  const suggestedMapping = suggestCsvMapping(headers, rows.slice(1, 26));

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
  suitePath?: string;
  background?: string;
  sourceRowKind?: "SECTION" | "NOTE" | "PLACEHOLDER";
  reviewReasons?: string[];
  typeRecommendation?: string;
  typeOrigin?: "SOURCE" | "UNCLASSIFIED" | "REVIEWER" | "SEMANTIC";
}

export interface MapCsvResult {
  rows: MappedRow[];
  skipped: { rowNumber: number; reason: string }[];
  incompleteRows: MappedRow[];
  nonCaseRows?: MappedRow[];
  rowMappingSuggestions?: { original: MappedRow; proposed: MappedRow }[];
  recommendations?: MappedRow[];
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
  // inspectCsv exposes trimmed header labels to the mapping UI. Resolve the
  // confirmed labels with the same normalization here, or whitespace in an
  // Excel/CSV header silently turns a mapped Given/When column into no steps.
  const header = (rows[0] ?? []).map((value) => value.trim());
  const colIndex = (field: TargetField): number => {
    const col = mapping[field];
    if (!col) return -1;
    const label = col.trim();
    const matches = header.flatMap((value, index) => value === label ? [index] : []);
    if (matches.length !== 1) {
      throw new Error(`The mapped "${field}" column ${matches.length ? "is ambiguous" : "was not found"}; review the column mapping before importing.`);
    }
    return matches[0]!;
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
  const usedColumns = new Set<number>();
  for (const field of TARGET_FIELDS) {
    const index = idx[field];
    if (index < 0) continue;
    if (usedColumns.has(index)) {
      throw new Error(`The mapped "${field}" column is already mapped to another field; review the column mapping before importing.`);
    }
    usedColumns.add(index);
    // Header recognition proposes defaults; it must not override the human's
    // confirmed correction. Existence and one-column/one-field checks remain
    // binding, and preview/commit still use this exact same reviewed mapping.
  }
  if (idx.title === -1) {
    throw new Error('The "title" field must be mapped to a CSV column');
  }

  const mapped: MappedRow[] = [];
  const skipped: { rowNumber: number; reason: string }[] = [];
  const incompleteRows: MappedRow[] = [];
  const nonCaseRows: MappedRow[] = [];
  const rowMappingSuggestions: NonNullable<MapCsvResult["rowMappingSuggestions"]> = [];
  const recommendations: MappedRow[] = [];
  let workflow = "";
  let section = "";
  let sourceNotes: string[] = [];
  const overrideByRow = new Map(overrides.map((row) => [row.rowNumber, row]));
  const dataRows = limit ? rows.slice(1, 1 + limit) : rows.slice(1);
  // Some exports change layout partway through a sheet without repeating the
  // header. Only recognize this specific, otherwise empty, three-cell shape.
  // Keep the original row beside every proposal so the reviewer can undo it.
  const alternateHeaderRoles = MODULE_SCENARIO_ALIASES.has(normalizeHeader(mapping.tags ?? "")) &&
    DESCRIPTIVE_TITLE_ALIASES.has(normalizeHeader(mapping.title ?? "")) &&
    idx.given >= 0 && idx.when >= 0 && idx.then >= 0;
  const alternateShape = (r: string[]) => alternateHeaderRoles &&
    Boolean(r[idx.tags]?.trim() && r[idx.title]?.trim() && r[idx.given]?.trim()) &&
    !r[idx.when]?.trim() && !r[idx.then]?.trim();
  const titleLike = (value: string) => /^(verify\b|check\s+(?:whether|that)\b|ensure\b)/i.test(value.trim());
  const alternateRows = dataRows.filter(alternateShape);
  const supportedAlternateLayout = alternateRows.length >= 3 &&
    alternateRows.filter(r => titleLike(r[idx.tags] ?? "")).length / alternateRows.length >= 0.8;

  dataRows.forEach((r, i) => {
    const rowNumber = i + 2;
    const override = overrideByRow.get(rowNumber);
    const title = (override?.title ?? r[idx.title] ?? "").trim();
    const given = idx.given >= 0 ? preserveProcedureCell(r[idx.given]) : [];
    const when = idx.when >= 0 ? preserveProcedureCell(r[idx.when]) : [];
    const then = idx.then >= 0 ? preserveProcedureCell(r[idx.then]) : [];
    const rawPriority = (idx.priority >= 0 ? r[idx.priority] : "")
      ?.trim()
      .toUpperCase();
    const priority = (
      VALID_PRIORITIES.has(rawPriority ?? "") ? rawPriority : "MEDIUM"
    ) as MappedRow["priority"];
    const tags = idx.tags >= 0 ? splitMultiValue(r[idx.tags]) : [];
    const sourceType = normalizeTestType(idx.testType >= 0 ? r[idx.testType] : undefined);
    const testType = sourceType ??
      inferTestCaseType({ title, given, when, then, tags });
    const automationStatus =
      normalizeAutomationStatus(
        idx.automationStatus >= 0 ? r[idx.automationStatus] : undefined,
      ) ?? "MANUAL";
    const externalId =
      idx.externalId >= 0
        ? (r[idx.externalId] ?? "").trim() || undefined
        : undefined;

    // Context follows immutable source rows, not the state of the case editor.
    // Adding a heading/note as a case must not silently regroup later cases
    // whose displayed preview has not changed. Per-case path/note edits below
    // still win over this proposal, and column remapping re-runs the analysis.
    const sourceIdentityOnly = !(r[idx.title] ?? "").trim() &&
      (tags.length > 0 || Boolean(externalId)) && !given.length && !when.length && !then.length &&
      r.every((cell, index) => !cell.trim() || index === idx.tags || index === idx.externalId);
    const sourceLabel = sourceIdentityOnly ? (r[idx.tags]?.trim() || r[idx.externalId]?.trim() || "") : "";
    const sourceKind = !sourceLabel || titleLike(sourceLabel) ? undefined :
      /^(?:tc|test[-_ ]?case)[-_ ]?\d+$/i.test(sourceLabel) ? "PLACEHOLDER" :
        /^(?:continuing\b|based on\b|note\s*:|the expected behavior\b)/i.test(sourceLabel) ? "NOTE" : "SECTION";
    if (sourceKind === "SECTION") {
      if (/^(?:workflow\b|edge cases\b)/i.test(sourceLabel)) { workflow = sourceLabel; section = ""; sourceNotes = []; }
      else section = sourceLabel;
    } else if (sourceKind === "NOTE") sourceNotes = [...sourceNotes, sourceLabel];

    let candidate: MappedRow = {
      rowNumber,
      title,
      given: override?.given ?? given,
      when: override?.when ?? when,
      then: override?.then ?? then,
      priority: override?.priority ?? priority,
      tags: override?.tags ?? tags,
      testType: override?.testType ?? testType,
      typeOrigin: override?.typeOrigin === "REVIEWER" ? "REVIEWER" : sourceType ? "SOURCE" : "UNCLASSIFIED",
      automationStatus: override?.automationStatus ?? automationStatus,
      externalId: override?.externalId ?? externalId,
      ...(override?.suitePath !== undefined ? { suitePath: override.suitePath } : {}),
      ...(override?.background !== undefined ? { background: override.background } : {}),
    };
    const reviewReasons: string[] = [];
    let originalLayout: MappedRow | undefined;
    if (alternateShape(r) &&
      (titleLike(r[idx.tags] ?? "") || supportedAlternateLayout)) {
      if (!override) {
        originalLayout = candidate;
        candidate = { ...candidate, title: r[idx.tags]!.trim(), tags: [], given: [],
          when: preserveProcedureCell(r[idx.title]), then: preserveProcedureCell(r[idx.given]) };
      }
      reviewReasons.push("Alternate row layout detected; verify the case name, actions and expected result.");
    }
    if (!candidate.title) {
      // Sheets often interleave grouping headings, prose notes in the ID
      // column, and unused ID-only placeholders. Classify only when there is
      // NO definition content in any other source column, including unmapped
      // columns. Keep genuine missing-title procedures in the repair workflow.
      const identityOnly = (candidate.tags.length > 0 || Boolean(candidate.externalId)) &&
        candidate.given.length === 0 && candidate.when.length === 0 && candidate.then.length === 0 &&
        r.every((cell, index) => !cell.trim() || index === idx.tags || index === idx.externalId);
      if (identityOnly) {
        const label = (r[idx.tags]?.trim() || r[idx.externalId]?.trim() || "");
        // A descriptive assertion in a misplaced identity column is still a
        // possible case, not a section. Do not invent its missing procedure.
        if (titleLike(label)) {
          candidate = { ...candidate, title: label, tags: [], externalId: undefined };
          reviewReasons.push("Case name proposed from a misplaced label; procedure is not recorded.");
        } else {
          const kind = sourceKind ?? (/^(?:tc|test[-_ ]?case)[-_ ]?\d+$/i.test(label) ? "PLACEHOLDER" :
            /^(?:continuing\b|based on\b|note\s*:|the expected behavior\b)/i.test(label) ? "NOTE" : "SECTION");
          const path = [workflow, section].filter(Boolean).join(" / ");
          nonCaseRows.push({ ...candidate, sourceRowKind: kind,
            ...(path ? { suitePath: path } : {}),
            reviewReasons: [kind === "SECTION" ? "Proposed section for following cases; verify grouping." :
              kind === "NOTE" ? "Preserved as source context, not a standalone case." : "ID only; no case name or definition was provided."] });
          skipped.push({ rowNumber, reason: kind === "SECTION" ? "preserved as proposed section context; not a standalone case" :
            kind === "NOTE" ? "preserved as source note; not a standalone case" : "ID-only placeholder; no test-case definition" });
          return;
        }
      }
      if (!candidate.title) {
        const incompletePath = [workflow, section].filter(Boolean).join(" / ");
        if (incompletePath && override?.suitePath === undefined) candidate.suitePath = incompletePath;
        if (sourceNotes.length && override?.background === undefined) candidate.background = sourceNotes.join("\n\n");
        skipped.push({ rowNumber, reason: "missing title" });
        incompleteRows.push(candidate);
        return;
      }
    }
    const path = [workflow, section].filter(Boolean).join(" / ");
    if (path && override?.suitePath === undefined) candidate.suitePath = path;
    if (candidate.suitePath) reviewReasons.push("Section grouping was inferred from a preceding source heading.");
    if (sourceNotes.length && override?.background === undefined) candidate.background = sourceNotes.join("\n\n");
    candidate.typeOrigin = override?.typeOrigin === "REVIEWER" ? "REVIEWER" : sourceType ? "SOURCE" : "UNCLASSIFIED";
    if (!sourceType) {
      const reviewerType = override?.testType && (override.typeOrigin === "REVIEWER" || override.typeOrigin === undefined);
      if (!reviewerType) {
        const recommendation = recommendTestCaseType(candidate);
        candidate.testType = recommendation.testType;
        candidate.typeRecommendation = recommendation.reason;
      } else { candidate.typeOrigin = "REVIEWER"; candidate.typeRecommendation = "Reviewer-selected type; not provided by the source."; }
      reviewReasons.push(reviewerType ? "Test type selected by the reviewer; no recognized source type was provided." :
        idx.testType >= 0 && r[idx.testType]?.trim() ?
          `Unrecognized source type “${r[idx.testType]!.trim()}”; recommended from case text.` : "Test type recommended from case text; no source type was provided.");
    }
    if (reviewReasons.length) candidate.reviewReasons = reviewReasons;
    if (originalLayout) rowMappingSuggestions.push({ original: { ...originalLayout,
      ...(candidate.suitePath ? { suitePath: candidate.suitePath } : {}),
      ...(candidate.background ? { background: candidate.background } : {}),
    }, proposed: candidate });
    if (reviewReasons.length) recommendations.push(candidate);
    mapped.push(candidate);
  });

  return { rows: mapped, skipped, incompleteRows, ...(nonCaseRows.length ? { nonCaseRows } : {}),
    ...(rowMappingSuggestions.length ? { rowMappingSuggestions } : {}),
    ...(recommendations.length ? { recommendations } : {}) };
}
