/** A deliberate correction moves a source column instead of importing it into
 * two roles. The server still checks that every confirmed column exists and
 * that preview/commit share the exact mapping. No source content is rewritten.
 */
type ImportTargetField = "title" | "given" | "when" | "then" | "priority" | "tags" | "testType" | "automationStatus" | "externalId";

export function reassignImportColumn(
  mapping: Partial<Record<ImportTargetField, string>>,
  field: ImportTargetField,
  column: string,
): Partial<Record<ImportTargetField, string>> {
  const next = { ...mapping, [field]: column || undefined };
  if (column) {
    for (const key of Object.keys(next) as ImportTargetField[]) {
      if (key !== field && next[key] === column) delete next[key];
    }
  }
  return next;
}

export function remainingNonCaseRows<T extends { rowNumber: number }>(
  rows: T[] | undefined,
  overrides: Record<number, { title: string }>,
): T[] {
  return (rows ?? []).filter(row => !overrides[row.rowNumber]?.title.trim());
}

/** Seeded repair rows are display defaults, not deliberate edits. Keep actual
 * edits while allowing a reviewed column correction to repair missing fields. */
export function editedImportOverrides<T extends { rowNumber: number }>(overrides: Record<number, T>, seeded: T[] | undefined): T[] {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])) : value;
  const before = new Map((seeded ?? []).map(row => [row.rowNumber, JSON.stringify(canonical(row))]));
  return Object.values(overrides).filter(row => JSON.stringify(canonical(row)) !== before.get(row.rowNumber));
}

export function suggestedImportMapping(mapping: Partial<Record<ImportTargetField, string>>, choices: Array<{ field: ImportTargetField; column: string }>): Partial<Record<ImportTargetField, string>> {
  return choices.reduce((next, choice) => reassignImportColumn(next, choice.field, choice.column), { ...mapping });
}
