import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import {
  ReverseEngineeredTestCaseSchema,
  type ReverseEngineerResult,
  detectFramework,
  getFrameworkEvaluator,
} from "@vaettir/core";
import { registerJsTsEvaluators } from "./evaluators/jsTsEvaluator.js";
import { registerPytestEvaluator } from "./evaluators/pytestEvaluator.js";
import { registerJavaEvaluators } from "./evaluators/javaEvaluator.js";
import { registerMobileEvaluators } from "./evaluators/mobileEvaluator.js";
import { registerExtendedNativeEvaluators } from "./evaluators/extendedNativeEvaluator.js";
import { traceAnthropicCall } from "./tracing.js";

// P5-11/P5-07/P5-08/P5-09/P5-10: registers every native evaluator once at
// module load. Framework-family-specific evaluator modules each own their
// own registration call like these -- Epic 5.2 is now fully plugged in.
registerJsTsEvaluators();
registerPytestEvaluator();
registerJavaEvaluators();
registerMobileEvaluators();
registerExtendedNativeEvaluators();

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
  // P5-12: a previously-inferred structural pattern for this project's
  // custom framework (see customFrameworkHeuristic.ts), passed in by the
  // caller when one exists. Only meaningful for CUSTOM-family files -- a
  // known framework already gets deterministic structure extraction below,
  // which doesn't need or use this.
  customFrameworkHint?: string;
}

// P5-11/P5-07: when a native evaluator is registered for the detected
// framework and it successfully extracts test blocks, the model gets this
// pre-parsed, per-test breakdown instead of the raw file -- cheaper (no
// need to re-derive structure the parser already extracted), faster, and
// more reliable for well-known frameworks than asking the model to mentally
// parse describe/it nesting out of raw source itself. Falls straight back
// to the raw-source prompt (unchanged from before this ticket) when there's
// no evaluator for this family, or it returns null.
function buildRawSourcePrompt(
  filePath: string,
  heuristicLabel: string,
  heuristicFamily: import("@vaettir/core").FrameworkFamily,
  content: string,
  customFrameworkHint?: string,
): string {
  const hintText = customFrameworkHint
    ? `\nA structural pattern was previously learned for this project's custom framework:\n${customFrameworkHint}\n`
    : "";
  return `File path: ${filePath}\nHeuristically detected framework: ${heuristicLabel} (${heuristicFamily})\n${hintText}\n---\n${content}\n---\n\nReverse-engineer this into BDD test cases.`;
}

function buildBlocksPrompt(
  filePath: string,
  heuristicLabel: string,
  heuristicFamily: import("@vaettir/core").FrameworkFamily,
  blocks: import("@vaettir/core").ExtractedTestBlock[],
  chunkNote: string,
): string {
  const blocksText = blocks
    .map(
      (b, i) =>
        `Test block ${i + 1}: "${b.title}"\n${b.assertions.length > 0 ? `Assertions found:\n${b.assertions.map((a) => `  - ${a}`).join("\n")}\n` : ""}Body:\n${b.bodySnippet}`,
    )
    .join("\n\n---\n\n");

  return `File path: ${filePath}\nDetected framework: ${heuristicLabel} (${heuristicFamily})${chunkNote}\n\nThe following test blocks were deterministically extracted from this file (do not re-derive structure -- it's already parsed; focus on phrasing each as a clear BDD test case):\n\n${blocksText}\n\nReverse-engineer these into BDD test cases, one per test block.`;
}

// P2-09: a file whose evaluator-extracted block count is large enough to
// risk an unreliable/truncated single response gets split into batches of
// this many blocks, each its own Anthropic call. This is the "natural
// chunking unit" ROADMAP.md's P2-09 note identified -- test blocks, not
// raw byte offsets, since a byte-boundary split could sever a block mid-body.
// Only usable when a native evaluator actually extracted blocks (P5-07/08/09);
// a raw-source-only framework has no safe unit to split on and is not chunked.
const MAX_BLOCKS_PER_CALL = 15;

function chunkBlocks<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

async function callAgent(operation: string, promptContent: string): Promise<import("@vaettir/core").ReverseEngineeredTestCase[]> {
  const message = await traceAnthropicCall(operation, MODEL, () =>
    getClient().messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: [EMIT_TEST_CASES_TOOL],
      tool_choice: { type: "tool", name: "emit_test_cases" },
      messages: [{ role: "user", content: promptContent }],
    }),
  );

  const toolUse = message.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
  );
  if (!toolUse) {
    throw new Error("Agent did not return a tool_use block");
  }
  const { testCases } = AgentResponseSchema.parse(normalizeToolUseInput(toolUse.input));
  return testCases;
}

export async function reverseEngineerTestFile(
  input: ReverseEngineerInput,
): Promise<ReverseEngineerResult> {
  const heuristic = detectFramework(input.filePath, input.content);
  const evaluator = getFrameworkEvaluator(heuristic.family);
  const extracted = evaluator?.extract(input.content, input.filePath);

  // detectedFramework/detectedFrameworkFamily used to be part of what we
  // asked the model to emit, but that was unreliable in practice: the model
  // sometimes omitted them from the tool call entirely, and when present
  // returned freeform casing (e.g. "pytest") that doesn't match the strict
  // Prisma FrameworkFamily enum ("PYTEST") it gets cast into downstream.
  // We already compute this deterministically via detectFramework's regex
  // heuristics -- there's no reason to ask the LLM to guess something we
  // can derive precisely, so the heuristic result is the source of truth
  // here, not the model's output.
  let testCases: import("@vaettir/core").ReverseEngineeredTestCase[];

  if (extracted && extracted.testBlocks.length > MAX_BLOCKS_PER_CALL) {
    // P2-09: chunked path. Each batch is its own real Anthropic call, traced
    // under the same operation name -- captureAiUsage's AsyncLocalStorage
    // scope (tracing.ts) sums all of them into one usage total for whichever
    // caller wrapped this whole function call, so billing sees one real
    // aggregate cost across N requests, not N separate charges.
    const batches = chunkBlocks(extracted.testBlocks, MAX_BLOCKS_PER_CALL);
    testCases = [];
    for (let i = 0; i < batches.length; i += 1) {
      const batch = batches[i]!;
      const chunkNote = ` (batch ${i + 1} of ${batches.length}, blocks ${i * MAX_BLOCKS_PER_CALL + 1}-${i * MAX_BLOCKS_PER_CALL + batch.length} of ${extracted.testBlocks.length})`;
      const prompt = buildBlocksPrompt(input.filePath, heuristic.label, heuristic.family, batch, chunkNote);
      const batchCases = await callAgent("reverseEngineerTestFile", prompt);
      testCases.push(...batchCases);
    }
  } else {
    const prompt = extracted
      ? buildBlocksPrompt(input.filePath, heuristic.label, heuristic.family, extracted.testBlocks, "")
      : buildRawSourcePrompt(input.filePath, heuristic.label, heuristic.family, input.content, input.customFrameworkHint);
    testCases = await callAgent("reverseEngineerTestFile", prompt);
  }

  const result: ReverseEngineerResult = {
    detectedFramework: heuristic.label,
    detectedFrameworkFamily: heuristic.family,
    testCases,
  };
  return result;
}
