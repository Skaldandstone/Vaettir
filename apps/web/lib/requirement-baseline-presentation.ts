// Presentation only: never changes captured wording, membership or evidence.
export const baselineWordingFields = [
  ["title", "Title"], ["description", "Description"], ["externalRef", "External reference"],
  ["externalRefWithheld", "External reference withheld"], ["linearIssueId", "Linear identifier"],
  ["jiraIssueKey", "Jira identifier"], ["issueIdentifiersWithheld", "Issue identifiers withheld"],
] as const;
type WordingField = typeof baselineWordingFields[number][0];
type Wording = Record<WordingField, string | boolean | null>;
export function groupBaselineWording(before: Wording | null, current: Wording | null, changedFields: readonly string[]) {
  const rows = baselineWordingFields.map(([field, caption]) => ({ field, caption,
    before: before ? before[field] : undefined, current: current ? current[field] : undefined }));
  return {
    changed: before && current ? rows.filter(row => changedFields.includes(row.field)) : [],
    unchanged: before && current ? rows.filter(row => !changedFields.includes(row.field)) : [],
    uncomparable: before && current ? [] : rows,
    unsupportedChanges: changedFields.filter(field => !baselineWordingFields.some(([known]) => known === field)),
  };
}
export function baselineWordingValue(value: string | boolean | null | undefined, side: "captured" | "current") {
  if (value === undefined) return side === "captured" ? "No captured baseline" : "Current requirement unavailable";
  if (value === null) return "Not recorded";
  if (typeof value === "boolean") return value ? "Withheld" : "Not withheld";
  return value === "" ? "Recorded empty text" : value;
}
export function baselineLiteralSearch(value: string) { return value.trim(); }
/** Missing sides are unknown, not an empty link population or a change event. */
export function baselineDirectLinkComparison(capturedAvailable: boolean, currentAvailable: boolean, changed: boolean) {
  if (!capturedAvailable && !currentAvailable) return "Direct relationship comparison unavailable: neither side is recorded.";
  if (!capturedAvailable) return "No captured baseline: current direct links are recorded, but additions or removals cannot be compared.";
  if (!currentAvailable) return "Current requirement unavailable: captured direct links are retained, but removals cannot be established.";
  return changed ? "Direct relationship or recorded label scope changed." : "No direct link change detected in the recorded scope.";
}
export function baselineCaseRelationshipLabel(item: { wasLinked: boolean; isLinked: boolean }, capturedAvailable: boolean, currentAvailable: boolean) {
  if (!capturedAvailable && !currentAvailable) return "Captured/current relationship comparison unavailable";
  if (!capturedAvailable) return "Current direct link; no captured baseline";
  if (!currentAvailable) return "Captured direct link; current requirement unavailable";
  if (item.wasLinked && item.isLinked) return "Captured and current";
  if (item.wasLinked) return "No longer directly linked";
  if (item.isLinked) return "New direct link";
  return "Not linked in either displayed scope";
}
export function filterBaselineCasePage<T extends { displayId: string; title: string }>(items: readonly T[], search: string): T[] {
  const term = baselineLiteralSearch(search).toLowerCase();
  return items.filter(item => item.displayId.toLowerCase().includes(term) || item.title.toLowerCase().includes(term));
}
export function baselineNativeCaseHref(projectId: string, caseId: string | null, available: boolean) {
  if (!available || !caseId || !projectId || projectId.length > 120 || caseId.length > 120 || /[\u0000-\u001f\u007f]/.test(projectId + caseId)) return null;
  try { return `/projects/${encodeURIComponent(projectId)}/test-cases/${encodeURIComponent(caseId)}`; }
  catch { return null; } // Unsupported native identity never becomes a guessed URL.
}
