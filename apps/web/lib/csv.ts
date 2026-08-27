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
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
