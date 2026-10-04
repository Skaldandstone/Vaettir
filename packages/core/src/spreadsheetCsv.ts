export type SpreadsheetCsvCell = string | number;
const MAX_CELL_BYTES = 32768;
const MAX_FILE_BYTES = 1024 * 1024;
const encoder = new TextEncoder();

function cell(value: SpreadsheetCsvCell) {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER)
      throw new Error(
        "An unsupported recorded numeric value cannot be exported.",
      );
    return `"${String(value)}"`;
  }
  if (encoder.encode(value).length > MAX_CELL_BYTES)
    throw new Error("A retained text cell exceeds the supported CSV size.");
  for (let index = 0; index < value.length; index++) {
    const code = value.codePointAt(index)!;
    if (code >= 0xd800 && code <= 0xdfff)
      throw new Error("A retained text cell contains unsupported Unicode.");
    if ((code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127)
      throw new Error(
        "A retained text cell contains unsupported control characters.",
      );
    if (code > 0xffff) index++;
  }
  const dangerous = /^[\t\r\n]/u.test(value) || /^\s*[=+\-@]/u.test(value);
  const text = dangerous ? `'${value}` : value;
  return `"${text.replaceAll('"', '""')}"`;
}

/**
 * Fixed comma dialect, UTF-8 BOM, CRLF rows and bounded whole-file construction.
 * Text formula protection uses an apostrophe; numeric cells must be explicitly
 * supplied as numbers, not inferred. Re-saving/import settings can remove text
 * protections. This helper does not authorize recipients or validate evidence.
 */
export function renderBoundedSpreadsheetCsv(
  headers: string[],
  rows: SpreadsheetCsvCell[][],
  maxRows = 1000,
) {
  if (
    !Number.isInteger(maxRows) ||
    maxRows < 1 ||
    maxRows > 1100 ||
    !headers.length ||
    headers.length > 30
  )
    throw new Error("The requested CSV shape is unsupported.");
  if (rows.length > maxRows)
    throw new Error("The supported aggregate CSV row limit was exceeded.");
  if (rows.some((row) => row.length !== headers.length))
    throw new Error("An unsupported aggregate row cannot be exported.");
  const value =
    "\uFEFF" +
    [headers, ...rows].map((row) => row.map(cell).join(",")).join("\r\n") +
    "\r\n";
  if (encoder.encode(value).length > MAX_FILE_BYTES)
    throw new Error("This aggregate CSV exceeds the supported one MiB size.");
  return value;
}
