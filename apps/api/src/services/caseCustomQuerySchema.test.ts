// Authored, not executed tonight.
import { describe, it, expect } from "vitest";
import { caseQuerySchema, defaultCaseQuery } from "./caseQuerySchema.js";
import { savedCaseQueryDefinition } from "./savedCaseQuerySchema.js";
import { customBindingProblems } from "./caseCustomQuerySchema.js";
describe("typed custom-query source contracts", () => {
  const binding = { key: "flag", type: "BOOLEAN" as const, options: [] };
  const input = (change: object) => ({
    ...defaultCaseQuery(),
    groups: [
      {
        match: "all",
        rules: [
          {
            ...binding,
            field: "custom",
            operator: "equals",
            value: false,
            ...change,
          },
        ],
      },
    ],
  });
  it("retains old version-one query bytes while accepting false and zero", () => {
    expect(caseQuerySchema.parse(defaultCaseQuery())).toEqual(
      defaultCaseQuery(),
    );
    expect(caseQuerySchema.parse(input({})).groups[0]!.rules[0]).toMatchObject({
      value: false,
    });
    expect(
      caseQuerySchema.safeParse(input({ type: "NUMBER", value: 0 })).success,
    ).toBe(true);
  });
  it("rejects wrong operators value types invalid dates and values on unset operators", () => {
    for (const change of [
      { operator: "atLeast" },
      { value: "false" },
      { operator: "missing", value: false },
      { type: "DATE", value: "2024-02-31" },
      { type: "TEXT", operator: "rawSql" },
      { type: "TEXT", value: "bad\0text" },
    ])
      expect(caseQuerySchema.safeParse(input(change)).success).toBe(false);
  });
  it("requires explicit matching custom column binding and bounded layout", () => {
    const definition = {
      name: "Custom",
      visibility: "PRIVATE",
      query: defaultCaseQuery(),
      columns: ["custom:flag"],
    };
    expect(savedCaseQueryDefinition.safeParse(definition).success).toBe(false);
    expect(
      savedCaseQueryDefinition.safeParse({
        ...definition,
        query: { ...defaultCaseQuery(), customColumns: [binding] },
      }).success,
    ).toBe(true);
    expect(
      caseQuerySchema.safeParse({
        ...defaultCaseQuery(),
        customColumns: Array(7).fill(binding),
      }).success,
    ).toBe(false);
  });
  it("identifies retired unknown and incompatible definitions rather than dropping them", () => {
    const field = {
      ...binding,
      label: "Flag",
      required: false,
      retired: false,
    };
    expect(customBindingProblems([field], [binding])).toEqual([]);
    for (const fields of [
      [],
      [{ ...field, retired: true }],
      [{ ...field, type: "NUMBER" as const }],
    ])
      expect(customBindingProblems(fields, [binding]).join(" ")).toContain(
        "Repair",
      );
  });
});
