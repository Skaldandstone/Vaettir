import { describe, it, expect, vi } from "vitest";
import { createImportTypeAnalysis, importCaseId, importTypeCase } from "./importTypeAnalysis.js";
import { mapCsvRows } from "./csvFieldMapping.js";
import { importTypeCaseSchema } from "@vaettir/ai-agent";
const scope = { actorId: "owner", clerkSubject: "clerk", organizationId: "org", projectId: "project" };
const mapping = { title: "Title", when: "Action", then: "Expected" };
const row = mapCsvRows('Title,Action,Expected\nAnalytics dashboard,Open dashboard,Count equals backend\n', mapping).rows[0]!;
const c = importTypeCase(importCaseId("Sheet", 2), row);
const result = { id: c.id, testType: "FUNCTIONAL" as const, confidence: "HIGH" as const, objective: "Dashboard count accuracy", reason: "Checks business data, not telemetry emission.", evidence: ["Count equals backend"] };
async function ready(manager: ReturnType<typeof createImportTypeAnalysis>, id = "id") {
  await vi.waitFor(() => expect(manager.status(scope, id).status).toBe("READY"));
  return manager.status(scope, id);
}
describe("free import type preview lifecycle", () => {
  it("reads once, scopes results, preserves definitions, and commits the reviewed recommendation", async () => {
    const analyze = vi.fn().mockResolvedValue([result]), authorize = vi.fn().mockResolvedValue(undefined);
    const manager = createImportTypeAnalysis(analyze);
    manager.start(scope, "id", [c], authorize); manager.start(scope, "id", [c], authorize);
    const status = await ready(manager);
    expect(analyze).toHaveBeenCalledTimes(1); expect(authorize).toHaveBeenCalledTimes(1);
    expect(status).toMatchObject({ completed: 1, total: 1, failed: 0 });
    expect(() => manager.status({ ...scope, actorId: "outsider" }, "id")).toThrow("expired");
    const [applied] = manager.apply(scope, "id", "Sheet", [row]);
    expect(applied).toMatchObject({ title: row.title, when: row.when, then: row.then, testType: "FUNCTIONAL", typeOrigin: "SEMANTIC" });
    expect(applied?.reviewReasons?.join(" ")).toContain(result.reason);
    expect(row.testType).toBe("OTHER");
    expect(() => manager.apply(scope, "id", "Sheet", [{ ...row, then: ["Changed assertion"] }])).toThrow("changed");
  });
  it("never replaces recognized source or explicit reviewer types", async () => {
    const manager = createImportTypeAnalysis(vi.fn().mockResolvedValue([result])); manager.start(scope, "id", [c], async () => {}); await ready(manager);
    for (const typeOrigin of ["SOURCE", "REVIEWER"] as const)
      expect(manager.apply(scope, "id", "Sheet", [{ ...row, testType: "REGRESSION", typeOrigin }])[0]?.testType).toBe("REGRESSION");
  });
  it("binds contextual definitions canonically after the real API schema reorders JSON fields", async () => {
    const contextual = { ...row, suitePath: "Workflow / Checkout", background: "Source note" };
    const input = importTypeCaseSchema.parse(importTypeCase(importCaseId("Sheet", 2), contextual));
    const manager = createImportTypeAnalysis(vi.fn().mockResolvedValue([result]));
    manager.start(scope, "id", [input], async () => {}); await ready(manager);
    expect(manager.apply(scope, "id", "Sheet", [contextual])[0]).toMatchObject({ suitePath: contextual.suitePath, background: contextual.background, testType: "FUNCTIONAL" });
  });
  it("does not call a provider after membership authorization fails or invent a fallback", async () => {
    const analyze = vi.fn(), manager = createImportTypeAnalysis(analyze);
    manager.start(scope, "id", [c], async () => { throw Error("Revoked"); });
    expect((await ready(manager)).results[0]).toMatchObject({ testType: null, confidence: "LOW" });
    expect(analyze).not.toHaveBeenCalled();
  });
  it("reuses completed definitions after edits without re-reading unchanged cases", async () => {
    const analyze = vi.fn().mockImplementation(async cases => cases.map((item: typeof c) => ({ ...result, id: item.id })));
    const manager = createImportTypeAnalysis(analyze); manager.start(scope, "id", [c], async () => {}); await ready(manager);
    const newCase = { ...c, id: "new-row" };
    manager.start(scope, "next", [c, newCase], async () => {}); await ready(manager, "next");
    expect(analyze.mock.calls[1]![0]).toEqual([newCase]);
    expect(manager.start(scope, "third", [c, newCase], async () => {}).requestId).toBe("next");
  });
  it("retains failures as unclassified and never imports or debits any credit ledger", async () => {
    const manager = createImportTypeAnalysis(vi.fn().mockRejectedValue(Error("Provider unavailable")));
    manager.start(scope, "id", [c], async () => {});
    expect((await ready(manager)).results[0]).toMatchObject({ testType: null, evidence: [] });
    expect(manager.apply(scope, "id", "Sheet", [row])[0]?.testType).toBe("OTHER");
  });
  it("cancellation discards late responses and never creates a completed receipt", async () => {
    let finish!: (value: typeof result[]) => void;
    const analyze = vi.fn(() => new Promise<typeof result[]>(resolve => { finish = resolve; }));
    const manager = createImportTypeAnalysis(analyze); manager.start(scope, "id", [c], async () => {});
    await vi.waitFor(() => expect(analyze).toHaveBeenCalledTimes(1));
    manager.cancel(scope, "id"); finish([result]);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(manager.status(scope, "id")).toMatchObject({ status: "CANCELLED", completed: 0, results: [] });
    expect(() => manager.apply(scope, "id", "Sheet", [row])).toThrow("finish");
  });
  it("packs complete cases, bounds concurrent provider calls and accounts for every result", async () => {
    let active = 0, maximum = 0;
    const analyze = vi.fn(async (cases: typeof c[]) => {
      maximum = Math.max(maximum, ++active); await new Promise(resolve => setTimeout(resolve, 2)); active--;
      return cases.map(item => ({ ...result, id: item.id }));
    });
    const manager = createImportTypeAnalysis(analyze), cases = Array.from({ length: 45 }, (_, i) => ({ ...c, id: String(i) }));
    manager.start(scope, "id", cases, async () => {});
    const state = await ready(manager);
    expect(state).toMatchObject({ total: 45, completed: 45, failed: 0 }); expect(state.results).toHaveLength(45);
    expect(maximum).toBe(2); expect(analyze.mock.calls.map(call => call[0].length).sort()).toEqual([20, 20, 5].sort());
    expect(analyze.mock.calls.flatMap(call => call[0]).sort((a, b) => Number(a.id) - Number(b.id))).toEqual(cases);
  });
  it("allows repeated manual-selection edits to reuse results without consuming provider-start quota or filling the cache", async () => {
    const analyze = vi.fn(async (cases: typeof c[]) => cases.map(item => item.id === "0" ? {
      ...result, id: item.id, testType: null, confidence: "LOW" as const, objective: "Definition lacks an assertion", reason: "No actions or outcome were supplied.", evidence: [],
    } : { ...result, id: item.id }));
    const manager = createImportTypeAnalysis(analyze), cases = Array.from({ length: 8 }, (_, i) => ({ ...c, id: String(i) }));
    manager.start(scope, "base", cases, async () => {}); await ready(manager, "base");
    expect(manager.status(scope, "base").results.find(r => r.id === "0")).toMatchObject({ modelAnalyzed: true, testType: null, evidence: [] });
    for (let mask = 1; mask <= 40; mask++) {
      const id = `edit-${mask}`;
      manager.start(scope, id, cases.filter((_, i) => Boolean(mask & (1 << i))), async () => {});
      await ready(manager, id);
    }
    expect(analyze).toHaveBeenCalledTimes(1);
  });
});
