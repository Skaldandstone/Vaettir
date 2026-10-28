import type { RouterInputs } from "@/lib/trpcReact";

type Definition = RouterInputs["reportSnapshots"]["preview"]["definition"];
export type ReportTemplateId = NonNullable<Definition["templateId"]>;
type Starter = {
  title: string;
  description: string;
  audience: Definition["audience"];
  sections: Definition["sections"];
  reviewPrompts: readonly string[];
};

// These suggest supported recorded metrics, not evidence, verdicts, summaries,
// new reports or AI-generated conclusions. A saved definition remains editable.
export const REPORT_TEMPLATES = {
  "quality-status": {
    title: "Quality status review",
    description:
      "Tests, results, requirements and defects in one overview.",
    audience: "stakeholders",
    sections: ["inventory", "execution", "traceability", "defects"],
    reviewPrompts: [
      "Which build or configuration is this decision about?",
      "Which planned checks still have no recorded result?",
      "Who owns each remaining blocker and the next review?",
    ],
  },
  "execution-progress": {
    title: "Test execution progress",
    description:
      "See recorded results and planned checks still waiting for a result.",
    audience: "quality",
    sections: ["inventory", "execution"],
    reviewPrompts: [
      "Choose the plan, platform and time interval being reviewed.",
      "Keep blocked, skipped and unrecorded work distinct from passing results.",
      "What must happen before the remaining checks can run?",
    ],
  },
  "requirements-coverage": {
    title: "Requirements coverage review",
    description:
      "See which requirements have linked tests, alongside their recorded results. Links do not prove a pass.",
    audience: "quality",
    sections: ["inventory", "execution", "traceability"],
    reviewPrompts: [
      "Which requirements have explicit cases, and which have recorded results?",
      "Scoped reports exclude requirements with no link to the selected case cohort.",
      "Name missing coverage without treating it as an approved exception.",
    ],
  },
  "defect-review": {
    title: "Defect and regression review",
    description:
      "Review failures, recorded defects and linked tasks. A closed task does not prove a fix.",
    audience: "engineering",
    sections: ["execution", "traceability", "defects"],
    reviewPrompts: [
      "Which failures have a reviewed defect/task relationship?",
      "Narrowed execution reports cannot include unrelated imported defect aggregates.",
      "Which fixes still need a separately recorded verification or retest?",
    ],
  },
  "automation-progress": {
    title: "Automation improvement review",
    description:
      "See automation labels and changes since an approved report with the same tests. Labels do not prove a successful run.",
    audience: "engineering",
    sections: ["inventory", "execution", "automation"],
    reviewPrompts: [
      "Use matching scopes when comparing approved snapshots.",
      "Which recorded inventory labels changed, and which results actually ran?",
      "Describe the next improvement; do not invent time savings from labels.",
    ],
  },
} satisfies Record<ReportTemplateId, Starter>;

export const REPORT_TEMPLATE_IDS = Object.keys(
  REPORT_TEMPLATES,
) as ReportTemplateId[];

export function applyReportTemplate(
  definition: Definition,
  title: string,
  templateId: ReportTemplateId,
): { definition: Definition; title: string } {
  const starter = REPORT_TEMPLATES[templateId];
  // Preserve custom titles, all authored commentary, scopes and intervals. Only
  // an untouched starter title is replaced when the user chooses a new starter.
  const starterTitle =
    title === "Quality status review" ||
    REPORT_TEMPLATE_IDS.some((id) => REPORT_TEMPLATES[id].title === title);
  return {
    title: starterTitle ? starter.title : title,
    definition: {
      ...definition,
      templateId,
      audience: starter.audience,
      sections: [...starter.sections],
    },
  };
}
