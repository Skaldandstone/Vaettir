import { z } from "zod";
import { caseFieldKey, type CaseFieldDefinition } from "./caseFieldSchema.js";
export const caseCustomBinding = z
  .object({
    key: caseFieldKey,
    type: z.enum(["TEXT", "NUMBER", "BOOLEAN", "DATE", "CHOICE"]),
    options: z.array(z.string().min(1).max(120)).max(30),
  })
  .strict();
export type CaseCustomBinding = z.infer<typeof caseCustomBinding>;
export const caseCustomRule = caseCustomBinding
  .extend({
    field: z.literal("custom"),
    operator: z.enum([
      "equals",
      "contains",
      "atLeast",
      "atMost",
      "before",
      "after",
      "missing",
      "null",
      "empty",
    ]),
    value: z
      .union([
        z
          .string()
          .max(2000)
          .refine(
            (value) => !value.includes("\0"),
            "A comparison cannot contain a null character.",
          ),
        z.number().finite().min(-1e12).max(1e12),
        z.boolean(),
      ])
      .optional(),
  })
  .strict();
export function customRuleProblem(
  rule: z.infer<typeof caseCustomRule>,
): string | null {
  if (["missing", "null"].includes(rule.operator))
    return rule.value === undefined
      ? null
      : "Unset conditions must not carry a comparison value.";
  if (rule.operator === "empty")
    return rule.type === "TEXT" && rule.value === undefined
      ? null
      : "Empty text is a distinct text-only condition.";
  const validValue =
    rule.type === "NUMBER"
      ? typeof rule.value === "number"
      : rule.type === "BOOLEAN"
        ? typeof rule.value === "boolean"
        : rule.type === "CHOICE"
          ? typeof rule.value === "string" && rule.options.includes(rule.value)
          : rule.type === "DATE"
            ? typeof rule.value === "string" &&
              /^(?!0000)\d{4}-\d{2}-\d{2}$/.test(rule.value) &&
              Number.isFinite(Date.parse(rule.value)) &&
              new Date(rule.value).toISOString().slice(0, 10) === rule.value
            : typeof rule.value === "string";
  const operations =
    rule.type === "TEXT"
      ? ["equals", "contains"]
      : rule.type === "NUMBER"
        ? ["equals", "atLeast", "atMost"]
        : rule.type === "DATE"
          ? ["equals", "before", "after"]
          : ["equals"];
  return validValue && operations.includes(rule.operator)
    ? null
    : "Use a value and comparison supported by this project field type.";
}
export function customBindingProblems(
  fields: CaseFieldDefinition[],
  bindings: CaseCustomBinding[],
): string[] {
  return bindings.flatMap((binding) => {
    const current = fields.find((field) => field.key === binding.key);
    return !current ||
      current.retired ||
      current.type !== binding.type ||
      JSON.stringify(current.options) !== JSON.stringify(binding.options)
      ? [
          `Project field ${binding.key} is unavailable, retired or has incompatible definitions. Repair its condition/column explicitly; no criteria were removed.`,
        ]
      : [];
  });
}
