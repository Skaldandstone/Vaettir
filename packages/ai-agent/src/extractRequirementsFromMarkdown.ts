import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

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

// Extraction silently truncates a document past this many characters -
// generous for a real README/spec doc, a guard against an accidentally
// huge file blowing up the prompt.
export const MAX_MARKDOWN_CHARS = 30000;

export const DraftRequirementSchema = z.object({
  title: z.string(),
  description: z.string(),
});
export type DraftRequirement = z.infer<typeof DraftRequirementSchema>;

const EMIT_TOOL: Anthropic.Tool = {
  name: "emit_draft_requirements",
  description: "Emit the discrete requirements found in a document.",
  input_schema: {
    type: "object",
    properties: {
      requirements: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "Short, specific requirement title." },
            description: {
              type: "string",
              description: "The requirement's actual content/behavior expected, in the author's own terms - not a restatement of the title.",
            },
          },
          required: ["title", "description"],
        },
      },
    },
    required: ["requirements"],
  },
};

// Not everything in a README/spec doc is a requirement - installation
// steps, badges, a changelog, license text, contributor guidelines are
// all common noise in exactly the kind of markdown docs this reads.
// Deliberately an AI call rather than a structural parser (unlike
// Gherkin/Postman/CSV, prose requirements docs have no fixed syntax to
// parse against) - same reasoning P4-07's generateTestCasesFromRequirement
// already established for unstructured input.
const SYSTEM_PROMPT = `You are extracting discrete product/feature REQUIREMENTS from a markdown document, to be
reviewed by a human before any are saved for real.

Rules:
- Only extract genuine requirements/specifications of intended behavior - what the system should do, a feature's
  expected behavior, a constraint it must satisfy. Do NOT extract installation instructions, badges, changelogs,
  contributor/license text, table-of-contents entries, or generic prose that isn't actually specifying behavior.
- If the document has no real requirements in it (e.g. it's just a changelog or a license), return an empty list -
  do not invent requirements to have something to show.
- Each requirement's description should be grounded in what the document actually says, not a generic
  restatement of the title.
- Prefer more granular, individually-testable requirements over one giant requirement covering an entire section.
- Always call the emit_draft_requirements tool. Do not respond in plain text.`;

export async function extractRequirementsFromMarkdown(content: string, sourceLabel: string): Promise<DraftRequirement[]> {
  const message = await getClient().messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    tools: [EMIT_TOOL],
    tool_choice: { type: "tool", name: "emit_draft_requirements" },
    messages: [
      {
        role: "user",
        content: `Source document: ${sourceLabel}\n\n${content.slice(0, MAX_MARKDOWN_CHARS)}`,
      },
    ],
  });

  const toolUse = message.content.find((block): block is Anthropic.ToolUseBlock => block.type === "tool_use");
  if (!toolUse) {
    throw new Error("Agent did not return a tool_use block");
  }

  const raw = toolUse.input as { requirements?: unknown };
  const rawRequirements = Array.isArray(raw.requirements) ? raw.requirements : [];
  const normalized = rawRequirements.map((r) => {
    const req = r as Record<string, unknown>;
    return {
      title: typeof req.title === "string" ? req.title : "",
      description: typeof req.description === "string" ? req.description : "",
    };
  });

  return normalized.filter((r) => r.title.trim().length > 0).map((r) => DraftRequirementSchema.parse(r));
}
