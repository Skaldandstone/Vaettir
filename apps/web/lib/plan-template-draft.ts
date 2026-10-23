import { planExecutionSavedTemplateSchema } from "../../api/src/services/planExecutionReadSchema";
export type PlanTemplateDraft = typeof planExecutionSavedTemplateSchema["_output"];
export const emptyPlanContext = () => ({
  configuration: "", platform: "", build: "", hardwareRevision: "", firmwareVersion: "",
  rig: "", batchOrLot: "", environment: "", calibrationReference: "", protocolReference: "",
});
export function editablePlanTemplate(value: unknown): PlanTemplateDraft | null {
  const parsed = planExecutionSavedTemplateSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
export function unconfiguredPlanTemplate(value: unknown) {
  return !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0;
}
export function initialPlanTemplate(value: unknown, configurationId: string): PlanTemplateDraft {
  const current = editablePlanTemplate(value);
  if (current) return current;
  if (!unconfiguredPlanTemplate(value)) throw Error("This saved configuration cannot be edited without a supported migration.");
  return { version: 1, testCaseIds: [], configurations: [{ id: configurationId, name: "Default", context: emptyPlanContext() }] };
}
export function togglePlanCase(draft: PlanTemplateDraft, id: string): PlanTemplateDraft {
  return { ...draft, testCaseIds: draft.testCaseIds.includes(id) ? draft.testCaseIds.filter(key => key !== id) : [...draft.testCaseIds, id] };
}
export function movePlanCase(draft: PlanTemplateDraft, id: string, delta: -1 | 1): PlanTemplateDraft {
  const index = draft.testCaseIds.indexOf(id), target = index + delta;
  if (index < 0 || target < 0 || target >= draft.testCaseIds.length) return draft;
  const next = [...draft.testCaseIds];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return { ...draft, testCaseIds: next };
}
export function planTemplateProblem(draft: PlanTemplateDraft): string | null {
  const parsed = planExecutionSavedTemplateSchema.safeParse(draft);
  if (!parsed.success) return "Review the selected cases and configuration fields.";
  if (draft.configurations.some(c => !c.name.trim() || c.name !== c.name.trim() || Object.values(c.context).some(value => value !== value.trim())))
    return "Remove leading or trailing whitespace from configuration fields before saving.";
  return null;
}
