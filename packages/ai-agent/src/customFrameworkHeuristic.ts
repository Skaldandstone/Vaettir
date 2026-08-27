import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";

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

export const InferredHeuristicSchema = z.object({
  name: z.string(),
  description: z.string(),
  confidence: z.number(),
});
export type InferredHeuristic = z.infer<typeof InferredHeuristicSchema>;

const EMIT_HEURISTIC_TOOL: Anthropic.Tool = {
  name: "emit_framework_heuristic",
  description: "Emit the inferred structural pattern for this custom test framework.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string", description: "A short, human name for this framework, e.g. \"Acme's internal e2e harness\"" },
      description: {
        type: "string",
        description:
          "A prose description of the structural pattern: how a test's name/intent is decided, how assertions are expressed, setup/teardown conventions, and anything else needed to read a NEW file in this framework and reverse-engineer it correctly.",
      },
      confidence: { type: "number", description: "0-1: how confident you are this pattern generalizes beyond just these examples." },
    },
    required: ["name", "description", "confidence"],
  },
};

const SYSTEM_PROMPT = `You are a senior QA engineer being shown 2-3 example test files from a custom or internal test
framework you don't already recognize (not Jest/pytest/JUnit/etc - something bespoke to this codebase).

Your job is NOT to reverse-engineer these specific files into test cases. It's to infer the REUSABLE
STRUCTURAL PATTERN so that pattern can be handed to another instance of you later, reading a
DIFFERENT file in this same framework, so that later read doesn't have to guess from scratch.

Look for and describe:
- How a test's name/intent is expressed (a string literal, a function name, a comment convention, a
  decorator/annotation argument, a config key, etc).
- How assertions/checks are expressed (a custom assert-like call, a fluent/chained API, an expected-
  vs-actual comparison pattern, a special return-value convention).
- Setup/teardown conventions, if any (fixtures, a base class, a config block, an ordering convention).
- Anything else distinctive that a reader would need to correctly separate "this is one test" from
  "this is another test" and pull out its intent.

Be concrete and specific to what you actually observed across these examples, not a generic description
of testing in general. If the examples are too thin or inconsistent to confidently generalize, say so
plainly in the description and set confidence low rather than inventing a pattern.

Always call the emit_framework_heuristic tool. Do not respond in plain text.`;

export interface HeuristicInferenceInput {
  files: { filePath: string; content: string }[];
}

export async function inferCustomFrameworkHeuristic(input: HeuristicInferenceInput): Promise<InferredHeuristic> {
  const filesText = input.files.map((f) => `--- ${f.filePath} ---\n${f.content}`).join("\n\n");

  const message = await getClient().messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    tools: [EMIT_HEURISTIC_TOOL],
    tool_choice: { type: "tool", name: "emit_framework_heuristic" },
    messages: [
      {
        role: "user",
        content: `Here are ${input.files.length} example test files from the same custom framework:\n\n${filesText}\n\nInfer the reusable structural pattern.`,
      },
    ],
  });

  const toolUse = message.content.find((block): block is Anthropic.ToolUseBlock => block.type === "tool_use");
  if (!toolUse) {
    throw new Error("Agent did not return a tool_use block");
  }

  return InferredHeuristicSchema.parse(toolUse.input);
}
