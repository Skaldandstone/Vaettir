// Authored source only; execute with the morning validation checkpoint.
import { describe, expect, it } from "vitest";
import {
  caseFieldSchema,
  caseFieldValues,
  fieldValueProblem,
  validateCaseFieldValues,
} from "./caseFieldSchema.js";

describe("bounded typed case metadata", () => {
  const field = {
    key: "component",
    label: "Component",
    type: "TEXT" as const,
    required: true,
    retired: false,
    options: [],
  };
  it("requires unique safe keys, typed options and bounded schemas", () => {
    expect(
      caseFieldSchema.safeParse({ version: 1, fields: [field, field] }).success,
    ).toBe(false);
    expect(
      caseFieldSchema.safeParse({
        version: 1,
        fields: [{ ...field, key: "constructor" }],
      }).success,
    ).toBe(false);
    expect(
      caseFieldSchema.safeParse({
        version: 1,
        fields: [{ ...field, options: ["irrelevant"] }],
      }).success,
    ).toBe(false);
    expect(
      caseFieldSchema.safeParse({
        version: 1,
        fields: [{ ...field, type: "CHOICE", options: ["x", "x"] }],
      }).success,
    ).toBe(false);
    expect(
      caseFieldSchema.safeParse({
        version: 1,
        fields: [{ ...field, retired: true }],
      }).success,
    ).toBe(false);
    expect(
      caseFieldSchema.safeParse({ version: "1", fields: [] }).success,
    ).toBe(false);
    expect(
      caseFieldValues.safeParse({ nested: { sql: "not executed" } }).success,
    ).toBe(false);
    expect(caseFieldValues.safeParse({ number: Infinity }).success).toBe(false);
  });
  it("validates real dates and distinguishes false and zero from missing", () => {
    expect(
      fieldValueProblem({ ...field, type: "DATE" }, "2026-02-30"),
    ).toContain("real");
    expect(
      fieldValueProblem({ ...field, type: "DATE" }, "2024-02-29"),
    ).toBeNull();
    expect(
      fieldValueProblem({ ...field, type: "DATE" }, "0000-01-01"),
    ).toContain("real");
    expect(fieldValueProblem({ ...field, type: "BOOLEAN" }, false)).toBeNull();
    expect(fieldValueProblem({ ...field, type: "NUMBER" }, 0)).toBeNull();
    expect(fieldValueProblem(field, null)).toContain("required");
    expect(fieldValueProblem(field, "   ")).toContain("required");
    expect(
      fieldValueProblem(
        { ...field, type: "CHOICE", options: ["API", "Web"] },
        "Other",
      ),
    ).toContain("listed choice");
  });
  it("retains retired and unknown metadata unchanged without inventing values", () => {
    const schema = caseFieldSchema.parse({
      version: 1,
      fields: [{ ...field, required: false, retired: true }],
    });
    const prior = { component: "Original", future_key: false };
    expect(validateCaseFieldValues(schema, prior, prior)).toEqual([]);
    expect(
      validateCaseFieldValues(
        schema,
        { component: "Replacement", future_key: false },
        prior,
      ),
    ).toHaveLength(1);
    expect(
      validateCaseFieldValues(schema, { component: "Original" }, prior),
    ).toHaveLength(1);
    expect(
      validateCaseFieldValues(
        schema,
        { component: "Original", new_unknown: "fabricated" },
        prior,
      ),
    ).toHaveLength(2);
  });
});
