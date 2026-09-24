import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { ReverseEngineeredTestCaseSchema } from "@vaettir/core";
import { traceAnthropicCall } from "./tracing.js";

// SSE-181: the AI-generation half of live-app test generation. Takes a
// crawl summary (apps/api's liveAppScan.ts - title/accessible-elements per
// page, no raw source code involved) and emits BDD test cases grounded in
// what was actually observed, via the exact same forced-tool-use pattern
// reverseEngineerTestFile already uses for the anti-hallucination
// guarantee. This is the mirror-image input: ground truth is what
// Playwright's accessibility snapshot actually found on the page, not
// assertions in a source file.

const AgentResponseSchema = z.object({
  testCases: z.array(ReverseEngineeredTestCaseSchema),
});

const MODEL = "claude-sonnet-5";

let client: Anthropic | undefined;
function getClient(): Anthropic {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY)
      throw new Error("ANTHROPIC_API_KEY is not set");
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

const EMIT_TEST_CASES_TOOL: Anthropic.Tool = {
  name: "emit_test_cases",
  description:
    "Emit BDD test case(s) grounded in what was actually observed on the live app.",
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
          required: [
            "title",
            "given",
            "when",
            "then",
            "testType",
            "confidence",
          ],
        },
      },
    },
    required: ["testCases"],
  },
};

const SYSTEM_PROMPT = `You are a senior QA engineer generating BDD test cases (Given/When/Then) for
an application, grounded ONLY in the screens and interactive elements a
real browser or device capture actually observed.

Rules:
- Every element you reference (a button, link, or field name) MUST appear
  in the provided crawl data. Never invent an element, page, or flow that
  wasn't actually observed - this is the entire point of grounding in a
  real crawl instead of guessing.
- Most test types here should be E2E or FUNCTIONAL - you're describing
  observable user flows across a real UI, not unit-level internals you
  cannot see from a crawl.
- Prefer flows that span multiple observed screens when the capture data
  shows a plausible connection, since that's the kind of test a live-app scan can uniquely
  ground that a single-file source read cannot.
- Set confidence lower than you would for a source-code read: a crawl sees
  what's rendered, not what's actually wired up to work, so even a
  well-grounded case here should acknowledge more uncertainty than
  reverse-engineering an existing, presumably-passing test would.
- If the crawl data is too thin to say anything meaningful (e.g. a single
  page with no interactive elements), emit fewer, more conservative cases
  rather than padding the output.
- Always call the emit_test_cases tool. Do not respond in plain text.`;

export interface LiveAppScannedPage {
  url: string;
  title: string;
  elements: { role: string; name: string }[];
}

export interface GenerateTestCasesFromLiveAppInput {
  startUrl: string;
  pages: LiveAppScannedPage[];
  source?: {
    kind: "web" | "android" | "ios";
    name: string;
  };
}

function buildPromptContent(input: GenerateTestCasesFromLiveAppInput): string {
  const pagesText = input.pages
    .map(
      (p, i) =>
        `Page ${i + 1}: ${p.url}\nTitle: "${p.title}"\nObserved elements:\n${p.elements.map((e) => `  - ${e.role}: "${e.name}"`).join("\n") || "  (none found)"}`,
    )
    .join("\n\n---\n\n");
  const source = input.source
    ? `${input.source.kind} app capture: ${input.source.name}`
    : `web crawl starting at: ${input.startUrl}`;
  return `Observed ${source}\n\n${pagesText}\n\nGenerate BDD test cases grounded only in the screens and elements above.`;
}

export async function generateTestCasesFromLiveApp(
  input: GenerateTestCasesFromLiveAppInput,
): Promise<{ testCases: import("@vaettir/core").ReverseEngineeredTestCase[] }> {
  const message = await traceAnthropicCall(
    "generateTestCasesFromLiveApp",
    MODEL,
    () =>
      getClient().messages.create({
        model: MODEL,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools: [EMIT_TEST_CASES_TOOL],
        tool_choice: { type: "tool", name: "emit_test_cases" },
        messages: [{ role: "user", content: buildPromptContent(input) }],
      }),
  );

  const toolUse = message.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
  );
  if (!toolUse) throw new Error("Agent did not return a tool_use block");

  const { testCases } = AgentResponseSchema.parse(toolUse.input);
  return { testCases };
}
