import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
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

export const TestPlanRecommendationSchema = z.object({
  relevantTestPlanIds: z.array(z.string()),
  rationale: z.string(),
  suggestedNewTestCases: z.array(z.string()),
});
export type TestPlanRecommendation = z.infer<typeof TestPlanRecommendationSchema>;

const EMIT_RECOMMENDATION_TOOL: Anthropic.Tool = {
  name: "emit_test_plan_recommendation",
  description: "Emit which existing test plans are relevant to this change, and whether new test cases seem warranted.",
  input_schema: {
    type: "object",
    properties: {
      relevantTestPlanIds: {
        type: "array",
        items: { type: "string" },
        description: "The `id` of every test plan from the provided list that this diff makes relevant. Empty array if none are.",
      },
      rationale: {
        type: "string",
        description: "1-3 sentences on why those plans (or none) are relevant, grounded in what the diff actually changed.",
      },
      suggestedNewTestCases: {
        type: "array",
        items: { type: "string" },
        description:
          "Short descriptions of NEW test cases this diff seems to warrant that existing plans/cases don't already cover (e.g. a new branch, edge case, or error path introduced). Empty array if the diff doesn't seem to need new coverage beyond what already exists.",
      },
    },
    required: ["relevantTestPlanIds", "rationale", "suggestedNewTestCases"],
  },
};

const SYSTEM_PROMPT = `You are a senior QA engineer reviewing a code diff (a PR's actual changes, not just a list of
changed file names) to decide which of the project's existing test plans are relevant to it, and whether the
change looks like it needs test coverage beyond what already exists.

Rules:
- Base your judgment on what the diff actually changed (new branches, new error paths, changed function
  signatures, removed guards, new edge cases), not just which files were touched -- a one-line comment change
  in a file is not the same as a new conditional branch in it.
- Only mark a test plan relevant if the diff's actual behavior change plausibly falls within that plan's
  described scope -- don't mark everything relevant defensively.
- suggestedNewTestCases should be genuinely new gaps the diff introduces, not a restatement of what's
  probably already tested. Empty is a completely valid answer when the diff doesn't need new coverage.
- If given zero test plans, relevantTestPlanIds should be empty -- don't invent one.
- Always call the emit_test_plan_recommendation tool. Do not respond in plain text.`;

export interface RecommendTestPlansInput {
  diffContent: string;
  testPlans: { id: string; name: string; description?: string | null }[];
}

export async function recommendTestPlansForDiff(input: RecommendTestPlansInput): Promise<TestPlanRecommendation> {
  const plansText =
    input.testPlans.length > 0
      ? input.testPlans.map((p) => `- id="${p.id}" name="${p.name}"${p.description ? `: ${p.description}` : ""}`).join("\n")
      : "(no existing test plans in this project)";

  const message = await traceAnthropicCall("recommendTestPlansForDiff", MODEL, () =>
    getClient().messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      tools: [EMIT_RECOMMENDATION_TOOL],
      tool_choice: { type: "tool", name: "emit_test_plan_recommendation" },
      messages: [
        {
          role: "user",
          content: `Existing test plans in this project:\n${plansText}\n\nThe diff:\n\n${input.diffContent}\n\nWhich plans are relevant, and does this diff warrant new test cases?`,
        },
      ],
    }),
  );

  const toolUse = message.content.find((block): block is Anthropic.ToolUseBlock => block.type === "tool_use");
  if (!toolUse) {
    throw new Error("Agent did not return a tool_use block");
  }

  return TestPlanRecommendationSchema.parse(toolUse.input);
}
