import { z } from "zod";
import type { ExperienceProfile } from "./qualityExperience.js";

// These are presentation preferences, never authorization or compliance proof.
export const CASE_PRESENTATION_TYPES = ["UNIT", "FUNCTIONAL", "CONTRACT", "INSTRUMENTATION", "SMOKE", "SANITY", "REGRESSION", "E2E", "PERFORMANCE", "SECURITY", "ACCESSIBILITY", "EXPLORATORY", "COMPLIANCE", "OTHER"] as const;
export const CASE_PRESENTATION_DOMAINS = ["SOFTWARE", "HARDWARE", "SYSTEM_INTEGRATION", "HIL", "MANUFACTURING", "MEDICAL_DEVICE", "PHARMA_LAB", "OTHER"] as const;
export const CASE_PRESENTATION_FIELDS = ["background", "tags", "technicalBehavior", "expectedResponse", "hardwareFixture", "safety", "compliance"] as const;
export const CASE_PRESENTATION_PRESETS = ["SOFTWARE", "HARDWARE", "GAME", "REGULATORY"] as const;
export type CasePresentationField = typeof CASE_PRESENTATION_FIELDS[number];
const mode = z.enum(["AUTO", "SHOW", "HIDE"]);
export const casePresentationSchema = z.object({
  version: z.literal(1),
  fields: z.object({ background: mode, tags: mode, technicalBehavior: mode, expectedResponse: mode, hardwareFixture: mode, safety: mode, compliance: mode }).strict(),
  testTypes: z.array(z.enum(CASE_PRESENTATION_TYPES)).min(1).max(CASE_PRESENTATION_TYPES.length).refine(values => new Set(values).size === values.length, "Choose each type once."),
  domains: z.array(z.enum(CASE_PRESENTATION_DOMAINS)).min(1).max(CASE_PRESENTATION_DOMAINS.length).refine(values => new Set(values).size === values.length, "Choose each domain once."),
}).strict();
export type CasePresentation = z.infer<typeof casePresentationSchema>;

export function casePresentationPreset(preset: typeof CASE_PRESENTATION_PRESETS[number]): CasePresentation {
  const fields: CasePresentation["fields"] = { background: "SHOW", tags: "SHOW", technicalBehavior: "SHOW", expectedResponse: "AUTO", hardwareFixture: "AUTO", safety: "AUTO", compliance: "AUTO" };
  if (preset === "HARDWARE") return { version: 1, fields, testTypes: ["FUNCTIONAL", "SMOKE", "SANITY", "REGRESSION", "PERFORMANCE", "SECURITY", "EXPLORATORY", "COMPLIANCE", "OTHER"], domains: ["HARDWARE", "HIL", "SYSTEM_INTEGRATION", "MANUFACTURING", "MEDICAL_DEVICE", "OTHER"] };
  if (preset === "GAME") return { version: 1, fields, testTypes: ["FUNCTIONAL", "UNIT", "SMOKE", "REGRESSION", "E2E", "PERFORMANCE", "SECURITY", "ACCESSIBILITY", "EXPLORATORY", "OTHER"], domains: ["SOFTWARE", "OTHER"] };
  if (preset === "REGULATORY") return { version: 1, fields: { ...fields, hardwareFixture: "SHOW", safety: "SHOW", compliance: "SHOW" }, testTypes: ["FUNCTIONAL", "COMPLIANCE", "REGRESSION", "PERFORMANCE", "EXPLORATORY", "OTHER"], domains: ["MEDICAL_DEVICE", "PHARMA_LAB", "MANUFACTURING", "SOFTWARE", "OTHER"] };
  return { version: 1, fields, testTypes: ["FUNCTIONAL", "UNIT", "CONTRACT", "INSTRUMENTATION", "SMOKE", "SANITY", "REGRESSION", "E2E", "PERFORMANCE", "SECURITY", "ACCESSIBILITY", "EXPLORATORY", "OTHER"], domains: ["SOFTWARE", "SYSTEM_INTEGRATION", "OTHER"] };
}

/** Multi-offering projects retain the union; no unsupported enum is invented. */
export function defaultCasePresentation(experience: ExperienceProfile | null): CasePresentation {
  if (!experience) return { version: 1, fields: casePresentationPreset("SOFTWARE").fields, testTypes: [...CASE_PRESENTATION_TYPES], domains: [...CASE_PRESENTATION_DOMAINS] };
  const presets = experience.offerings.map(offering => {
    const preset = casePresentationPreset(offering === "GAME" ? "GAME" : ["HARDWARE", "HIL", "MANUFACTURING"].includes(offering) ? "HARDWARE" : ["CLINICAL", "LABORATORY", "FOOD_SAFETY"].includes(offering) ? "REGULATORY" : "SOFTWARE");
    // Food and clinical protocol categories have no dedicated supported case
    // domain. Other is honest; neither implies a medical-device assessment.
    const primary = offering === "FOOD_SAFETY" || offering === "CLINICAL" ? "OTHER" : offering === "LABORATORY" ? "PHARMA_LAB" : offering === "HIL" ? "HIL" : offering === "MANUFACTURING" ? "MANUFACTURING" : offering === "SYSTEM_INTEGRATION" ? "SYSTEM_INTEGRATION" : preset.domains[0]!;
    return { ...preset, domains: [primary, ...preset.domains.filter(value => value !== primary)] as CasePresentation["domains"] };
  });
  const protocol = experience.offerings.some(offering => ["FOOD_SAFETY", "CLINICAL", "LABORATORY"].includes(offering));
  return { version: 1, fields: { ...casePresentationPreset("SOFTWARE").fields, ...(protocol ? { hardwareFixture: "SHOW" as const, safety: "SHOW" as const } : {}) }, testTypes: [...new Set(presets.flatMap(preset => preset.testTypes))], domains: [...new Set(presets.flatMap(preset => preset.domains))] };
}

export function casePresentationVisible(configuration: CasePresentation, field: CasePresentationField, hasValue: boolean, context: { validationDomain: string; testType?: string; hasMappedControls?: boolean }): boolean {
  // A preference cannot conceal supplied evidence, labels or a current edit.
  if (hasValue || (field === "compliance" && context.hasMappedControls)) return true;
  const preference = configuration.fields[field];
  if (preference !== "AUTO") return preference === "SHOW";
  if (field === "hardwareFixture" || field === "safety") return ["HARDWARE", "HIL", "MANUFACTURING", "MEDICAL_DEVICE", "PHARMA_LAB"].includes(context.validationDomain);
  if (field === "compliance") return context.testType === "COMPLIANCE";
  if (field === "expectedResponse") return ["SOFTWARE", "HIL", "SYSTEM_INTEGRATION"].includes(context.validationDomain);
  return true;
}

/** Existing or deliberately entered choices remain editable, not coerced. */
export function retainedCaseChoices(preferred: readonly string[], selected: string): { value: string; retained: boolean }[] {
  return [...preferred.map(value => ({ value, retained: false })), ...(selected && !preferred.includes(selected) ? [{ value: selected, retained: true }] : [])];
}
