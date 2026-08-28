import Anthropic from "@anthropic-ai/sdk";
import { TestCaseRiskAssessmentSchema, RiskSeveritySchema, type TestCaseRiskAssessment } from "@vaettir/core";
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

const EMIT_RISK_ASSESSMENT_TOOL: Anthropic.Tool = {
  name: "emit_risk_assessment",
  description: "Emit a severity/risk assessment for a test case.",
  input_schema: {
    type: "object",
    properties: {
      severity: { type: "string", enum: RiskSeveritySchema.options },
      riskScore: { type: "number" },
      rationale: { type: "string" },
    },
    required: ["severity", "riskScore", "rationale"],
  },
};

const SYSTEM_PROMPT = `You are a senior QA/release engineer assessing the risk of a single test scenario.

You are NOT judging test quality or how well-written the test is. You are judging: if the behavior this
test case verifies were to silently break in production and nobody caught it before release, how bad
would that be, and how likely is that kind of thing to actually regress?

Rules:
- severity: how bad the real-world consequence is if this specific behavior breaks and ships.
  CRITICAL = data loss, security/auth bypass, payment/billing correctness, complete feature outage for
  most users. HIGH = a core user journey breaks or is significantly degraded for many users, or a
  security-adjacent check weakens (not a full bypass). MEDIUM = a real but narrower or workaround-able
  problem, or affects a minority of users/an edge case. LOW = cosmetic, rare edge case, or low-traffic path.
- riskScore (0-100): combine severity with how likely this area is to regress in ordinary development --
  authentication, payment, and security-adjacent code changes often and has high blast radius when it
  breaks, so it should usually score higher than an equally-"critical-sounding" but rarely-touched
  admin-only edge case. Don't just map severity to a fixed number -- use the actual scenario.
- rationale: 1-3 sentences, concrete and specific to this test case, not generic ("this covers auth" is
  not useful; "an auth bypass here would let any authenticated user impersonate another account" is).
- Always call the emit_risk_assessment tool. Do not respond in plain text.`;

export interface AssessRiskInput {
  title: string;
  given: string[];
  when: string[];
  then: string[];
  testType: string;
  sourceFilePath?: string | null;
}

export async function assessTestCaseRisk(input: AssessRiskInput): Promise<TestCaseRiskAssessment> {
  const bdd = [
    ...input.given.map((s) => `Given ${s}`),
    ...input.when.map((s) => `When ${s}`),
    ...input.then.map((s) => `Then ${s}`),
  ].join("\n");

  const message = await traceAnthropicCall("assessTestCaseRisk", MODEL, () =>
    getClient().messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: [EMIT_RISK_ASSESSMENT_TOOL],
      tool_choice: { type: "tool", name: "emit_risk_assessment" },
      messages: [
        {
          role: "user",
          content: `Title: ${input.title}\nType: ${input.testType}${input.sourceFilePath ? `\nSource: ${input.sourceFilePath}` : ""}\n\n${bdd}\n\nAssess the risk of this test case.`,
        },
      ],
    }),
  );

  const toolUse = message.content.find((block): block is Anthropic.ToolUseBlock => block.type === "tool_use");
  if (!toolUse) {
    throw new Error("Agent did not return a tool_use block");
  }

  return TestCaseRiskAssessmentSchema.parse(toolUse.input);
}
