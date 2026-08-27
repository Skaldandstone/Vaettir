import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

const MODEL = "claude-sonnet-5";

let client: Anthropic | undefined;
function getClient(): Anthropic {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is not set");
    }
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

// Defensive: some tool-use responses have been observed leaking an internal
// XML-style call representation (`<parameter name="x">[...]</parameter>`)
// into a field's value as a plain string instead of a real JSON array, in
// place of the array the tool schema declares. When that happens, pull the
// bracketed JSON substring out and parse it rather than failing the whole
// generation on what's ultimately still well-formed data underneath.
function coerceStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((x): x is string => typeof x === "string");
  if (typeof value === "string") {
    const start = value.indexOf("[");
    const end = value.lastIndexOf("]");
    if (start !== -1 && end > start) {
      try {
        const parsed = JSON.parse(value.slice(start, end + 1));
        if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === "string");
      } catch {
        // fall through to empty array below
      }
    }
  }
  return [];
}

export const QaStrategyDraftSchema = z.object({
  riskAreas: z.array(z.string()),
  environments: z.array(z.string()),
  entryCriteria: z.array(z.string()),
  exitCriteria: z.array(z.string()),
});
export type QaStrategyDraft = z.infer<typeof QaStrategyDraftSchema>;

const EMIT_STRATEGY_TOOL: Anthropic.Tool = {
  name: "emit_qa_strategy_draft",
  description: "Emit a draft QA strategy plan.",
  input_schema: {
    type: "object",
    properties: {
      riskAreas: { type: "array", items: { type: "string" }, description: "Parts of the product most likely to break or most costly if they do, specific to this project and prompt." },
      environments: { type: "array", items: { type: "string" }, description: "Where testing under this strategy should actually run." },
      entryCriteria: { type: "array", items: { type: "string" }, description: "What must be true before testing under this strategy can start." },
      exitCriteria: { type: "array", items: { type: "string" }, description: "What must be true to call this strategy's testing done." },
    },
    required: ["riskAreas", "environments", "entryCriteria", "exitCriteria"],
  },
};

const SYSTEM_PROMPT = `You are a senior QA lead drafting a STARTER test strategy for a project, to be reviewed and edited by a
human before it's used for real. You are given a short prompt describing what's changing or shipping, plus a
real summary of the project's existing test coverage (frameworks in use, how many tests exist per type).

Rules:
- Ground riskAreas in the actual prompt and the project's real tooling/coverage summary you're given -- don't
  produce generic boilerplate ("test all critical paths") that could apply to any project. If the summary shows
  heavy Cypress/Playwright e2e coverage but no unit tests, say so in how you frame risk areas and environments.
- Each list should have 3-6 concrete, specific items. Short phrases, not paragraphs.
- entryCriteria and exitCriteria should be genuinely checkable conditions ("Feature flag enabled in staging",
  "Zero open Sev1 defects"), not vague aspirations ("code is good quality").
- This is a draft a human will edit -- it's fine (expected, even) to surface a gap explicitly as a risk area if
  the coverage summary suggests one (e.g. "no existing automated coverage for X" is a legitimate risk area).
- Always call the emit_qa_strategy_draft tool. Do not respond in plain text.`;

export interface GenerateQaStrategyInput {
  projectName: string;
  prompt: string;
  frameworksInUse: string[];
  testTypeCounts: Record<string, number>;
  totalTestCases: number;
}

export async function generateQaStrategyDraft(input: GenerateQaStrategyInput): Promise<QaStrategyDraft> {
  const coverageLines = Object.entries(input.testTypeCounts)
    .map(([type, count]) => `- ${type}: ${count}`)
    .join("\n");

  const message = await getClient().messages.create({
    model: MODEL,
    max_tokens: 1536,
    system: SYSTEM_PROMPT,
    tools: [EMIT_STRATEGY_TOOL],
    tool_choice: { type: "tool", name: "emit_qa_strategy_draft" },
    messages: [
      {
        role: "user",
        content: `Project: ${input.projectName}
Total existing test cases: ${input.totalTestCases}
Test frameworks in use: ${input.frameworksInUse.length > 0 ? input.frameworksInUse.join(", ") : "none detected yet"}
Existing coverage by test type:
${coverageLines || "(no test cases yet)"}

What's changing or shipping: ${input.prompt}

Draft a starter QA strategy for this.`,
      },
    ],
  });

  const toolUse = message.content.find((block): block is Anthropic.ToolUseBlock => block.type === "tool_use");
  if (!toolUse) {
    throw new Error("Agent did not return a tool_use block");
  }

  const raw = toolUse.input as Record<string, unknown>;
  const normalized = {
    riskAreas: coerceStringArray(raw.riskAreas),
    environments: coerceStringArray(raw.environments),
    entryCriteria: coerceStringArray(raw.entryCriteria),
    exitCriteria: coerceStringArray(raw.exitCriteria),
  };

  return QaStrategyDraftSchema.parse(normalized);
}
