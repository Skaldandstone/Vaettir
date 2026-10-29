import { z } from "@vaettir/core/dist/validation.js";
import { mapCsvRows, type TargetField, type MappedRow, type MappedRowOverride } from "./csvFieldMapping.js";

// Separate from the metadata-only Drive source connection. Browser OAuth uses
// short-lived, per-file tokens; no Google token reaches the Vaettir API or DB.
export function googleSheetsImportConfig(env: Readonly<Record<string, string | undefined>> = process.env) {
  const config = z.object({
    clientId: z.string().regex(/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/),
    apiKey: z.string().regex(/^AIza[A-Za-z0-9_-]{30,100}$/),
    appId: z.string().regex(/^[0-9]{6,30}$/),
  }).safeParse({ clientId: env.GOOGLE_SHEETS_CLIENT_ID, apiKey: env.GOOGLE_SHEETS_PICKER_API_KEY, appId: env.GOOGLE_SHEETS_PROJECT_NUMBER });
  return config.success ? config.data : null;
}

export const googleSheetSourceSchema = z.object({
  spreadsheetId: z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/),
  sheetId: z.number().int().min(0).max(2147483647),
}).strict();

export function googleSheetImportNamespace(source: z.infer<typeof googleSheetSourceSchema>, rows: { externalId?: string }[]) {
  const checked = googleSheetSourceSchema.parse(source);
  const ids = rows.map(row => row.externalId?.trim());
  if (!rows.length || ids.some(id => !id) || new Set(ids).size !== ids.length)
    throw new Error("Map a unique, non-empty case ID for every Google Sheets row before importing. Keep these IDs unchanged when re-importing.");
  return `google-sheets:${checked.spreadsheetId}:${checked.sheetId}`;
}

export function prepareGoogleSheetsImport(sheets: {
  source: z.infer<typeof googleSheetSourceSchema>; name: string; csvText: string;
  mapping: Partial<Record<TargetField, string>>; overrides: MappedRowOverride[];
}[]) {
  if (!sheets.length || sheets.length > 20) throw new Error("Select 1–20 worksheets.");
  if (sheets.reduce((bytes, sheet) => bytes + Buffer.byteLength(sheet.csvText, "utf8"), 0) > 1024 * 1024)
    throw new Error("Selected worksheets exceed the 1 MiB import limit. Choose fewer tabs.");
  const spreadsheetId = sheets[0]!.source.spreadsheetId;
  const seen = new Set<number>();
  const rows: MappedRow[] = [];
  const skipped: { rowNumber: number; reason: string }[] = [];
  const fieldMapping: Record<string, string> = {};
  let offset = 0;
  for (const sheet of sheets) {
    googleSheetSourceSchema.parse(sheet.source);
    if (sheet.source.spreadsheetId !== spreadsheetId || seen.has(sheet.source.sheetId)) throw new Error("Choose unique worksheets from one spreadsheet.");
    seen.add(sheet.source.sheetId);
    if (!sheet.mapping.title || !sheet.mapping.externalId) throw new Error(`${sheet.name}: map title and a stable case ID column.`);
    const mapped = mapCsvRows(sheet.csvText, sheet.mapping, undefined, sheet.overrides);
    if (mapped.incompleteRows.length) throw new Error(`${sheet.name}: complete required titles before importing.`);
    googleSheetImportNamespace(sheet.source, mapped.rows);
    rows.push(...mapped.rows.map(row => ({ ...row,
      externalId: `${sheet.source.sheetId}:${row.externalId!.trim()}`,
      rowNumber: offset + row.rowNumber,
      suitePath: [sheet.name, row.suitePath].filter(Boolean).join(" / "),
    })));
    skipped.push(...mapped.skipped.map(row => ({ rowNumber: offset + row.rowNumber, reason: `${sheet.name}: ${row.reason}` })));
    offset += Math.max(1, ...mapped.rows.map(row => row.rowNumber), ...mapped.skipped.map(row => row.rowNumber));
    fieldMapping[String(sheet.source.sheetId)] = JSON.stringify({ name: sheet.name, mapping: sheet.mapping });
  }
  if (rows.length > 2500) throw new Error("Selected worksheets exceed 2,500 cases. Import fewer worksheets together.");
  return { rows, skipped, fieldMapping, keyPrefix: `google-sheets:${spreadsheetId}`, framework: "google-sheets" };
}
