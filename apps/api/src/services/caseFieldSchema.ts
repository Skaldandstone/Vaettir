import { z } from "zod";
export const caseFieldKey = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,39}$/)
  .refine((key) => !["constructor", "prototype", "__proto__"].includes(key));
export const caseFieldDefinition = z
  .object({
    key: caseFieldKey,
    label: z.string().trim().min(1).max(120),
    type: z.enum(["TEXT", "NUMBER", "BOOLEAN", "DATE", "CHOICE"]),
    required: z.boolean(),
    retired: z.boolean(),
    options: z
      .array(
        z
          .string()
          .min(1)
          .max(120)
          .refine((option) => option.trim().length > 0),
      )
      .max(30),
  })
  .strict()
  .superRefine((field, ctx) => {
    if (
      (field.type === "CHOICE"
        ? !field.options.length
        : field.options.length > 0) ||
      new Set(field.options).size !== field.options.length ||
      (field.retired && field.required)
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Choices must be unique and only choice fields have options; retired fields cannot be required.",
      });
  });
export const caseFieldSchema = z
  .object({
    version: z.literal(1),
    fields: z
      .array(caseFieldDefinition)
      .max(20)
      .refine(
        (fields) => new Set(fields.map((f) => f.key)).size === fields.length,
      ),
  })
  .strict();
export const caseFieldValues = z
  .record(
    caseFieldKey,
    z.union([
      z.string().max(2000),
      z.number().finite().min(-1e12).max(1e12),
      z.boolean(),
      z.null(),
    ]),
  )
  .superRefine((values, ctx) => {
    if (Object.keys(values).length > 100)
      ctx.addIssue({
        code: "custom",
        message: "At most 100 retained metadata values are supported.",
      });
  });
export type CaseFieldDefinition = z.infer<typeof caseFieldDefinition>;
export type CaseFieldValues = z.infer<typeof caseFieldValues>;
export function fieldValueProblem(
  field: CaseFieldDefinition,
  value: unknown,
): string | null {
  if (field.retired) return null;
  if (value == null || (typeof value === "string" && value.trim() === ""))
    return field.required ? `${field.label} is required.` : null;
  if (field.type === "TEXT")
    return typeof value === "string" && value.length <= 2000
      ? null
      : `${field.label} needs text (up to 2,000 characters).`;
  if (field.type === "NUMBER")
    return typeof value === "number" &&
      Number.isFinite(value) &&
      Math.abs(value) <= 1e12
      ? null
      : `${field.label} needs a finite number.`;
  if (field.type === "BOOLEAN")
    return typeof value === "boolean"
      ? null
      : `${field.label} needs Yes or No.`;
  if (field.type === "CHOICE")
    return typeof value === "string" && field.options.includes(value)
      ? null
      : `${field.label} needs one listed choice.`;
  return typeof value === "string" &&
    /^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
    ? null
    : `${field.label} needs a real YYYY-MM-DD date.`;
}
export function validateCaseFieldValues(
  schema: z.infer<typeof caseFieldSchema>,
  proposed: CaseFieldValues,
  prior: CaseFieldValues = {},
): string[] {
  const active = new Set(
    schema.fields.filter((f) => !f.retired).map((f) => f.key),
  );
  const problems = schema.fields.flatMap((field) => {
    const problem = fieldValueProblem(field, proposed[field.key]);
    return problem ? [problem] : [];
  });
  for (const key of new Set([...Object.keys(prior), ...Object.keys(proposed)]))
    if (
      !active.has(key) &&
      (Object.hasOwn(prior, key) !== Object.hasOwn(proposed, key) ||
        prior[key] !== proposed[key])
    )
      problems.push(
        `Retained metadata ${key} cannot be changed or removed by this form.`,
      );
  return problems;
}
