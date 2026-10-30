import { createHash } from "node:crypto";
import { z } from "@vaettir/core/dist/validation.js";
import { mapCsvRows, splitCsvRows, TARGET_FIELDS, TEST_CASE_TYPES, AUTOMATION_STATUSES } from "./csvFieldMapping.js";

const cell = z.string().max(16_384);
export const mappingCandidateSchema = z.object({
  rowNumber: z.number().int().min(2).max(2501), title: cell,
  given: z.array(cell).max(500), when: z.array(cell).max(500), then: z.array(cell).max(500),
  priority: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]), tags: z.array(cell).max(100),
  testType: z.enum(TEST_CASE_TYPES), automationStatus: z.enum(AUTOMATION_STATUSES),
  externalId: cell.optional(), suitePath: cell.optional(), background: cell.optional(),
  typeOrigin: z.enum(["SOURCE", "UNCLASSIFIED", "REVIEWER", "SEMANTIC"]).optional(),
  sourceRowKind: z.enum(["SECTION", "NOTE", "PLACEHOLDER"]).optional(),
  reviewReasons: z.array(cell).max(100).optional(), typeRecommendation: cell.optional(),
}).strict();
export const mappingFieldsSchema = z.partialRecord(z.enum(TARGET_FIELDS), cell);
export const mappingSheetSchema = z.object({
  name: z.string().max(1000), csvText: z.string().min(1).max(1024 * 1024),
  mapping: mappingFieldsSchema,
  overrides: z.array(mappingCandidateSchema.partial().extend({ rowNumber: z.number().int().min(2).max(2501) })).max(2500).default([]),
  originalRowNumbers: z.array(z.number().int().min(1).max(1048576)).max(2501).optional(),
  // Supplied by the authenticated source adapter, never a case match from text.
  source: z.object({ spreadsheetId: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/), sheetId: z.number().int().nonnegative() }).strict().optional(),
}).strict();
export type MappingSheet = z.infer<typeof mappingSheetSchema>;
export type MappingCandidate = z.infer<typeof mappingCandidateSchema>;
export type PlannedMappingRow = {
  sheet: string; rowNumber: number; originalRowNumber: number;
  candidate: MappingCandidate; status: "READY" | "MAPPING" | "CONTEXT";
  reasons: string[]; original: { headers: string[]; cells: string[] };
  hasHistoricalColumns: boolean; keyPrefix: string; externalIdPrefix: string; framework: string;
};
export const mappingDigest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Classify source rows without making a case, calling AI, or guessing missing fields. */
export function planMappingSheets(raw: MappingSheet[], format: "CSV" | "XLSX" | "SHEETS") {
  const sheets = z.array(mappingSheetSchema).min(1).max(20).parse(raw);
  if (sheets.reduce((n, s) => n + Buffer.byteLength(s.csvText, "utf8"), 0) > 1024 * 1024)
    throw new Error("Choose at most 1 MiB of source tables.");
  if (new Set(sheets.map(s => s.name)).size !== sheets.length) throw new Error("Worksheet names must be unique.");
  if (format === "SHEETS" && (sheets.some(s => !s.source || s.source.spreadsheetId !== sheets[0]?.source?.spreadsheetId)
    || new Set(sheets.map(s => s.source?.sheetId)).size !== sheets.length)) throw new Error("Select unique tabs from one spreadsheet.");
  const planned: PlannedMappingRow[] = [];
  for (const sheet of sheets) {
    const physical = splitCsvRows(sheet.csvText, true);
    const nonempty = physical.flatMap((cells, index) => cells.some(c => c.trim()) ? [{ cells, index }] : []);
    const headers = (nonempty[0]?.cells ?? []).map(c => c.trim());
    if (!headers.length || headers.length > 256 || nonempty.length > 2501 || physical.length > 2501)
      throw new Error("Choose a table with at most 2,500 rows and 256 columns.");
    if (physical.some(row => row.some(c => c.length > 16_384) || row.length > 256)) throw new Error("A source row exceeds the supported limit.");
    if (sheet.originalRowNumbers && sheet.originalRowNumbers.length !== physical.length) throw new Error("Original worksheet coordinates do not match the source.");
    const safeMapping = { ...sheet.mapping };
    const mappingProblems: string[] = [];
    for (const field of TARGET_FIELDS) {
      const column = safeMapping[field];
      if (column && headers.filter(h => h === column.trim()).length !== 1) {
        delete safeMapping[field]; mappingProblems.push(`Choose an unambiguous ${field} column.`);
      }
    }
    const rows = mapCsvRows(sheet.csvText, safeMapping, undefined, sheet.overrides);
    const incomplete = new Set(rows.incompleteRows.map(r => r.rowNumber));
    const context = new Set(rows.nonCaseRows?.map(r => r.rowNumber));
    const alternate = new Set(rows.rowMappingSuggestions?.map(r => r.proposed.rowNumber));
    const all = [...rows.rows, ...rows.incompleteRows, ...(rows.nonCaseRows ?? [])].sort((a,b) => a.rowNumber-b.rowNumber);
    const counts = new Map<string, number>();
    for (const r of all) if (r.externalId && !context.has(r.rowNumber)) counts.set(r.externalId, (counts.get(r.externalId) ?? 0) + 1);
    const hasHistoricalColumns = headers.some(h => /^(?:(?:test|execution|actual)\s+)?(?:result|status)(?:\s*\d+)?$/i.test(h));
    for (const row of all) {
      const source = nonempty[row.rowNumber - 1];
      if (!source) throw new Error("Source row could not be retained.");
      const reasons: string[] = [...mappingProblems];
      if (incomplete.has(row.rowNumber) || !sheet.mapping.title) reasons.push("Map a case title.");
      if (alternate.has(row.rowNumber)) reasons.push("Confirm the proposed row layout.");
      if ((row.externalId && (counts.get(row.externalId) ?? 0) > 1)) reasons.push("Resolve duplicate source IDs.");
      if (format === "SHEETS" && (!sheet.mapping.externalId || !row.externalId)) reasons.push("Map a stable case ID.");
      const candidate = mappingCandidateSchema.parse(row);
      if (format !== "CSV") {
        candidate.suitePath = [sheet.name, candidate.suitePath].filter(Boolean).join(" / ");
      }
      planned.push({ sheet: sheet.name, rowNumber: row.rowNumber, originalRowNumber: sheet.originalRowNumbers?.[source.index] ?? source.index + 1,
        candidate, status: context.has(row.rowNumber) ? "CONTEXT" : reasons.length ? "MAPPING" : "READY", reasons,
        original: { headers, cells: source.cells }, hasHistoricalColumns,
        keyPrefix: format === "SHEETS" ? `google-sheets:${sheet.source!.spreadsheetId}` : format === "XLSX" ? "xlsx" : "csv",
        externalIdPrefix: format === "SHEETS" ? `${sheet.source!.sheetId}:` : format === "XLSX" ? `${sheet.name}:` : "",
        framework: format === "SHEETS" ? "google-sheets" : format.toLowerCase(),
      });
    }
  }
  if (planned.length > 2500) throw new Error("Choose at most 2,500 source rows.");
  return { rows: planned, readyCount: planned.filter(r => r.status === "READY").length,
    pendingCount: planned.filter(r => r.status === "MAPPING").length, contextCount: planned.filter(r => r.status === "CONTEXT").length,
    digest: mappingDigest({ format, sheets, planned }) };
}
