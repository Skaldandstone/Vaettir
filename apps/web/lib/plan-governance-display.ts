/** Labels only; never infer a verdict or reconstruct a missing historic row. */
export function governanceOperationLabel(operation: string): string {
  const labels: Record<string, string> = {
    EDIT_CRITERION_DESCRIPTION: "Criterion wording",
    SET_CRITERION_VERDICT: "Criterion verdict",
    ATTACH_UNASSIGNED_PLAN: "Plan attachment",
    DETACH_ATTACHED_PLAN: "Plan detachment",
    ADD_CRITERION: "Criterion added",
    DELETE_CRITERION: "Criterion removed",
    SET_CRITERION_REQUIREMENT: "Requirement association",
    EDIT_PLAN_HEADER: "Plan name and description",
    SET_PLAN_STATUS: "Plan lifecycle status",
    EDIT_PLAN_CUSTOM_FIELDS: "Declared plan fields",
  };
  return labels[operation] ?? "Unsupported governance operation";
}
export function governanceMetadataValue(raw: unknown, key: string): string {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || !Object.hasOwn(raw, key)) return "Unset (key absent)";
  const value = (raw as Record<string, unknown>)[key];
  return value === null ? "Explicit NULL" : value === "" ? 'Empty text ("")' : JSON.stringify(value, null, 2) ?? "Unsupported retained value";
}
export function governanceHeaderDescription(value: string | null): string {
  return value === null ? "No description (NULL)" : value === "" ? "Empty description" : value;
}
export function governanceCriterionValue(
  criteria: Array<{ id: string; description: string; status: string; requirementId: string | null }>,
  criterionId: string,
  operation: string,
): string {
  const criterion = criteria.find(row => row.id === criterionId);
  if (!criterion) return "Not present in this snapshot";
  if (operation === "SET_CRITERION_VERDICT") return criterion.status;
  if (operation === "SET_CRITERION_REQUIREMENT") return criterion.requirementId === null ? "Unlinked" : `Requirement ID: ${criterion.requirementId}`;
  return criterion.description === "" ? "Empty wording" : criterion.description;
}
