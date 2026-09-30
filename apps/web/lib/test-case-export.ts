/** Capture the visible order; stale selections must never expand export scope. */
export function caseExportIds(
  visible: ReadonlyArray<{ id: string }>,
  selected: ReadonlySet<string>,
  scope: "filtered" | "selected",
): string[] {
  return [...new Set(visible.filter((row) => scope === "filtered" || selected.has(row.id)).map((row) => row.id))];
}

/** Identity, not title, matters: separate cases can have identical names. */
export function scopeCaseExport<T extends { id: string }>(rows: readonly T[], ids: readonly string[]): T[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.map((id) => {
    const row = byId.get(id);
    if (!row) throw new Error("The case list changed during export. Refresh the list and try again; no file was downloaded.");
    return row;
  });
}

/** Quoting alone does not stop spreadsheet formulas. Preserve display as text. */
export function spreadsheetText(value: string): string {
  const normalized = value.replace(/\r\n?/g, "\n");
  return /^[\s]*[=+@-]/u.test(normalized) || /^[\t\n]/u.test(normalized)
    ? `'${normalized}`
    : normalized;
}
