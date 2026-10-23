import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { traceAnthropicCall } from "./tracing.js";

const MODEL = "claude-sonnet-5";

export const ObservedElementSchema = z.object({
  role: z.string(),
  name: z.string(),
  stableId: z.string().optional(),
  selector: z.string().optional(),
  event: z.string().optional(),
  route: z.string().optional(),
});

export const LiveAppActionSchema = z.object({
  action: z.string().min(1),
  target: ObservedElementSchema,
  input: z.string().nullable().optional(),
  expectedResult: z.string().min(1),
  expectedResponse: z.string().nullable().optional(),
});

export const CoverageAwareLiveAppTestCaseSchema = z.object({
  title: z.string(),
  background: z.string().nullable().optional(),
  given: z.array(z.string()).min(1),
  when: z.array(z.string()).min(1),
  then: z.array(z.string()).min(1),
  tags: z.array(z.string()).default([]),
  testType: z.enum([
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
  ]),
  confidence: z.number().min(0).max(1),
  notes: z.string().nullable().optional(),
  coverageDisposition: z.enum(["NEW_COVERAGE", "STALE_EXISTING"]),
  matchedExistingTestCaseId: z.string().nullable(),
  coverageRationale: z.string().min(1),
  observedReleaseCommit: z.string().min(1),
  steps: z.array(LiveAppActionSchema).min(1),
});

const AgentResponseSchema = z.object({
  testCases: z.array(CoverageAwareLiveAppTestCaseSchema),
});
export type CoverageAwareLiveAppTestCase = z.infer<
  typeof CoverageAwareLiveAppTestCaseSchema
>;

export interface LiveAppScannedPage {
  url: string;
  title: string;
  elements: z.infer<typeof ObservedElementSchema>[];
}

export interface ExistingLiveAppTestCase {
  id: string;
  title: string;
  given: string[];
  when: string[];
  then: string[];
  testType: string;
  updatedAt: string;
  steps: Array<{
    action: string;
    expectedActionOrData?: string | null;
    expectedResult?: string | null;
  }>;
}

export interface GenerateTestCasesFromLiveAppInput {
  startUrl: string;
  pages: LiveAppScannedPage[];
  existingTestCases: ExistingLiveAppTestCase[];
  releaseCommit: string;
  source?: { kind: "web" | "android" | "ios"; name: string };
}

let client: Anthropic | undefined;
function getClient(): Anthropic {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY)
      throw new Error("ANTHROPIC_API_KEY is not set");
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

const targetProperties = {
  role: { type: "string" },
  name: { type: "string" },
  stableId: { type: "string" },
  selector: { type: "string" },
  event: { type: "string" },
  route: { type: "string" },
};

const EMIT_TEST_CASES_TOOL: Anthropic.Tool = {
  name: "emit_test_cases",
  description:
    "Emit only new coverage or evidence-backed stale-case updates from the observed app.",
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
            notes: { type: ["string", "null"] },
            coverageDisposition: {
              type: "string",
              enum: ["NEW_COVERAGE", "STALE_EXISTING"],
            },
            matchedExistingTestCaseId: { type: ["string", "null"] },
            coverageRationale: { type: "string" },
            observedReleaseCommit: { type: "string" },
            steps: {
              type: "array",
              minItems: 1,
              items: {
                type: "object",
                properties: {
                  action: { type: "string" },
                  target: {
                    type: "object",
                    properties: targetProperties,
                    required: ["role", "name"],
                  },
                  input: { type: ["string", "null"] },
                  expectedResult: { type: "string" },
                  expectedResponse: { type: ["string", "null"] },
                },
                required: ["action", "target", "expectedResult"],
              },
            },
          },
          required: [
            "title",
            "given",
            "when",
            "then",
            "tags",
            "testType",
            "confidence",
            "coverageDisposition",
            "matchedExistingTestCaseId",
            "coverageRationale",
            "observedReleaseCommit",
            "steps",
          ],
        },
      },
    },
    required: ["testCases"],
  },
};

