import { describe, it, expect } from "vitest";
import { initialPlanTemplate, togglePlanCase, movePlanCase, planTemplateProblem } from "./plan-template-draft";
const uuid = "d11ff0da-a3e8-4d6c-af7e-b5fbdd271c3a";
describe("ordered reusable plan draft", () => {
  it("starts a blank plan with a complete editable configuration", () => {
    const draft = initialPlanTemplate({}, uuid);
    expect(draft.configurations[0]?.name).toBe("Default");
    expect(planTemplateProblem(draft)).toBeNull();
  });
  it("selects, reorders and removes without mutating the saved input", () => {
    const initial = initialPlanTemplate({}, uuid);
    const selected = togglePlanCase(togglePlanCase(initial, "first"), "second");
    expect(movePlanCase(selected, "second", -1).testCaseIds).toEqual(["second", "first"]);
    expect(togglePlanCase(selected, "first").testCaseIds).toEqual(["second"]);
    expect(initial.testCaseIds).toEqual([]);
    expect(movePlanCase(selected, "first", -1)).toBe(selected);
  });
  it("does not interpret opaque or future stored formats", () => {
    expect(() => initialPlanTemplate({ version: 2, opaque: true }, uuid)).toThrow();
  });
  it("requires explicit correction rather than trimming authored content", () => {
    const draft = initialPlanTemplate({}, uuid); draft.configurations[0]!.name = " Default ";
    expect(planTemplateProblem(draft)).toMatch(/whitespace/);
    expect(draft.configurations[0]!.name).toBe(" Default ");
  });
});
