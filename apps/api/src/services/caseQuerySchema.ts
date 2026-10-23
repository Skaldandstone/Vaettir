import { z } from "zod";
import {
  caseCustomBinding,
  caseCustomRule,
  customRuleProblem,
} from "./caseCustomQuerySchema.js";
export const CASE_QUERY_COLUMNS = [
  "title",
  "type",
  "priority",
  "risk",
  "automation",
  "review",
  "suite",
  "updated",
] as const;
export const CASE_QUERY_TYPES = [
  "UNIT",
  "FUNCTIONAL",
  "CONTRACT",
  "INSTRUMENTATION",
  "SMOKE",
  "SANITY",
  "REGRESSION",
  "E2E",
  "PERFORMANCE",
  "SECURITY",
  "ACCESSIBILITY",
  "EXPLORATORY",
  "COMPLIANCE",
  "OTHER",
] as const;
export const CASE_QUERY_DOMAINS = [
  "SOFTWARE",
  "HARDWARE",
  "SYSTEM_INTEGRATION",
  "HIL",
  "MANUFACTURING",
  "MEDICAL_DEVICE",
  "PHARMA_LAB",
  "OTHER",
] as const;
const text = z.string().trim().min(1).max(160);
export const caseQueryRuleSchema = z.discriminatedUnion("field", [
  caseCustomRule,
  z
    .object({
      field: z.literal("title"),
      operator: z.enum(["contains", "equals"]),
      value: text,
    })
    .strict(),
  z
    .object({
      field: z.literal("displayId"),
      operator: z.literal("equals"),
      value: text,
    })
    .strict(),
  z
    .object({
      field: z.literal("tag"),
      operator: z.literal("equals"),
      value: text,
    })
    .strict(),
  z
    .object({
      field: z.literal("suite"),
      operator: z.enum(["equals", "unassigned"]),
      value: z.string().max(240),
    })
    .strict(),
  z
    .object({
      field: z.literal("priority"),
      operator: z.literal("equals"),
      value: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]),
    })
    .strict(),
  z
    .object({
      field: z.literal("type"),
      operator: z.literal("equals"),
      value: z.enum(CASE_QUERY_TYPES),
    })
    .strict(),
  z
    .object({
      field: z.literal("domain"),
      operator: z.literal("equals"),
      value: z.enum(CASE_QUERY_DOMAINS),
    })
    .strict(),
  z
    .object({
      field: z.literal("automation"),
      operator: z.literal("equals"),
      value: z.enum([
        "MANUAL",
        "AUTOMATED",
        "PARTIALLY_AUTOMATED",
        "NEEDS_AUTOMATION",
      ]),
    })
    .strict(),
  z
    .object({
      field: z.literal("review"),
      operator: z.literal("equals"),
      value: z.enum(["APPROVED", "PENDING_REVIEW", "REJECTED"]),
    })
    .strict(),
  z
    .object({
      field: z.literal("origin"),
      operator: z.literal("equals"),
      value: z.enum(["AUTHORED", "AI_REVERSE_ENGINEERED", "IMPORTED"]),
    })
    .strict(),
  z
    .object({
      field: z.literal("riskScore"),
      operator: z.enum(["atLeast", "atMost", "unassessed"]),
      value: z.number().int().min(0).max(100),
    })
    .strict(),
  z
    .object({
      field: z.literal("flaky"),
      operator: z.literal("equals"),
      value: z.boolean(),
    })
    .strict(),
]);
export const caseQuerySchema = z
  .object({
    version: z.literal(1),
    match: z.enum(["all", "any"]),
    groups: z
      .array(
        z
          .object({
            match: z.enum(["all", "any"]),
            rules: z.array(caseQueryRuleSchema).min(1).max(8),
          })
          .strict(),
      )
      .max(3),
    archive: z.enum(["active", "archived", "all"]),
    sort: z.enum(["caseNumber", "title", "updatedAt"]),
    direction: z.enum(["asc", "desc"]),
    customColumns: z
      .array(caseCustomBinding)
      .max(6)
      .refine(
        (columns) =>
          new Set(columns.map((column) => column.key)).size === columns.length,
      )
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.groups.reduce((sum, g) => sum + g.rules.length, 0) > 12)
      ctx.addIssue({ code: "custom", message: "Use at most 12 conditions" });
    for (const group of value.groups)
      for (const rule of group.rules)
        if (rule.field === "custom") {
          const problem = customRuleProblem(rule);
          if (problem) ctx.addIssue({ code: "custom", message: problem });
        } else if (
          rule.field === "suite" &&
          rule.operator === "equals" &&
          !rule.value.trim()
        )
          ctx.addIssue({
            code: "custom",
            message: "Enter an exact suite path or choose unassigned",
          });
  });
export type CaseQuery = z.infer<typeof caseQuerySchema>;
export type CaseQueryRule = z.infer<typeof caseQueryRuleSchema>;
export const defaultCaseQuery = (): CaseQuery => ({
  version: 1,
  match: "all",
  groups: [],
  archive: "active",
  sort: "caseNumber",
  direction: "asc",
});
