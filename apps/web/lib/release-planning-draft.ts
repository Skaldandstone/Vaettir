export function releaseCriteriaDraftProblem(values: {
  planName: string;
  criteria: readonly string[];
  criterionDraft: string;
  editingIndex: number | null;
}): string | null {
  if (values.editingIndex !== null)
    return "Save or cancel this criterion edit before continuing.";
  if (values.criterionDraft.trim())
    return values.criteria.length >= 50
      ? "This plan already has 50 criteria. Edit an existing criterion or clear the extra draft to continue."
      : "Add this criterion or clear its draft before continuing.";
  if (values.planName.trim() && !values.criteria.length)
    return "Add at least one criterion for the named plan, or clear the plan name to continue without a new plan.";
  return null;
}
export function saveReleaseCriterionDraft(
  criteria: readonly string[],
  draft: string,
  editingIndex: number | null,
): string[] {
  const description = draft.trim();
  if (!description || description.length > 2000)
    throw Error("A criterion needs between 1 and 2,000 characters.");
  if (editingIndex !== null) {
    if (
      !Number.isInteger(editingIndex) ||
      editingIndex < 0 ||
      editingIndex >= criteria.length
    )
      throw Error(
        "The selected criterion is unavailable. Cancel this edit and choose it again.",
      );
    return criteria.map((value, index) =>
      index === editingIndex ? description : value,
    );
  }
  if (criteria.length >= 50)
    throw Error(
      "A plan supports up to 50 criteria. Edit an existing criterion or clear this draft.",
    );
  return [...criteria, description];
}
export function releasePlanChoices<T extends { releaseId: string | null }>(
  plans: readonly T[],
  releaseId: string,
) {
  return {
    available: plans.filter((plan) => plan.releaseId === null),
    assignedElsewhere: plans.filter(
      (plan) => plan.releaseId !== null && plan.releaseId !== releaseId,
    ),
  };
}
