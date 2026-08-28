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

export const ReleaseSummaryDraftSchema = z.object({
  overview: z.string(),
  whatChanged: z.string(),
  coverage: z.string(),
  risks: z.string(),
  recommendation: z.string(),
});
export type ReleaseSummaryDraft = z.infer<typeof ReleaseSummaryDraftSchema>;

const EMIT_SUMMARY_TOOL: Anthropic.Tool = {
  name: "emit_release_summary",
  description: "Emit a stakeholder-readable draft summary of a release's readiness.",
  input_schema: {
    type: "object",
    properties: {
      overview: { type: "string", description: "2-3 sentence executive summary: what this release is, and its current readiness state in plain language." },
      whatChanged: { type: "string", description: "A short narrative of what actually shipped, grounded in the real commit log when provided. If no commit log was given, say plainly that build-level detail wasn't available rather than inventing changes." },
      coverage: { type: "string", description: "A narrative on acceptance-criteria/test-plan status - what's met, what's still pending or at risk, grounded in the real counts provided." },
      risks: { type: "string", description: "A narrative on open risk flags, calling out any CRITICAL/HIGH ones by their real description. Say plainly if there are none open." },
      recommendation: { type: "string", description: "A direct, one-paragraph go/no-go-style recommendation grounded in the real readiness label and score provided - not a generic 'looks good' unless the data actually supports it." },
    },
    required: ["overview", "whatChanged", "coverage", "risks", "recommendation"],
  },
};

const SYSTEM_PROMPT = `You are a senior QA lead drafting a release summary for non-technical stakeholders (product,
leadership) who won't read the raw dashboard. You are given the release's real, already-computed readiness
score/label, real acceptance-criteria counts, the real list of open risk flags, and optionally the real commit
log for this release's build range.

Rules:
- Ground every claim in the data you're given. Never invent a feature, a risk, or a change that isn't
  reflected in the provided readiness/risk-flag/commit data.
- Write for someone who doesn't know what a "risk flag" or "acceptance criterion" is technically - plain
  language, but don't soften a real BLOCKED/AT_RISK state into false reassurance. If the readiness label is
  BLOCKED, the overview and recommendation must say so plainly, not hedge around it.
- When no commit log was provided, say so plainly in whatChanged ("build-level detail wasn't available for
  this summary") rather than guessing at what shipped from the release name alone.
- When there are zero open risk flags, say that plainly and briefly in risks - don't pad it with invented
  caveats.
- This is a draft a human reviews and edits before sharing - it's fine to be direct about a real gap.
- Always call the emit_release_summary tool. Do not respond in plain text.`;

export interface GenerateReleaseSummaryInput {
  releaseName: string;
  releaseStatus: string;
  projectName: string;
  readinessScore: number;
  readinessLabel: string;
  criteria: { met: number; atRisk: number; notMet: number; pending: number; total: number };
  openRiskFlags: { severity: string; source: string; description: string }[];
  // Real "what shipped" grounding (mirrors P4-09's QA strategy generation) -
  // a formatted commit log when the caller anchored generation in an actual
  // git ref range, rather than always guessing from the release name alone.
  changesSummary?: string;
}

export async function generateReleaseSummary(input: GenerateReleaseSummaryInput): Promise<ReleaseSummaryDraft> {
  const riskFlagLines = input.openRiskFlags
    .map((f) => `- [${f.severity}] (${f.source}) ${f.description}`)
    .join("\n");

  const message = await traceAnthropicCall("generateReleaseSummary", MODEL, () =>
    getClient().messages.create({
      model: MODEL,
      max_tokens: 1536,
      system: SYSTEM_PROMPT,
      tools: [EMIT_SUMMARY_TOOL],
      tool_choice: { type: "tool", name: "emit_release_summary" },
      messages: [
        {
          role: "user",
          content: `Project: ${input.projectName}
Release: ${input.releaseName} (status: ${input.releaseStatus})

Readiness score: ${input.readinessScore}/100 (${input.readinessLabel})
Acceptance criteria: ${input.criteria.met} met, ${input.criteria.atRisk} at risk, ${input.criteria.notMet} not met, ${input.criteria.pending} pending (${input.criteria.total} total)

Open risk flags (${input.openRiskFlags.length}):
${riskFlagLines || "(none open)"}
${input.changesSummary ? `\nReal commit log for this release's build range:\n${input.changesSummary}\n` : ""}
Draft a stakeholder-readable summary of this release.`,
        },
      ],
    }),
  );

  const toolUse = message.content.find((block): block is Anthropic.ToolUseBlock => block.type === "tool_use");
  if (!toolUse) {
    throw new Error("Agent did not return a tool_use block");
  }

  return ReleaseSummaryDraftSchema.parse(toolUse.input);
}
