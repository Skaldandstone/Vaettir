import { downloadFile } from "./download";

// RFC 4180 CSV field quoting: wrap in double quotes and escape embedded
// quotes whenever the field contains a comma, quote, or newline. Shared
// by every page that offers a CSV download (compliance report export,
// test case export) so the quoting rule can't silently drift between them.
export function csvField(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows.map((row) => row.map(csvField).join(",")).join("\r\n");
  downloadFile(filename, csv, "text/csv");
}
