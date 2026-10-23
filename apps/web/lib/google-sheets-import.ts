// All provider content reads stay in the customer's browser. Never accept a
// provider URL, store a token, or send Google credentials to Vaettir/telemetry.
export const GOOGLE_SHEETS_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const GOOGLE_SHEET_MIME = "application/vnd.google-apps.spreadsheet";
const MAX_BYTES = 1024 * 1024;
const MAX_ROWS = 2501; // Header + the existing 2,500-case commit limit.
const MAX_COLUMNS = 100;

export interface SheetTab { id: number; title: string; rows: number; columns: number }
export interface SheetBook { id: string; title: string; tabs: SheetTab[] }
export interface GoogleSheetSnapshot { csvText: string; label: string; source: { spreadsheetId: string; sheetId: number } }

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Unexpected Google Sheets response.");
  return value as Record<string, unknown>;
}
export function sheetId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(value)) throw new Error("Choose a valid Google spreadsheet.");
  return value;
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 1000 || Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) throw new Error("Unexpected Google Sheets label.");
  return value;
}
export function parseSheetBook(id: string, value: unknown): SheetBook {
  const book = object(value);
  if (book.spreadsheetId !== sheetId(id)) throw new Error("Google returned a different spreadsheet.");
  if (!Array.isArray(book.sheets) || !book.sheets.length || book.sheets.length > 200) throw new Error("Choose a workbook with 1–200 worksheets.");
  const tabs = book.sheets.flatMap(value => {
    const p = object(object(value).properties);
    if (p.sheetType !== "GRID") return [];
    const grid = object(p.gridProperties);
    if (!Number.isInteger(p.sheetId) || Number(p.sheetId) < 0 || Number(p.sheetId) > 2147483647 ||
      !Number.isInteger(grid.rowCount) || Number(grid.rowCount) < 1 ||
      !Number.isInteger(grid.columnCount) || Number(grid.columnCount) < 1) throw new Error("Unexpected worksheet dimensions.");
    return [{ id: Number(p.sheetId), title: text(p.title), rows: Number(grid.rowCount), columns: Number(grid.columnCount) }];
  });
  if (!tabs.length || new Set(tabs.map(tab => tab.id)).size !== tabs.length) throw new Error("Choose a workbook with unique grid worksheets.");
  return { id, title: text(object(book.properties).title), tabs };
}
export function worksheetRange(tab: SheetTab) {
  // Read the full selected tab, with a streaming byte/deadline limit below.
  // Google omits trailing empty cells; a range cap could silently omit content.
  return `'${tab.title.replace(/'/g, "''")}'`;
}
export function sheetValuesCsv(value: unknown): string {
  const rows = object(value).values;
  if (!Array.isArray(rows) || rows.length < 2 || rows.length > MAX_ROWS) throw new Error("Choose a sheet with a header and 1–2,500 case rows.");
  const csv = rows.map(row => {
    if (!Array.isArray(row) || row.length > MAX_COLUMNS) throw new Error("Sheets import supports up to 100 columns. Select a smaller sheet.");
    return row.map(cell => {
      if (typeof cell !== "string" && typeof cell !== "number" && typeof cell !== "boolean") throw new Error("Unexpected cell value.");
      return `"${String(cell).replace(/"/g, '""')}"`;
    }).join(",");
  }).join("\r\n");
  if (new TextEncoder().encode(csv).length > MAX_BYTES) throw new Error("Sheet exceeds the 1 MiB import limit.");
  return csv;
}
export function validSheetToken(response: { access_token?: string; scope?: string; expires_in?: number | string; error?: string }): string {
  if (response.error || response.scope !== GOOGLE_SHEETS_SCOPE ||
    typeof response.access_token !== "string" || !/^[\x21-\x7e]{1,10000}$/.test(response.access_token) ||
    !Number.isFinite(Number(response.expires_in)) || Number(response.expires_in) < 30 || Number(response.expires_in) > 86400)
    throw new Error("Google did not grant the selected-file permission. Authorize again to continue.");
  return response.access_token;
}

async function sheetJson(id: string, suffix: string, token: string, signal: AbortSignal): Promise<unknown> {
  sheetId(id);
  const deadline = AbortSignal.timeout(15000);
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}${suffix}`, {
    method: "GET", headers: { Authorization: `Bearer ${token}` },
    credentials: "omit", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer",
    signal: AbortSignal.any([signal, deadline]),
  });
  if (!response.ok) throw new Error("Google Sheets could not read this selection. Check your access, or authorize again.");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Google Sheets returned an empty response.");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw new Error("Sheet exceeds the 1 MiB import limit.");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  const data = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(data)); }
  catch { throw new Error("Google Sheets returned an unreadable response."); }
}
export async function readSheetBook(id: string, token: string, signal: AbortSignal) {
  return parseSheetBook(id, await sheetJson(id, "?fields=spreadsheetId,properties(title),sheets(properties(sheetId,title,sheetType,gridProperties(rowCount,columnCount)))", token, signal));
}
export async function readSheetSnapshot(book: SheetBook, tab: SheetTab, token: string, signal: AbortSignal): Promise<GoogleSheetSnapshot> {
  if (!book.tabs.some(allowed => allowed.id === tab.id && allowed.title === tab.title)) throw new Error("Choose a worksheet from the selected spreadsheet.");
  const range = encodeURIComponent(worksheetRange(tab));
  const value = await sheetJson(book.id, `/values/${range}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`, token, signal);
  return { csvText: sheetValuesCsv(value), label: `Google Sheets · ${book.title} / ${tab.title}`, source: { spreadsheetId: book.id, sheetId: tab.id } };
}
