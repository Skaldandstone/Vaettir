import { describe, expect, it } from "vitest";
import { CASE_PRESENTATION_DOMAINS, CASE_PRESENTATION_TYPES, CASE_PRESENTATION_PRESETS, casePresentationSchema, casePresentationPreset, defaultCasePresentation, casePresentationVisible, retainedCaseChoices } from "./casePresentation.js";
import { experienceProfileSchema } from "./qualityExperience.js";
describe("built-in case presentation is lossless guidance", () => {
  it("presets contain only supported fields, domains and case types", () => {
    for (const preset of CASE_PRESENTATION_PRESETS) {
      const configuration = casePresentationSchema.parse(casePresentationPreset(preset));
      expect(configuration.domains.every(value => CASE_PRESENTATION_DOMAINS.includes(value))).toBe(true);
      expect(configuration.testTypes.every(value => CASE_PRESENTATION_TYPES.includes(value))).toBe(true);
    }
    expect(casePresentationSchema.safeParse({ ...casePresentationPreset("SOFTWARE"), arbitraryPermission: true }).success).toBe(false);
    expect(casePresentationSchema.safeParse({ ...casePresentationPreset("SOFTWARE"), testTypes: [] }).success).toBe(false);
    expect(casePresentationSchema.safeParse({ ...casePresentationPreset("SOFTWARE"), domains: ["SOFTWARE", "SOFTWARE"] }).success).toBe(false);
  });
  it("existing selections remain visible and editable instead of being coerced", () => {
    expect(retainedCaseChoices(["FUNCTIONAL", "UNIT"], "COMPLIANCE")).toEqual([{ value: "FUNCTIONAL", retained: false }, { value: "UNIT", retained: false }, { value: "COMPLIANCE", retained: true }]);
    expect(retainedCaseChoices(["FUNCTIONAL"], "FUNCTIONAL")).toHaveLength(1);
    expect(retainedCaseChoices(["SOFTWARE"], "Legacy literal custom domain").at(-1)?.retained).toBe(true);
  });
  it("hidden populated fields and mapped compliance evidence always remain visible", () => {
    const configuration = casePresentationPreset("SOFTWARE");
    for (const field of Object.keys(configuration.fields) as Array<keyof typeof configuration.fields>) {
      configuration.fields[field] = "HIDE";
      expect(casePresentationVisible(configuration, field, false, { validationDomain: "SOFTWARE" })).toBe(false);
      expect(casePresentationVisible(configuration, field, true, { validationDomain: "SOFTWARE" })).toBe(true);
    }
    expect(casePresentationVisible(configuration, "compliance", false, { validationDomain: "SOFTWARE", hasMappedControls: true })).toBe(true);
  });
  it("automatic choices distinguish software, hardware, HIL and compliance without asserting certification", () => {
    const configuration = casePresentationPreset("SOFTWARE");
    expect(casePresentationVisible(configuration, "hardwareFixture", false, { validationDomain: "SOFTWARE" })).toBe(false);
    expect(casePresentationVisible(configuration, "hardwareFixture", false, { validationDomain: "OTHER" })).toBe(false);
    expect(casePresentationVisible(configuration, "safety", false, { validationDomain: "HARDWARE" })).toBe(true);
    expect(casePresentationVisible(configuration, "expectedResponse", false, { validationDomain: "HIL" })).toBe(true);
    expect(casePresentationVisible(configuration, "compliance", false, { validationDomain: "SOFTWARE", testType: "FUNCTIONAL" })).toBe(false);
    expect(casePresentationVisible(configuration, "compliance", false, { validationDomain: "SOFTWARE", testType: "COMPLIANCE" })).toBe(true);
  });
  it("multi-offering defaults retain union, while unsupported food/clinical case domains stay honest", () => {
    const profile = (offerings: string[]) => experienceProfileSchema.parse({ version: 1, offerings });
    const combined = defaultCasePresentation(profile(["SOFTWARE", "GAME", "HARDWARE"]));
    expect(combined.testTypes).toContain("CONTRACT"); expect(combined.testTypes).toContain("ACCESSIBILITY"); expect(combined.domains).toContain("HARDWARE");
    expect(defaultCasePresentation(profile(["FOOD_SAFETY"])).domains[0]).toBe("OTHER");
    expect(defaultCasePresentation(profile(["FOOD_SAFETY"])).fields.hardwareFixture).toBe("SHOW");
    expect(defaultCasePresentation(profile(["CLINICAL"])).domains[0]).toBe("OTHER");
    expect(defaultCasePresentation(profile(["LABORATORY"])).domains[0]).toBe("PHARMA_LAB");
    expect(defaultCasePresentation(profile(["HIL"])).domains[0]).toBe("HIL");
    expect(defaultCasePresentation(null).testTypes).toEqual([...CASE_PRESENTATION_TYPES]);
  });
});
