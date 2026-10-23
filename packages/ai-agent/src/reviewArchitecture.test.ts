import { describe, expect, it, vi } from "vitest";
const create = vi.hoisted(() => vi.fn());
vi.mock("@anthropic-ai/sdk", () => ({ default: class { messages = { create }; } }));
import { ARCHITECTURE_SYSTEM, reviewArchitecture, validateArchitectureReview, type ArchitectureCase } from "./reviewArchitecture.js";
const elements = [{ id: "pay", label: "Payments", kind: "COMPONENT" as const, quote: 'component "Payments" as pay', line: 2 }];
const tc: ArchitectureCase = { id: "case-1", displayId: "PAY-1", title: "Restore purchase", background: "Guest account", given: ["Purchased coins"], when: ["Restore purchase"], then: ["Previously spent coins are not credited again"], steps: [{ action: "Check ledger", expectedActionOrData: null, expectedResult: "Balance is unchanged", expectedResponse: null }], sharedSteps: [{ action: "Sign in" }], verificationProfile: { environment: "Sandbox" } };
const match = { elementId: "pay", confidence: "MEDIUM", reason: "Purchase restoration exercises the payment responsibility; exact ledger ownership needs review.", caseEvidence: [tc.when[0]], diagramEvidence: [elements[0]!.quote] };
const mapping = { caseId: tc.id, unmappedReason: "", matches: [match] };
const draft = { title: "Payment restoration", preconditions: ["Existing purchase"], actions: ["Restore purchase"], expectedResults: ["Review restoration outcome against the approved payment contract"], elementIds: ["pay"], diagramEvidence: [elements[0]!.quote], assumptions: ["The diagram does not define restoration semantics."], confidence: "LOW" };
describe("architecture semantic evidence contract", () => {
  it("sends complete case and step context and protects against instruction-like document content", async () => {
    create.mockResolvedValue({ stop_reason: "tool_use", content: [{ type: "tool_use", name: "emit_architecture_review", input: { mappings: [mapping], suggestions: [] } }] });
    expect(await reviewArchitecture(elements, [tc])).toEqual({ mappings: [mapping], suggestions: [] });
    expect(JSON.parse(create.mock.calls.at(-1)![0].messages[0].content)).toEqual({ elements, cases: [tc] });
    expect(ARCHITECTURE_SYSTEM).toContain("not keyword/title similarity");expect(ARCHITECTURE_SYSTEM).toContain("untrusted data");expect(ARCHITECTURE_SYSTEM).toContain("NOT measured code coverage");
  });
  it("allows uncertain matches and explicit unmapped cases without manufacturing a link", () => {
    expect(validateArchitectureReview(elements, [tc], { mappings: [{ ...mapping, matches: [], unmappedReason: "No assertion establishes the component exercised." }], suggestions: [] }).mappings[0]!.matches).toEqual([]);
    expect(validateArchitectureReview(elements, [tc], { mappings: [{ ...mapping, matches: [{ ...match, confidence: "LOW" }] }], suggestions: [] }).mappings[0]!.matches[0]!.confidence).toBe("LOW");
  });
  it("rejects missing or duplicate cases, unknown elements and unsupported evidence", () => {
    for (const mappings of [[], [mapping, mapping], [{ ...mapping, caseId: "another-tenant-case" }], [{ ...mapping, matches: [{ ...match, elementId: "invented" }] }], [{ ...mapping, matches: [{ ...match, caseEvidence: ["PAY-1"] }] }], [{ ...mapping, matches: [{ ...match, diagramEvidence: ["guaranteed retries"] }] }]]) expect(() => validateArchitectureReview(elements, [tc], { mappings, suggestions: [] })).toThrow();
  });
  it("grounds draft procedures and keeps assumptions separate without mandatory Gherkin", () => {
    expect(validateArchitectureReview(elements, [], { mappings: [], suggestions: [draft] }).suggestions[0]).toEqual(draft);
    expect(() => validateArchitectureReview(elements, [], { mappings: [], suggestions: [{ ...draft, elementIds: ["made-up"] }] })).toThrow();
    expect(() => validateArchitectureReview(elements, [tc], { mappings: [mapping], suggestions: [draft] })).toThrow();
  });
  it("rejects incomplete provider output and over-capacity batches without truncating", async () => {
    create.mockResolvedValue({ stop_reason: "max_tokens", content: [] });
    await expect(reviewArchitecture(elements, [tc])).rejects.toThrow("incomplete");
    await expect(reviewArchitecture(elements, [{ ...tc, background: "x".repeat(270000) }])).rejects.toThrow("no definitions were truncated");
  });
});
