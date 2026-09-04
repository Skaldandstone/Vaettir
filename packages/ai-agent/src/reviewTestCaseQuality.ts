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

const ISSUE_TYPES = ["VAGUE_TITLE", "UNCLEAR_STEPS", "MISSING_EXPECTED_RESULT", "OTHER"] as const;

export const TestCaseQualityIssueSchema = z.object({
  testCaseId: z.string(),
  issueType: z.enum(ISSUE_TYPES),
  description: z.string(),
  suggestion: z.string(),
});
export type TestCaseQualityIssue = z.infer<typeof TestCaseQualityIssueSchema>;

export const DuplicateGroupSchema = z.object({
  testCaseIds: z.array(z.string()).min(2),
  reason: z.string(),
});
export type DuplicateGroup = z.infer<typeof DuplicateGroupSchema>;

export const TestCaseQualityReviewSchema = z.object({
  issues: z.array(TestCaseQualityIssueSchema),
  duplicateGroups: z.array(DuplicateGroupSchema),
});
export type TestCaseQualityReview = z.infer<typeof TestCaseQualityReviewSchema>;

const EMIT_REVIEW_TOOL: Anthropic.Tool = {
  name: "emit_quality_review",
  description: "Emit the quality issues and near-duplicate groups found across a batch of test cases.",
  input_schema: {
    type: "object",
    properties: {
      issues: {
        type: "array",
        description: "One entry per genuine, specific quality problem found. Do not pad this with a generic entry for every case - only flag cases that actually have a real problem.",
        items: {
          type: "object",
          properties: {
            testCaseId: { type: "string", description: "The exact id of the flagged test case, copied from the input." },
            issueType: { type: "string", enum: ISSUE_TYPES },
            description: { type: "string", description: "1-2 sentences on what's actually wrong with this specific case, not a generic definition of the issue type." },
            suggestion: { type: "string", description: "A concrete, specific rewrite or fix - e.g. a better title, or the missing expected-result text - not just 'make this clearer'." },
          },
          required: ["testCaseId", "issueType", "description", "suggestion"],
        },
      },
      duplicateGroups: {
        type: "array",
        description: "Groups of 2+ test cases (by id) that verify substantially the same behavior. Only real, meaningful overlap - two cases that happen to share a feature area but check different behavior are not duplicates.",
        items: {
          type: "object",
          properties: {
            testCaseIds: { type: "array", items: { type: "string" }, description: "At least 2 exact ids from the input that overlap." },
            reason: { type: "string", description: "What behavior they both verify, and what's actually identical between them." },
          },
          required: ["testCaseIds", "reason"],
        },
      },
    },
    required: ["issues", "duplicateGroups"],
  },
};

const SYSTEM_PROMPT = `You are a senior QA lead doing a quality pass over a batch of existing, already-authored test
cases from the same test plan. You are not writing new cases - you are critiquing the ones you're given.

Rules:
- VAGUE_TITLE: the title doesn't say what specific behavior or scenario is being verified (e.g. "test login"
  tells you nothing; "login fails with a locked account after 5 failed attempts" does). A title that's
  merely short but already specific is NOT vague - don't flag for length alone.
- UNCLEAR_STEPS: the given/when/then or step sequence doesn't let a reader tell what's actually being done
  without guessing - ambiguous pronouns, missing setup context, a "when" that doesn't match its "then".
- MISSING_EXPECTED_RESULT: there's a when/action with no corresponding then/expected outcome at all, so the
  case can't actually be judged pass/fail.
- OTHER: a real, specific problem that doesn't fit the above (e.g. testing implementation details instead
  of behavior) - use rarely, and always with a concrete description.
- Only flag a case when something is genuinely wrong. Most well-written cases in a batch should get zero
  issues - do not manufacture an issue just to have feedback on every case.
- For duplicateGroups: flag only cases that verify the same underlying behavior, even if worded differently.
  Two cases in the same feature area that check different edge cases or different assertions are not
  duplicates.
- Ground every testCaseId in the exact ids given in the input - never invent one.
- Always call the emit_quality_review tool. Do not respond in plain text.`;

export interface TestCaseForReview {
  id: string;
  title: string;
  given: string[];
  when: string[];
  then: string[];
  steps: { action: string; expectedResult: string | null }[];
}

function formatCase(tc: TestCaseForReview): string {
  const bdd = [
    ...tc.given.map((s) => `Given ${s}`),
    ...tc.when.map((s) => `When ${s}`),
    ...tc.then.map((s) => `Then ${s}`),
  ].join("\n");
  const steps = tc.steps.map((s, i) => `${i + 1}. ${s.action} -> ${s.expectedResult ?? "(no expected result)"}`).join("\n");
  const body = [bdd, steps].filter(Boolean).join("\n");
  return `[id: ${tc.id}] ${tc.title}\n${body || "(no steps or given/when/then content)"}`;
}

export async function reviewTestCaseQuality(cases: TestCaseForReview[]): Promise<TestCaseQualityReview> {
  const message = await traceAnthropicCall("reviewTestCaseQuality", MODEL, () =>
    getClient().messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: [EMIT_REVIEW_TOOL],
      tool_choice: { type: "tool", name: "emit_quality_review" },
      messages: [
        {
          role: "user",
          content: `Review this batch of ${cases.length} test cases for quality issues and near-duplicate coverage:\n\n${cases.map(formatCase).join("\n\n")}`,
        },
      ],
    }),
  );

  const toolUse = message.content.find((block): block is Anthropic.ToolUseBlock => block.type === "tool_use");
  if (!toolUse) {
    throw new Error("Agent did not return a tool_use block");
  }

  return TestCaseQualityReviewSchema.parse(toolUse.input);
}
