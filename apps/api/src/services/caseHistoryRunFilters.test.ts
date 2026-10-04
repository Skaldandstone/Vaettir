// SOURCE ONLY: authored NOT RUN. Runtime/SQL/current-access checks remain open.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { caseHistoryRunWhere, caseHistoryRunPredicate } from "./caseHistoryRunFilters.js";
import { caseExecutionHistoryInputSchema, caseHistoryFilterKey } from "./caseExecutionHistoryScopeSchema.js";

describe("case history recorded run filters (NOT RUN)", () => {
  it("uses stored provider and overall status independently without default filters", () => {
    expect(caseHistoryRunWhere(undefined)).toEqual({});
    expect(caseHistoryRunWhere({})).toEqual({});
    expect(caseHistoryRunWhere({ recordedSource: "MANUAL" })).toEqual({ ciProvider: "manual" });
    expect(caseHistoryRunWhere({ recordedSource: "CI_IMPORT", runStatus: "FAILED" })).toEqual({ ciProvider: { not: "manual" }, status: "FAILED" });
    expect(caseHistoryRunWhere({ runStatus: "RUNNING" })).toEqual({ status: "RUNNING" });
    const sql = caseHistoryRunPredicate({ recordedSource: "CI_IMPORT", runStatus: "FAILED" });
    expect(sql.sql).toContain('r."ciProvider"<>');
    expect(sql.sql).toContain("r.status::text=");
    expect(sql.values).toEqual(["FAILED"]);
    expect(sql.sql).not.toContain("FAILED");
    expect(sql.sql).not.toContain("TestResult");
  });
  it("full request/key keeps old absence and binds source/status plus configuration without case outcomes", () => {
    const legacy = { projectId: "p", testCaseId: "c", limit: 10 };
    expect(caseExecutionHistoryInputSchema.parse(legacy)).toEqual(legacy);
    const a = caseExecutionHistoryInputSchema.parse({ ...legacy, filters: { platform: " PC ", recordedSource: "MANUAL", runStatus: "PARTIAL" } });
    expect(a.filters?.platform).toBe(" PC ");
    const b = { ...a, filters: { ...a.filters, recordedSource: "CI_IMPORT" as const } };
    const c = { ...a, filters: { ...a.filters, runStatus: "FAILED" as const } };
    expect(caseHistoryFilterKey(a)).not.toBe(caseHistoryFilterKey(b));
    expect(caseHistoryFilterKey(a)).not.toBe(caseHistoryFilterKey(c));
    expect(caseExecutionHistoryInputSchema.safeParse({ ...legacy, filters: { runStatus: "FAIL" } }).success).toBe(false);
    expect(caseExecutionHistoryInputSchema.safeParse({ ...legacy, filters: { outcome: "FAIL" } }).success).toBe(false);
  });
  it("source/status scope precedes anchors, page selection and bounded configuration materialization", () => {
    const source = readFileSync(new URL("./caseExecutionHistory.ts", import.meta.url), "utf8");
    const scope = readFileSync(new URL("./caseExecutionHistoryScope.ts", import.meta.url), "utf8");
    expect(source.indexOf("...caseHistoryRunWhere(input.filters)")).toBeLessThan(source.indexOf("const anchor"));
    expect(source).toContain("where: { ...scope, id: input.before.runId }");
    expect(source).toContain("scope,");
    expect(scope.indexOf("${caseHistoryRunPredicate(filters)}")).toBeLessThan(scope.indexOf("const population"));
    expect(scope).toContain("WHERE ${candidate}");
    expect(scope).toContain("size[0].bytes > 4194304n");
    expect(source).not.toContain("items.filter(");
  });
});
