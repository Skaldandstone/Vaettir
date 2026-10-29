import { z } from "@vaettir/core/dist/validation.js";
import { qualityProfileHash, testPlanExecutionTemplateSchema } from "./qualityExperienceProfile.js";
import { inspectExactPlanExecutionJson } from "./planExecutionTemplateExactSchema.js";

/** New writes must already be executable v1 values. Never silently trim,
 * default, migrate, or discard fields from a stored template. */
export const executablePlanTemplateSchema = z.custom<z.infer<typeof testPlanExecutionTemplateSchema>>(
  value => {
    try {
      inspectExactPlanExecutionJson(value);
      const parsed = testPlanExecutionTemplateSchema.safeParse(value);
      return parsed.success && qualityProfileHash(parsed.data) === qualityProfileHash(value);
    } catch { return false; }
  },
  { message: "Review the complete configuration. All fields are required; remove outer whitespace from configuration values. Unsupported template versions are not converted." },
);
export function canEditExecutionTemplate(value: unknown): boolean {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    (Object.keys(value).length === 0 || executablePlanTemplateSchema.safeParse(value).success);
}
