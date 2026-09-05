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
export const TARGET_FIELDS = ["title", "given", "when", "then", "priority", "tags", "externalId"] as const;
export type TargetField = (typeof TARGET_FIELDS)[number];

const HEADER_ALIASES: Record<TargetField, string[]> = {
  title: ["title", "name", "test case", "test title", "summary"],
  given: ["given", "precondition", "preconditions", "setup"],
  when: ["when", "action", "actions", "steps"],
  then: ["then", "expected", "expected result", "expected results"],
  priority: ["priority", "severity"],
  tags: ["tags", "labels", "categories"],
  externalId: [],
};

const VALID_PRIORITIES = new Set(["CRITICAL", "HIGH", "MEDIUM", "LOW"]);

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
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface CsvHeaders {
  headers: string[];
  suggestedMapping: Partial<Record<TargetField, string>>;
  rowCount: number;
}

export function inspectCsv(text: string): CsvHeaders {
  const rows = splitCsvRows(text);
  const headers = (rows[0] ?? []).map((h) => h.trim());
  const lowerHeaders = headers.map((h) => h.toLowerCase());

  const suggestedMapping: Partial<Record<TargetField, string>> = {};
  for (const field of TARGET_FIELDS) {
    const alias = HEADER_ALIASES[field].find((a) => lowerHeaders.includes(a));
    if (alias) suggestedMapping[field] = headers[lowerHeaders.indexOf(alias)];
  }

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
  externalId?: string;
}

export interface MapCsvResult {
  rows: MappedRow[];
  skipped: { rowNumber: number; reason: string }[];
}

// Applies a CONFIRMED mapping (source column header -> target field) to
// every data row. Used both for the preview (a small slice, `limit`) and
// the real commit (no limit) so the two can never disagree about what a
// given mapping produces.
export function mapCsvRows(text: string, mapping: Partial<Record<TargetField, string>>, limit?: number): MapCsvResult {
  const rows = splitCsvRows(text);
  if (rows.length < 2) return { rows: [], skipped: [] };
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
    externalId: colIndex("externalId"),
  };
  if (idx.title === -1) {
    throw new Error('The "title" field must be mapped to a CSV column');
  }

  const mapped: MappedRow[] = [];
  const skipped: { rowNumber: number; reason: string }[] = [];
  const dataRows = limit ? rows.slice(1, 1 + limit) : rows.slice(1);

  dataRows.forEach((r, i) => {
    const rowNumber = i + 2;
    const title = (r[idx.title] ?? "").trim();
    if (!title) {
      skipped.push({ rowNumber, reason: "missing title" });
      return;
    }
    const given = idx.given >= 0 ? splitMultiValue(r[idx.given]) : [];
    const when = idx.when >= 0 ? splitMultiValue(r[idx.when]) : [];
    const then = idx.then >= 0 ? splitMultiValue(r[idx.then]) : [];
    const rawPriority = (idx.priority >= 0 ? r[idx.priority] : "")?.trim().toUpperCase();
    const priority = (VALID_PRIORITIES.has(rawPriority ?? "") ? rawPriority : "MEDIUM") as MappedRow["priority"];
    const tags = idx.tags >= 0 ? splitMultiValue(r[idx.tags]) : [];
    const externalId = idx.externalId >= 0 ? (r[idx.externalId] ?? "").trim() || undefined : undefined;

    mapped.push({ rowNumber, title, given, when, then, priority, tags, externalId });
  });

  return { rows: mapped, skipped };
}
