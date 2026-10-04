// Authored only. Validation deferred by James until morning.
import { describe, it, expect } from "vitest";
import {
  caseQueryExportInput,
  approvedCaseQueryExportInput,
} from "./caseQueryExportSchema.js";
import { defaultCaseQuery } from "./caseQuerySchema.js";
const input = {
  projectId: "synthetic",
  requestId: "00000000-0000-4000-8000-000000000001",
  query: defaultCaseQuery(),
  columns: ["title"],
  format: "METADATA",
};
describe("whole typed-query export inputs", () => {
  it("requires exact bounded explicit columns and rejects procedure references or raw SQL", () => {
    expect(caseQueryExportInput.safeParse(input).success).toBe(true);
    for (const change of [
      { columns: [] },
      { columns: ["title", "title"] },
      { columns: ["given"] },
      { query: { ...defaultCaseQuery(), rawSql: "SELECT true" } },
      { cursor: "only-one-page" },
      { columns: ["custom:private_note"] },
    ])
      expect(
        caseQueryExportInput.safeParse({ ...input, ...change }).success,
      ).toBe(false);
  });
  it("preserves false conditions and demands exact selected current custom bindings", () => {
    const binding = { key: "enabled", type: "BOOLEAN", options: [] };
    const query = {
      ...defaultCaseQuery(),
      customColumns: [binding],
      groups: [
        {
          match: "all",
          rules: [
            { ...binding, field: "custom", operator: "equals", value: false },
          ],
        },
      ],
    };
    expect(
      caseQueryExportInput.safeParse({
        ...input,
        query,
        columns: ["custom:enabled"],
      }).success,
    ).toBe(true);
    expect(caseQueryExportInput.safeParse({ ...input, query }).success).toBe(
      false,
    );
  });
  it("requires current original organization exact fingerprint and explicit confirmation", () => {
    const approved = {
      ...input,
      organizationId: "original",
      expectedFingerprint: "a".repeat(64),
      confirmed: true,
    };
    expect(approvedCaseQueryExportInput.safeParse(approved).success).toBe(true);
    for (const change of [
      { confirmed: false },
      { organizationId: "" },
      { expectedFingerprint: "" },
      { paidCredits: 5 },
    ])
      expect(
        approvedCaseQueryExportInput.safeParse({ ...approved, ...change })
          .success,
      ).toBe(false);
  });
});
