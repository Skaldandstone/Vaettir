import { describe, expect, it, vi } from "vitest";
const create = vi.hoisted(() => vi.fn());
vi.mock("@anthropic-ai/sdk", () => ({ default: class { messages = { create }; } }));
import { IMPORT_TYPE_SYSTEM, recommendImportTypes, validateImportTypes, type ImportTypeCase } from "./recommendImportTypes.js";
const tc: ImportTypeCase = { id: "a:2", title: "Analytics dashboard", given: ["One registered account"], when: ["Open dashboard"], then: ["Total Users equals the backend registered user count"], tags: ["metric"] };
const recommendation = { id: tc.id, testType: "FUNCTIONAL", confidence: "HIGH", objective: "Verify dashboard count accuracy", reason: "The asserted business value must equal the registered-user count; this does not inspect emitted telemetry.", evidence: [tc.then[0]] };
describe("semantic import type review", () => {
  it("sends every full definition and requests purpose/primary assertion, not keyword inference", async () => {
    create.mockResolvedValue({ stop_reason: "tool_use", content: [{ type: "tool_use", name: "emit_import_types", input: { recommendations: [recommendation] } }] });
    expect(await recommendImportTypes([tc])).toEqual([recommendation]);
    const request = create.mock.calls.at(-1)![0];
    expect(JSON.parse(request.messages[0].content).cases).toEqual([tc]);
    expect(request.max_tokens).toBe(8192);
    expect(IMPORT_TYPE_SYSTEM).toContain("not by keywords");
    expect(IMPORT_TYPE_SYSTEM).toContain("never default to Functional");
    expect(IMPORT_TYPE_SYSTEM).toContain("untrusted data");
    expect(IMPORT_TYPE_SYSTEM).toContain("dashboard is NOT sufficient");
  });
  it("requires exact complete one-to-one row identities", () => {
    for (const recommendations of [[], [recommendation, recommendation], [{ ...recommendation, id: "invented" }]])
      expect(() => validateImportTypes([tc], { recommendations })).toThrow();
  });
  it("rejects fabricated support and does not accept metadata-only evidence", () => {
    expect(() => validateImportTypes([tc], { recommendations: [{ ...recommendation, evidence: ["Metric event emitted"] }] })).toThrow("not supplied");
    expect(() => validateImportTypes([tc], { recommendations: [{ ...recommendation, evidence: ["metric"] }] })).toThrow("not supplied");
    expect(() => validateImportTypes([tc], { recommendations: [{ ...recommendation, evidence: [] }] })).toThrow("no supporting");
  });
  it("leaves low-confidence guesses unclassified, not Functional", () => {
    expect(validateImportTypes([tc], { recommendations: [{ ...recommendation, confidence: "LOW" }] })[0]).toMatchObject({ testType: null, confidence: "LOW" });
  });
  it("rejects incomplete model responses", async () => {
    create.mockResolvedValue({ stop_reason: "max_tokens", content: [{ type: "tool_use", name: "emit_import_types", input: { recommendations: [recommendation] } }] });
    await expect(recommendImportTypes([tc])).rejects.toThrow("incomplete");
  });
});
