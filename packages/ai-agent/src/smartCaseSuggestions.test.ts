import { describe, expect, it, vi } from "vitest";
const create = vi.hoisted(() => vi.fn());
vi.mock("@anthropic-ai/sdk", () => ({ default: class { messages = { create }; } }));
import { SMART_CASE_SYSTEM, SMART_MAPPING_SYSTEM, suggestCaseOrganization, suggestImportColumns, validateSmartCases, validateSmartMapping } from "./smartCaseSuggestions.js";
const testCase = { id: "case-1", title: "Restore purchase", given: ["A purchased entitlement"], when: ["Reinstall and restore"], then: ["Access is restored without another charge"], tags: ["Billing"], priority: "MEDIUM" as const };
const suggestion = { id: testCase.id, suitePath: "Billing/Restore", priority: "HIGH", testType: "FUNCTIONAL", confidence: "HIGH", reason: "Restoration affects purchased access and prevents a second charge.", evidence: [testCase.then[0]] };
const mapping = { field: "title", column: "Scenario text", confidence: "HIGH", reason: "This column describes the behavior under test.", evidence: ["Restore purchase"] };
describe("content-based import and organization suggestions", () => {
  it("requires complete, distinct identities and exact supporting excerpts", () => {
    for (const suggestions of [[], [suggestion, suggestion], [{ ...suggestion, id: "foreign" }], [{ ...suggestion, evidence: ["Made-up behavior"] }], [{ ...suggestion, evidence: [] }]])
      expect(() => validateSmartCases([testCase], { suggestions })).toThrow();
  });
  it("does not turn uncertain classifications, priorities or placement into changes", () => {
    expect(validateSmartCases([testCase], { suggestions: [{ ...suggestion, confidence: "LOW" }] })[0]).toMatchObject({ suitePath: null, priority: null, testType: null });
  });
  it("sends the entire case and existing hierarchy with an instruction/data boundary", async () => {
    create.mockResolvedValue({ stop_reason: "tool_use", content: [{ type: "tool_use", name: "suggest", input: { result: { suggestions: [suggestion] } } }] });
    expect(await suggestCaseOrganization([testCase], ["Billing", "Billing/Restore"])).toEqual([suggestion]);
    const request = create.mock.calls.at(-1)![0];
    expect(JSON.parse(request.messages[0].content)).toEqual({ cases: [testCase], knownSuites: ["Billing", "Billing/Restore"] });
    expect(SMART_CASE_SYSTEM).toContain("untrusted data");
    expect(SMART_CASE_SYSTEM).toContain("not word frequency"); expect(SMART_CASE_SYSTEM).toContain("Prefer an existing suite");
  });
  it("maps unfamiliar headers using supplied cell evidence, with distinct field/column assignments", async () => {
    const headers = ["Scenario text", "Observed status"], rows = [["Restore purchase", "Failed"]];
    create.mockResolvedValue({ stop_reason: "tool_use", content: [{ type: "tool_use", name: "suggest", input: { result: { mappings: [mapping] } } }] });
    expect(await suggestImportColumns(headers, rows)).toEqual([mapping]);
    expect(SMART_MAPPING_SYSTEM).toContain("never map pass/fail results");
    for (const mappings of [[mapping, mapping], [{ ...mapping, column: "unknown" }], [{ ...mapping, evidence: ["Not in this column"] }], [{ ...mapping, field: "when", column: "Scenario text" }, mapping]])
      expect(() => validateSmartMapping(headers, rows, { mappings })).toThrow();
    expect(() => validateSmartMapping(["Scenario text", "Scenario text"], rows, { mappings: [mapping] })).toThrow();
  });
  it("omits low-confidence mappings and refuses incomplete or oversized model output", async () => {
    expect(validateSmartMapping(["Scenario text"], [["Restore purchase"]], { mappings: [{ ...mapping, confidence: "LOW" }] })).toEqual([]);
    create.mockResolvedValue({ stop_reason: "max_tokens", content: [] });
    await expect(suggestCaseOrganization([testCase], [])).rejects.toThrow("incomplete");
    await expect(suggestCaseOrganization([{ ...testCase, then: Array(100).fill("x".repeat(2000)) }], [])).rejects.toThrow("no text was truncated");
  });
});
