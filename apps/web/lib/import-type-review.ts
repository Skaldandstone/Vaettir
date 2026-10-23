// Shared pure presentation/input helpers. They neither infer a type nor modify
// an uploaded source. The server binds its recommendations to the same fields.
export type TypeReviewCase = { id: string; title: string; given: string[]; when: string[]; then: string[]; tags: string[]; background?: string; suitePath?: string };
export const importTypeId = (sheet: string, rowNumber: number) => JSON.stringify([sheet, rowNumber]);
export function typeReviewCase(sheet: string, row: Omit<TypeReviewCase, "id"> & { rowNumber: number }): TypeReviewCase {
  return { id: importTypeId(sheet, row.rowNumber), title: row.title, given: row.given, when: row.when, then: row.then, tags: row.tags,
    ...(row.background ? { background: row.background } : {}), ...(row.suitePath ? { suitePath: row.suitePath } : {}) };
}
export function typeReviewLabel(type: string, origin?: string) {
  return type === "OTHER" && origin === "UNCLASSIFIED" ? "Unclassified · For review" : type.replaceAll("_", " ").toLowerCase().replace(/^./, c => c.toUpperCase());
}
export function importReviewRows<T extends { rowNumber: number }>(rows: T[] | undefined, overrides: Record<number, T>): T[] {
  const merged = new Map((rows ?? []).map(row => [row.rowNumber, row]));
  for (const row of Object.values(overrides)) merged.set(row.rowNumber, row);
  return [...merged.values()].sort((a, b) => a.rowNumber - b.rowNumber);
}
