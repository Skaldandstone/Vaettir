// P11-07: the generic catch-all importer for any spreadsheet-tracked suite
// without a first-class importer (PractiTest, TestLink, or just "we keep
// our cases in a spreadsheet"). Recognizes a fixed set of common header
// names (case-insensitive) rather than a full drag-and-drop field-mapping
// UI (P11-02, a separate ticket) -- title/given/when/then/priority/tags,
// with multi-step cells "|"-delimited, since that's the shape most manual
// test spreadsheets already use in practice.

export interface ParsedCsvTestCase {
  title: string;
  given: string[];
  when: string[];
  then: string[];
  priority: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  tags: string[];
  rowNumber: number;
}

export interface CsvParseResult {
  cases: ParsedCsvTestCase[];
  skipped: { rowNumber: number; reason: string }[];
}

const VALID_PRIORITIES = new Set(["CRITICAL", "HIGH", "MEDIUM", "LOW"]);

// RFC 4180 field/row splitting -- same approach as the compliance page's
// client-side parseControlsCsv, reimplemented here since this runs
// server-side in a mutation, not in the browser.
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

function splitSteps(cell: string | undefined): string[] {
  if (!cell) return [];
  return cell
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parseTestCaseCsv(text: string): CsvParseResult {
  const rows = splitCsvRows(text);
  if (rows.length < 2) return { cases: [], skipped: [] };

  const header = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
  const idx = {
    title: header.indexOf("title"),
    given: header.indexOf("given"),
    when: header.indexOf("when"),
    then: header.indexOf("then"),
    priority: header.indexOf("priority"),
    tags: header.indexOf("tags"),
  };
  if (idx.title === -1) {
    throw new Error('CSV must have a header row with at least a "title" column');
  }

  const cases: ParsedCsvTestCase[] = [];
  const skipped: { rowNumber: number; reason: string }[] = [];

  rows.slice(1).forEach((r, i) => {
    const rowNumber = i + 2; // 1-indexed, +1 for the header row
    const title = (r[idx.title] ?? "").trim();
    if (!title) {
      skipped.push({ rowNumber, reason: "missing title" });
      return;
    }
    const given = splitSteps(idx.given >= 0 ? r[idx.given] : undefined);
    const when = splitSteps(idx.when >= 0 ? r[idx.when] : undefined);
    const then = splitSteps(idx.then >= 0 ? r[idx.then] : undefined);
    if (given.length === 0 || when.length === 0 || then.length === 0) {
      skipped.push({ rowNumber, reason: "missing given/when/then (all three are required, \"|\"-separated for multiple steps)" });
      return;
    }
    const rawPriority = (idx.priority >= 0 ? r[idx.priority] : "")?.trim().toUpperCase();
    const priority = (VALID_PRIORITIES.has(rawPriority ?? "") ? rawPriority : "MEDIUM") as ParsedCsvTestCase["priority"];
    const tags = splitSteps(idx.tags >= 0 ? r[idx.tags] : undefined);

    cases.push({ title, given, when, then, priority, tags, rowNumber });
  });

  return { cases, skipped };
}
