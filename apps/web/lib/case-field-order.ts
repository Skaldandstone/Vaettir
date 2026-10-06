/** Presentation order only. Retain exact definitions/options by reference;
 * review and saving remain separate caller-owned actions. */
export function reorderCaseFieldDraft<T extends { key: string }>(fields: readonly T[], key: string, direction: "UP" | "DOWN"): T[] | null {
  if (fields.length > 20 || !["UP", "DOWN"].includes(direction) || new Set(fields.map(field => field.key)).size !== fields.length || fields.some(field => !/^[a-z][a-z0-9_]{0,39}$/.test(field.key) || ["constructor", "prototype", "__proto__"].includes(field.key))) return null;
  const from = fields.findIndex(field => field.key === key);
  const to = from + (direction === "UP" ? -1 : 1);
  if (from < 0 || to < 0 || to >= fields.length) return null;
  const ordered = [...fields];
  [ordered[from], ordered[to]] = [ordered[to]!, ordered[from]!];
  return ordered;
}
