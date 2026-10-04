import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@vaettir/db";
import {
  reportPlanCaseScopeIds,
  readReportPlanTemplateCaseIds,
  mergeReportPlanCaseIds,
  readReportPlanCaseScope,
} from "./reportPlanCaseScope.js";
// SOURCE ONLY. No execution until James's morning validation authorization.
describe("bounded plan report cohort helper", () => {
  it("accepts only bounded exact native plan identity lists without remapping duplicates", () => {
    expect(reportPlanCaseScopeIds("synthetic", [])).toEqual([]);
    expect(reportPlanCaseScopeIds("synthetic", ["plan-z", "plan-a"])).toEqual([
      "plan-z",
      "plan-a",
    ]);
    for (const plans of [
      ["duplicate", "duplicate"],
      [""],
      ["x".repeat(201)],
      ["\ud800"],
      Array.from({ length: 201 }, (_, n) => `p${n}`),
    ])
      expect(() => reportPlanCaseScopeIds("synthetic", plans)).toThrow();
  });
  it("validates saved templates with the existing schema and preserves empty legacy scope", () => {
    expect(readReportPlanTemplateCaseIds({})).toEqual([]);
    expect(
      readReportPlanTemplateCaseIds({
        version: 1,
        testCaseIds: ["synthetic-case"],
        configurations: [],
      }),
    ).toEqual(["synthetic-case"]);
    for (const template of [
      null,
      [],
      { testCaseIds: ["case"] },
      { version: 2, testCaseIds: [], configurations: [] },
      {
        version: 1,
        testCaseIds: ["duplicate", "duplicate"],
        configurations: [],
      },
      {
        version: 1,
        testCaseIds: [],
        configurations: [],
        procedure: "private procedure must not become metadata",
      },
      {
        version: 1,
        testCaseIds: [],
        configurations: [{ id: "not-uuid", name: "Synthetic", context: {} }],
      },
    ])
      expect(() => readReportPlanTemplateCaseIds(template)).toThrow();
  });
  it("deduplicates only explicit identities in deterministic order and refuses oversized output", () => {
    expect(
      mergeReportPlanCaseIds(["case-b", "case-a"], ["case-a", "case-c"]),
    ).toEqual(["case-a", "case-b", "case-c"]);
    expect(() => mergeReportPlanCaseIds(["\udfff"], [])).toThrow();
    expect(() =>
      mergeReportPlanCaseIds(
        [],
        Array.from({ length: 20001 }, (_, n) => `case-${n}`),
      ),
    ).toThrow();
    expect(() =>
      mergeReportPlanCaseIds(
        [],
        Array.from({ length: 10000 }, (_, n) => `${n}-`.padEnd(199, "界")),
      ),
    ).toThrow();
  });
  it("refuses the SQL template-byte gate before loading plan JSON or case metadata", async () => {
    const findMany = vi.fn();
    const tx = {
      $queryRaw: vi
        .fn()
        .mockResolvedValue([
          { plans: 1n, foreign: 0n, supported: true, templateBytes: 4194305n },
        ]),
      testPlan: { findMany },
      testCase: { findMany: vi.fn() },
    } as unknown as Prisma.TransactionClient;
    await expect(
      readReportPlanCaseScope(tx, "synthetic", ["plan"]),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(findMany).not.toHaveBeenCalled();
    expect(tx.testCase.findMany).not.toHaveBeenCalled();
  });
});
