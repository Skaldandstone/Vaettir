export type StrategyList = { kind: "missing" | "supported"; items: string[]; raw: unknown } | { kind: "retained"; raw: unknown };
export function qaStrategyList(values: Record<string, unknown>, key: string): StrategyList {
  if (!Object.hasOwn(values, key)) return { kind: "missing", items: [], raw: undefined };
  const raw = values[key];
  return Array.isArray(raw) && raw.every(value => typeof value === "string") ? { kind: "supported", items: raw, raw } : { kind: "retained", raw };
}
export type StrategyRow = { id: string; value: string };
export function strategyRows(values: string[], newId: () => string): StrategyRow[] { return values.map(value => ({ id: newId(), value })); }
export function sameStrategyRowValues(rows: StrategyRow[], values: string[]): boolean { return rows.length === values.length && rows.every((row, index) => row.value === values[index]); }
export function editStrategyRow(rows: StrategyRow[], id: string, value: string): StrategyRow[] {
  if (!rows.some(row => row.id === id)) throw Error("The exact strategy row is no longer present.");
  return rows.map(row => row.id === id ? { ...row, value } : row);
}
export function removeStrategyRow(rows: StrategyRow[], id: string): StrategyRow[] {
  if (!rows.some(row => row.id === id)) throw Error("The exact strategy row is no longer present.");
  return rows.filter(row => row.id !== id);
}
/** A retained current-props check, not a permission token or version CAS. */
export function qaStrategyFingerprint(projectId: string, values: Record<string, unknown>): string { return JSON.stringify({ projectId, values }); }
export type StrategySuggestionScope = { ready: boolean; fingerprint: string; actorId: string | null | undefined; sessionId: string | null | undefined; generation: number };
export function sameStrategySuggestionScope(original: StrategySuggestionScope, current: StrategySuggestionScope): boolean {
  return original.ready && current.ready && !!original.actorId && !!original.sessionId && original.fingerprint === current.fingerprint && original.actorId === current.actorId && original.sessionId === current.sessionId && original.generation === current.generation;
}
