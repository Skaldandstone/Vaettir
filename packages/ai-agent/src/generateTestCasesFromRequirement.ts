import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { traceAnthropicCall } from "./tracing.js";

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

// Same defensive coercion as generateStrategy.ts's coerceStringArray -
// some tool-use responses have been observed leaking an internal
// XML-style call representation into an array field as a plain string.
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

export const DraftTestCaseSchema = z.object({
  title: z.string(),
  given: z.array(z.string()),
  when: z.array(z.string()),
  then: z.array(z.string()),
  priority: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]),
});
export type DraftTestCase = z.infer<typeof DraftTestCaseSchema>;

const EMIT_TOOL: Anthropic.Tool = {
  name: "emit_draft_test_cases",
  description: "Emit a set of draft BDD test cases for a requirement.",
  input_schema: {
    type: "object",
    properties: {
      testCases: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "Short, specific title describing the scenario under test." },
            given: { type: "array", items: { type: "string" }, description: "Preconditions / starting state." },
            when: { type: "array", items: { type: "string" }, description: "The action(s) taken." },
            then: { type: "array", items: { type: "string" }, description: "The expected, observable outcome(s)." },
            priority: { type: "string", enum: ["CRITICAL", "HIGH", "MEDIUM", "LOW"] },
          },
          required: ["title", "given", "when", "then", "priority"],
        },
      },
    },
    required: ["testCases"],
  },
};

// 2026-08-27 competitor parity audit: every researched competitor (qTest
// Copilot, Xray AI Test Case Generation, TestRail's Sembi IQ, Zephyr's
// HaloAI/BearQ, PractiTest's SmartFox) drafts test cases from a written
// requirement/user story. Vaettir's other AI investment goes the reverse
// direction (existing source code -> test cases, P2-*) and into strategy
// drafting (P4-02) - this is the one direction that was missing. Same
// "draft, never auto-commit" review-before-save shape as every other AI
// feature in this codebase (P2-06, P4-02, P5-12).
const SYSTEM_PROMPT = `You are a senior QA engineer drafting BDD test cases from a written requirement, to be reviewed
and edited by a human before any of them are saved for real.

Rules:
- Ground every test case in the ACTUAL requirement text you're given - never produce generic boilerplate that
  could apply to any feature.
- Cover the requirement's happy path AND its genuinely likely edge cases / failure modes (invalid input, empty
  state, permission boundaries, concurrent access if relevant) - not just the obvious case. 3-8 test cases is a
  reasonable range; fewer for a narrow requirement, more for a broad one. Don't pad with near-duplicates.
- Each given/when/then list should have 1-4 short, concrete steps - not paragraphs.
- Priority should reflect actual risk/impact if this scenario breaks, not a default.
- Always call the emit_draft_test_cases tool. Do not respond in plain text.`;

export interface GenerateTestCasesFromRequirementInput {
  requirementTitle: string;
  requirementDescription: string | null;
  projectName: string;
}

export async function generateTestCasesFromRequirement(
  input: GenerateTestCasesFromRequirementInput,
): Promise<DraftTestCase[]> {
  const message = await traceAnthropicCall("generateTestCasesFromRequirement", MODEL, () =>
    getClient().messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      tools: [EMIT_TOOL],
      tool_choice: { type: "tool", name: "emit_draft_test_cases" },
      messages: [
        {
          role: "user",
          content: `Project: ${input.projectName}

Requirement: ${input.requirementTitle}
${input.requirementDescription ? `\nDescription:\n${input.requirementDescription}` : ""}

Draft BDD test cases covering this requirement.`,
        },
      ],
    }),
  );

  const toolUse = message.content.find((block): block is Anthropic.ToolUseBlock => block.type === "tool_use");
  if (!toolUse) {
    throw new Error("Agent did not return a tool_use block");
  }

  const raw = toolUse.input as { testCases?: unknown };
  const rawCases = Array.isArray(raw.testCases) ? raw.testCases : [];
  const normalized = rawCases.map((c) => {
    const tc = c as Record<string, unknown>;
    return {
      title: typeof tc.title === "string" ? tc.title : "",
      given: coerceStringArray(tc.given),
      when: coerceStringArray(tc.when),
      then: coerceStringArray(tc.then),
      priority: (["CRITICAL", "HIGH", "MEDIUM", "LOW"].includes(tc.priority as string) ? tc.priority : "MEDIUM") as
        | "CRITICAL"
        | "HIGH"
        | "MEDIUM"
        | "LOW",
    };
  });

  return normalized.map((c) => DraftTestCaseSchema.parse(c));
}
