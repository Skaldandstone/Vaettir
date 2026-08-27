import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import {
  ReverseEngineeredTestCaseSchema,
  type ReverseEngineerResult,
  detectFramework,
  getFrameworkEvaluator,
} from "@vaettir/core";
import { registerJsTsEvaluators } from "./evaluators/jsTsEvaluator.js";

// P5-11/P5-07: registers the native JS/TS evaluator once at module load.
// Framework-family-specific evaluator modules each own their own
// registration call like this one; adding P5-08/09/10 later is adding
// another such call, not touching reverseEngineerTestFile itself.
registerJsTsEvaluators();

const AgentResponseSchema = z.object({ testCases: z.array(ReverseEngineeredTestCaseSchema) });

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
    required: ["testCases"],
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

// For larger/more complex source files, the model sometimes double-encodes
// its tool_use input: instead of a native `{ testCases: [...] }` object, it
// emits `{ testCases: "{\"testCases\":[...]}" }` -- the whole payload
// JSON-stringified and nested one level too deep inside the very field
// it's supposed to be. Observed for real against a ~60-line Playwright spec
// (github.com/Grunklegrok/Kall's submission-pipeline.spec.ts), not a
// theoretical edge case. Anthropic tool schemas don't hard-enforce types
// any more than they enforce "required" (see the framework-detection fix
// above), so this is handled the same way: detect the malformed shape and
// recover instead of crashing.
function normalizeToolUseInput(rawInput: unknown): unknown {
  if (typeof rawInput !== "object" || rawInput === null || !("testCases" in rawInput)) {
    return rawInput;
  }
  const testCases = (rawInput as { testCases: unknown }).testCases;
  if (typeof testCases !== "string") {
    return rawInput;
  }
  const parsed: unknown = JSON.parse(testCases);
  if (Array.isArray(parsed)) {
    return { testCases: parsed };
  }
  if (typeof parsed === "object" && parsed !== null && "testCases" in parsed) {
    return parsed;
  }
  return rawInput;
}

export interface ReverseEngineerInput {
  filePath: string;
  content: string;
}

// P5-11/P5-07: when a native evaluator is registered for the detected
// framework and it successfully extracts test blocks, the model gets this
// pre-parsed, per-test breakdown instead of the raw file -- cheaper (no
// need to re-derive structure the parser already extracted), faster, and
// more reliable for well-known frameworks than asking the model to mentally
// parse describe/it nesting out of raw source itself. Falls straight back
// to the raw-source prompt (unchanged from before this ticket) when there's
// no evaluator for this family, or it returns null.
function buildPromptContent(
  filePath: string,
  heuristicLabel: string,
  heuristicFamily: import("@vaettir/core").FrameworkFamily,
  content: string,
): string {
  const evaluator = getFrameworkEvaluator(heuristicFamily);
  const extracted = evaluator?.extract(content, filePath);

  if (!extracted) {
    return `File path: ${filePath}\nHeuristically detected framework: ${heuristicLabel} (${heuristicFamily})\n\n---\n${content}\n---\n\nReverse-engineer this into BDD test cases.`;
  }

  const blocksText = extracted.testBlocks
    .map(
      (b, i) =>
        `Test block ${i + 1}: "${b.title}"\n${b.assertions.length > 0 ? `Assertions found:\n${b.assertions.map((a) => `  - ${a}`).join("\n")}\n` : ""}Body:\n${b.bodySnippet}`,
    )
    .join("\n\n---\n\n");

  return `File path: ${filePath}\nDetected framework: ${heuristicLabel} (${heuristicFamily})\n\nThe following test blocks were deterministically extracted from this file (do not re-derive structure -- it's already parsed; focus on phrasing each as a clear BDD test case):\n\n${blocksText}\n\nReverse-engineer these into BDD test cases, one per test block.`;
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
        content: buildPromptContent(input.filePath, heuristic.label, heuristic.family, input.content),
      },
    ],
  });

  const toolUse = message.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
  );
  if (!toolUse) {
    throw new Error("Agent did not return a tool_use block");
  }

  // detectedFramework/detectedFrameworkFamily used to be part of what we
  // asked the model to emit, but that was unreliable in practice: the model
  // sometimes omitted them from the tool call entirely, and when present
  // returned freeform casing (e.g. "pytest") that doesn't match the strict
  // Prisma FrameworkFamily enum ("PYTEST") it gets cast into downstream.
  // We already compute this deterministically via detectFramework's regex
  // heuristics -- there's no reason to ask the LLM to guess something we
  // can derive precisely, so the heuristic result is the source of truth
  // here, not the model's output.
  const { testCases } = AgentResponseSchema.parse(normalizeToolUseInput(toolUse.input));
  const result: ReverseEngineerResult = {
    detectedFramework: heuristic.label,
    detectedFrameworkFamily: heuristic.family,
    testCases,
  };
  return result;
}
