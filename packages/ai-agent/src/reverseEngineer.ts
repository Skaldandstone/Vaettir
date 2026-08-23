import Anthropic from "@anthropic-ai/sdk";
import {
  ReverseEngineerResultSchema,
  type ReverseEngineerResult,
  detectFramework,
} from "@qi/core";

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

const EMIT_TEST_CASES_TOOL: Anthropic.Tool = {
  name: "emit_test_cases",
  description:
    "Emit the reverse-engineered, human-readable BDD test case(s) extracted from the source.",
  input_schema: {
    type: "object",
    properties: {
      detectedFramework: { type: "string" },
      detectedFrameworkFamily: { type: "string" },
      testCases: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            background: { type: ["string", "null"] },
            given: { type: "array", items: { type: "string" }, minItems: 1 },
            when: { type: "array", items: { type: "string" }, minItems: 1 },
            then: { type: "array", items: { type: "string" }, minItems: 1 },
            tags: { type: "array", items: { type: "string" } },
            testType: {
              type: "string",
              enum: [
                "UNIT",
                "FUNCTIONAL",
                "CONTRACT",
                "INSTRUMENTATION",
                "SMOKE",
                "SANITY",
                "REGRESSION",
                "E2E",
                "PERFORMANCE",
                "SECURITY",
                "ACCESSIBILITY",
                "EXPLORATORY",
                "COMPLIANCE",
                "OTHER",
              ],
            },
            confidence: { type: "number" },
            sourceFunctionName: { type: ["string", "null"] },
            notes: { type: ["string", "null"] },
          },
          required: ["title", "given", "when", "then", "testType", "confidence"],
        },
      },
    },
    required: ["detectedFramework", "detectedFrameworkFamily", "testCases"],
  },
};

const SYSTEM_PROMPT = `You are a senior QA engineer reverse-engineering automated test code into
human-readable, business-stakeholder-friendly BDD test cases (Given/When/Then).

Rules:
- One BDD test case per distinct test/assertion block in the source (e.g. one per \`it(...)\`, \`def test_...\`, \`@Test\` method, Cypress \`it(...)\`, etc).
- Write steps in plain business language, not code or implementation detail. Say what the user/system does and what should be observed, not variable names or internal calls, unless a name is the only way to keep the step unambiguous.
- "Given" establishes preconditions/state. "When" is the action under test. "Then" is the observable, verifiable outcome — mirror the actual assertions, don't invent behavior that isn't checked.
- Infer testType from what the test actually exercises (network/DB boundary => CONTRACT or FUNCTIONAL; pure function => UNIT; UI flow => E2E or FUNCTIONAL; perf assertions => PERFORMANCE; auth/permissions => SECURITY, etc).
- Set confidence 0-1: lower it when the source is ambiguous, heavily mocked in ways that obscure real behavior, or when you had to guess intent.
- If a framework you don't fully recognize is used, still do your best structural read (setup/act/assert phases, naming conventions) and reflect that uncertainty in confidence and notes.
- Always call the emit_test_cases tool with your result. Do not respond in plain text.`;

export interface ReverseEngineerInput {
  filePath: string;
  content: string;
}

export async function reverseEngineerTestFile(
  input: ReverseEngineerInput,
): Promise<ReverseEngineerResult> {
  const heuristic = detectFramework(input.filePath, input.content);

  const message = await getClient().messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    tools: [EMIT_TEST_CASES_TOOL],
    tool_choice: { type: "tool", name: "emit_test_cases" },
    messages: [
      {
        role: "user",
        content: `File path: ${input.filePath}\nHeuristically detected framework: ${heuristic.label} (${heuristic.family})\n\n---\n${input.content}\n---\n\nReverse-engineer this into BDD test cases.`,
      },
    ],
  });

  const toolUse = message.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
  );
  if (!toolUse) {
    throw new Error("Agent did not return a tool_use block");
  }

  return ReverseEngineerResultSchema.parse(toolUse.input);
}
