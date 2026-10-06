/** Inspect native JSON without replacing a retained NULL/array/scalar with {}. */
export function planMetadataRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) ? value as Record<string, unknown> : null;
}
export function planMetadataChanges(current: unknown, previous: unknown): string[] {
  const next = planMetadataRecord(current), prior = planMetadataRecord(previous);
  if (!next || !prior) return JSON.stringify(current) === JSON.stringify(previous) ? [] : ["Retained root metadata changed"];
  const changes: string[] = [];
  for (const key of new Set([...Object.keys(next), ...Object.keys(prior)])) {
    if (!Object.hasOwn(prior, key)) changes.push(`${key} added`);
    else if (!Object.hasOwn(next, key)) changes.push(`${key} removed`);
    else if (JSON.stringify(next[key]) !== JSON.stringify(prior[key])) changes.push(`${key} changed`);
  }
  return changes;
}
/** Untouched or unsupported root metadata is never echoed by a status save. */
export function legacyPlanMetadataPatch(saved: unknown, edited: Record<string, unknown> | undefined): { customFields?: Record<string, unknown> } {
  if (edited === undefined) return {};
  if (!planMetadataRecord(saved)) throw Error("Retained non-object plan metadata is read-only and cannot be replaced by a legacy save.");
  return { customFields: edited };
}
