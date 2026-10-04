import { z } from "zod";
import { caseQuerySchema, CASE_QUERY_COLUMNS } from "./caseQuerySchema.js";
import { caseFieldKey } from "./caseFieldSchema.js";

const column = z.union([
  z.enum(CASE_QUERY_COLUMNS),
  z
    .string()
    .startsWith("custom:")
    .refine((value) => caseFieldKey.safeParse(value.slice(7)).success),
]);
export const caseQueryExportInput = z
  .object({
    projectId: z.string().min(1).max(120),
    query: caseQuerySchema,
    columns: z
      .array(column)
      .min(1)
      .max(8)
      .refine((values) => new Set(values).size === values.length),
    format: z.enum(["METADATA", "AGGREGATES"]),
    requestId: z.string().uuid(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const projected = value.columns
      .filter((key) => key.startsWith("custom:"))
      .map((key) => key.slice(7));
    const bindings =
      value.query.customColumns?.map((binding) => binding.key) ?? [];
    if (
      projected.length !== bindings.length ||
      projected.some((key) => !bindings.includes(key))
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Export custom columns must exactly match the applied query projection.",
      });
  });
// Validate the common scope in the merged strict approval object as well.
export const approvedCaseQueryExportInput = z
  .object({
    projectId: z.string().min(1).max(120),
    query: caseQuerySchema,
    columns: z
      .array(column)
      .min(1)
      .max(8)
      .refine((values) => new Set(values).size === values.length),
    format: z.enum(["METADATA", "AGGREGATES"]),
    requestId: z.string().uuid(),
    organizationId: z.string().min(1).max(120),
    expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    confirmed: z.literal(true),
  })
  .strict()
  .superRefine((value, ctx) => {
    const parsed = caseQueryExportInput.safeParse({
      projectId: value.projectId,
      query: value.query,
      columns: value.columns,
      format: value.format,
      requestId: value.requestId,
    });
    if (!parsed.success)
      for (const issue of parsed.error.issues) ctx.addIssue(issue);
  });
export type CaseQueryExportInput = z.infer<typeof caseQueryExportInput>;
export type ApprovedCaseQueryExportInput = z.infer<
  typeof approvedCaseQueryExportInput
>;
