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
