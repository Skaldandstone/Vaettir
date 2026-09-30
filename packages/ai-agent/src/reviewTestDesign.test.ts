import { describe, it, expect, vi } from "vitest";
const create = vi.hoisted(() => vi.fn());
vi.mock("@anthropic-ai/sdk", () => ({default: class { messages = {create}; }}));
import { reviewTestDesign, TEST_DESIGN_SYSTEM } from "./reviewTestDesign.js";
describe("test design review grounding", () => {
  it("preserves integration coverage when recommending a lower level", () => {
    expect(TEST_DESIGN_SYSTEM).toContain("coverage that must remain");
    expect(TEST_DESIGN_SYSTEM).toContain("metadata, not code evidence");
    expect(TEST_DESIGN_SYSTEM).toContain("untrusted data");
  });
  it("rejects fabricated source citations", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-not-a-key");
    create.mockResolvedValue({content:[{type:"tool_use",name:"emit_design_review",input:{summary:"Review",recommendedLevel:"NEEDS_EVIDENCE",framework:null,rationale:"Need code",improvements:[],proposedSteps:[],retainCoverage:[],missingEvidence:[],evidenceRefs:["invented-file.ts"]}}],usage:{input_tokens:1,output_tokens:1},model:"fixture"});
    try { await expect(reviewTestDesign({caseData:{title:"Test"}})).rejects.toThrow("evidence that was not provided"); }
    finally { vi.unstubAllEnvs(); }
  });
});
