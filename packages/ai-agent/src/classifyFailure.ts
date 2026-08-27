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

const CLASSIFY_FAILURE_TOOL: Anthropic.Tool = {
  name: "emit_failure_classification",
  description: "Classify a failing test and, if it looks brittle, propose a concrete fix.",
  input_schema: {
    type: "object",
    properties: {
      classification: {
        type: "string",
        enum: ["BRITTLE", "REAL_REGRESSION", "UNCERTAIN"],
        description:
          "BRITTLE: the test broke because of a selector/locator/text/structural change unrelated to real behavior. REAL_REGRESSION: the application's actual behavior changed and the test is correctly catching it. UNCERTAIN: not enough signal to confidently call it either way.",
      },
      classificationRationale: { type: "string", description: "1-3 sentences, grounded in the actual diff and error, not generic." },
      suggestedDiff: {
        type: "string",
        description:
          "A concrete, minimal unified-diff-style fix against the test source, ONLY when classification is BRITTLE and you are confident in the fix. Omit entirely for REAL_REGRESSION, UNCERTAIN, or a BRITTLE case with no confident fix.",
      },
      suggestionRationale: { type: "string", description: "Why this specific fix, only when suggestedDiff is provided." },
    },
    required: ["classification", "classificationRationale"],
  },
};

const SYSTEM_PROMPT = `You are a senior QA/release engineer triaging a failing automated test. You are shown the test's
source at the last commit it passed on and at the commit where it's now failing, plus the actual failure error message.

Your job is ONLY to classify and, where confident, suggest a fix - you never apply anything. This suggestion is always
reviewed by a human before any code changes; a wrong or low-confidence suggestion is far worse than no suggestion, so
only propose suggestedDiff when you're genuinely confident, and prefer UNCERTAIN over guessing when the signal is weak.

Rules:
- BRITTLE failures are things like: a CSS selector/data-testid changed, a locator strategy broke because of unrelated
  markup changes, expected text was cosmetically reworded, timing/wait issues, a structural refactor moved code
  without changing behavior. The application still does the right thing; the test's mechanism to check it broke.
- REAL_REGRESSION failures are things like: an assertion about actual business logic/output now fails because the
  code's behavior genuinely changed, a previously-working flow now errors, a value that should match no longer does
  for a reason unrelated to test mechanics.
- When proposing suggestedDiff, ground it in the ACTUAL diff between the two source versions shown - point at the
  specific line/selector/value that changed, don't invent a fix from the error message alone.
- Always call emit_failure_classification. Do not respond in plain text.`;

export interface ClassifyFailureInput {
  testTitle: string;
  errorMessage: string | null;
  filePath: string;
  sourceAtLastPass: string;
  sourceAtFailure: string;
}

export interface FailureClassification {
  classification: "BRITTLE" | "REAL_REGRESSION" | "UNCERTAIN";
  classificationRationale: string;
  suggestedDiff: string | null;
  suggestionRationale: string | null;
}

const MAX_SOURCE_CHARS = 15_000;

function truncate(content: string): string {
  return content.length > MAX_SOURCE_CHARS ? `${content.slice(0, MAX_SOURCE_CHARS)}\n... [truncated]` : content;
}

export async function classifyTestFailure(input: ClassifyFailureInput): Promise<FailureClassification> {
  const message = await getClient().messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    tools: [CLASSIFY_FAILURE_TOOL],
    tool_choice: { type: "tool", name: "emit_failure_classification" },
    messages: [
      {
        role: "user",
        content: `Test: ${input.testTitle}\nFile: ${input.filePath}\nError: ${input.errorMessage ?? "(no error message captured)"}\n\n--- Source at last PASS ---\n${truncate(input.sourceAtLastPass)}\n\n--- Source at this FAILURE ---\n${truncate(input.sourceAtFailure)}\n\nClassify this failure.`,
      },
    ],
  });

  const toolUse = message.content.find((block): block is Anthropic.ToolUseBlock => block.type === "tool_use");
  if (!toolUse) {
    throw new Error("Agent did not return a tool_use block");
  }

  const raw = toolUse.input as {
    classification: "BRITTLE" | "REAL_REGRESSION" | "UNCERTAIN";
    classificationRationale: string;
    suggestedDiff?: string;
    suggestionRationale?: string;
  };

  return {
    classification: raw.classification,
    classificationRationale: raw.classificationRationale,
    suggestedDiff: raw.suggestedDiff ?? null,
    suggestionRationale: raw.suggestionRationale ?? null,
  };
}
