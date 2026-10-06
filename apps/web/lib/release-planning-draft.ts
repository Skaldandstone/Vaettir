export const releaseGoalPresets = [
  "Regular release",
  "Feature release",
  "Bug-fix release",
  "Customer launch",
  "Internal milestone",
  "Maintenance release",
] as const;
export const specializedReleaseGoalPresets = [
  "Regulatory submission",
  "Pilot/manufacturing build",
  "Field trial",
] as const;
export function addReleaseGoal(
  goals: readonly string[],
  raw: string,
): string[] {
  const goal = raw.trim();
  if (
    !goal ||
    goal.length > 200 ||
    goal.includes("\0") ||
    Array.from(goal).some((character) => {
      const point = character.codePointAt(0)!;
      return point >= 0xd800 && point <= 0xdfff;
    })
  )
    throw Error(
      "Use a nonblank goal of at most 200 characters, without null characters or incomplete Unicode.",
    );
  if (goals.includes(goal)) return [...goals];
  if (goals.length >= 20)
    throw Error(
      "A release supports up to 20 goals. Remove a selected goal before adding another.",
    );
  return [...goals, goal];
}
export function releaseGoalDraftProblem(draft: string): string | null {
  return draft.length
    ? "Add your custom goal or clear its draft before continuing."
    : null;
}
export function releaseCriteriaDraftProblem(values: {
  planName: string;
  criteria: readonly string[];
  criterionDraft: string;
  editingIndex: number | null;
}): string | null {
  if (values.editingIndex !== null)
    return "Save or cancel this criterion edit before continuing.";
  if (values.criterionDraft.length > 0)
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
  const description = draft;
  if (
    !description.trim() ||
    description.length > 2000 ||
    description.includes("\0") ||
    Array.from(description).some((character) => {
      const point = character.codePointAt(0)!;
      return point >= 0xd800 && point <= 0xdfff;
    })
  )
    throw Error(
      "A criterion needs nonblank native text of at most 2,000 characters, without null characters or incomplete Unicode.",
    );
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
