import { z } from "zod";
import { reportDateIntervalSchema } from "./reportDateIntervalSchema.js";
import { reportExecutionScopeSchema } from "./reportExecutionScopeSchema.js";
// Pure contract shared by reviewed settings, captures and the browser editor.
export const reportDefinitionSchema = z
  .object({
    audience: z.enum(["stakeholders", "engineering", "quality"]),
    templateId: z
      .enum([
        "quality-status",
        "execution-progress",
        "requirements-coverage",
        "defect-review",
        "automation-progress",
      ])
      .optional(),
    windowDays: z.union([z.literal(7), z.literal(30), z.literal(90)]),
    dateInterval: reportDateIntervalSchema.optional(),
    executionScope: reportExecutionScopeSchema.optional(),
    sections: z
      .array(
        z.enum([
          "inventory",
          "execution",
          "traceability",
          "defects",
          "automation",
        ]),
      )
      .min(1)
      .max(5)
      .refine(
        (values) => new Set(values).size === values.length,
        "Choose each section once",
      ),
    summary: z.string().trim().max(1500),
    risks: z.string().trim().max(1500),
    nextActions: z.string().trim().max(1500),
  })
  .strict();
export type ReportDefinition = z.infer<typeof reportDefinitionSchema>;