const SYSTEM_PROMPT = `You are a senior QA engineer comparing a released application's observed UI with its existing test inventory.
- Emit NEW_COVERAGE only when no existing case covers the same user intent and outcome.
- Emit STALE_EXISTING only when the observed UI directly contradicts an existing case. Missing content in this bounded capture is not evidence of staleness.
- For STALE_EXISTING, copy the exact existing case id. For NEW_COVERAGE, matchedExistingTestCaseId must be null.
- Every action must include an observed role and name. Copy stableId, selector, event, and route exactly when supplied. Never invent selector metadata.
- Include machine-executable action intent and a user-visible expected result, not only prose BDD.
- Preserve the supplied release commit exactly. Use only observed evidence. Emit fewer cases rather than duplicates or guesses.
- Always call emit_test_cases.`;

function normalizedTokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((token) => token.length > 2),
  );
}

function similarity(left: string, right: string): number {
  const a = normalizedTokens(left);
  const b = normalizedTokens(right);
  if (!a.size || !b.size) return 0;
  return (
    [...a].filter((token) => b.has(token)).length / Math.min(a.size, b.size)
  );
}

function elementKey(element: z.infer<typeof ObservedElementSchema>): string {
  return [
    element.role,
    element.name,
    element.stableId ?? "",
    element.selector ?? "",
    element.event ?? "",
    element.route ?? "",
  ].join("\u0000");
}

export function filterCoverageAwareDrafts(
  drafts: CoverageAwareLiveAppTestCase[],
  input: GenerateTestCasesFromLiveAppInput,
): CoverageAwareLiveAppTestCase[] {
  const existingIds = new Set(
    input.existingTestCases.map((testCase) => testCase.id),
  );
  const observed = new Set(
    input.pages.flatMap((page) => page.elements.map(elementKey)),
  );
  return drafts.filter((draft) => {
    if (draft.observedReleaseCommit !== input.releaseCommit) return false;
    if (draft.coverageDisposition === "STALE_EXISTING") {
      if (
        !draft.matchedExistingTestCaseId ||
        !existingIds.has(draft.matchedExistingTestCaseId)
      )
        return false;
    } else {
      if (draft.matchedExistingTestCaseId) return false;
      const draftCoverage = [draft.title, ...draft.when, ...draft.then].join(
        " ",
      );
      if (
        input.existingTestCases.some(
          (testCase) =>
            similarity(
              draftCoverage,
              [testCase.title, ...testCase.when, ...testCase.then].join(" "),
            ) >= 0.8,
        )
      )
        return false;
    }
    return draft.steps.every((step) => observed.has(elementKey(step.target)));
  });
}

function buildPromptContent(input: GenerateTestCasesFromLiveAppInput): string {
  const pages = input.pages
    .map(
      (page, index) =>
        `Page ${index + 1}: ${page.url}\nTitle: ${page.title}\nObserved elements:\n${page.elements.map((element) => `  - ${JSON.stringify(element)}`).join("\n") || "  (none)"}`,
    )
    .join("\n\n---\n\n");
  const existing = input.existingTestCases.length
    ? input.existingTestCases
        .map((testCase) => JSON.stringify(testCase))
        .join("\n")
    : "(no existing test cases)";
  const source = input.source
    ? `${input.source.kind} app capture: ${input.source.name}`
    : `web crawl: ${input.startUrl}`;
  return `Released revision: ${input.releaseCommit}\nObserved ${source}\n\n${pages}\n\nExisting test inventory:\n${existing}\n\nReturn only uncovered cases and directly evidenced stale-case updates.`;
}

export async function generateTestCasesFromLiveApp(
  input: GenerateTestCasesFromLiveAppInput,
): Promise<{ testCases: CoverageAwareLiveAppTestCase[] }> {
  const message = await traceAnthropicCall(
    "generateTestCasesFromLiveApp",
    MODEL,
    () =>
      getClient().messages.create({
        model: MODEL,
        max_tokens: 6144,
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
  const parsed = AgentResponseSchema.parse(toolUse.input);
  return { testCases: filterCoverageAwareDrafts(parsed.testCases, input) };
}
