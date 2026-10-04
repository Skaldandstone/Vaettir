// Advisory authoring prompts only. No case fields, scores, configuration,
// automation, acceptance thresholds or qualified protocols are generated.
export const caseDesignGuides = [
  {
    id: "BUSINESS_WORKFLOW",
    label: "Business or SaaS workflow",
    stages: {
      design: [
        "Identify the user role, feature and business rule this case examines.",
        "Consider ordinary, invalid and boundary inputs; separate unrelated behaviors into independently reviewable cases.",
      ],
      procedure: [
        "Put account state, permissions and required data in preconditions. Keep the actual user operations in ordered steps.",
        "For each operation, specify observable expected data, result or response, including what must not change on rejection.",
      ],
      evidence: [
        "Link the authorized feature or requirement and record the intended environment/build for execution.",
        "Choose which assertions belong at unit, service/contract or user-interface boundaries using actual available evidence, not a framework label.",
      ],
    },
  },
  {
    id: "DEVELOPER_BOUNDARY",
    label: "Unit, service or integration boundary",
    stages: {
      design: [
        "Name the function, contract or integration behavior under examination and the inputs that affect it.",
        "Distinguish isolated developer checks from behavior that requires a real dependency. Record why this chosen boundary is useful.",
      ],
      procedure: [
        "Describe fixtures and dependency assumptions as preconditions; describe invocation and assertions as executable steps.",
        "Specify expected values, side effects and error behavior. Avoid depending on incidental ordering or timing unless that is the behavior being tested.",
      ],
      evidence: [
        "Link only authorized available test/source evidence. Importing a description does not establish that code was executed.",
        "Record the observed stack and runner before choosing automation; keep unsupported or unverified capabilities explicit.",
      ],
    },
  },
  {
    id: "GAME_PLAYER",
    label: "Game feature, platform or player input",
    stages: {
      design: [
        "Identify the game feature, target PC/mobile/console platform, game/build version and player/session state.",
        "Choose relevant controller, keyboard/mouse, touch and accessibility configurations explicitly; do not substitute one platform's result for another.",
      ],
      procedure: [
        "Keep save/session setup and required devices in preconditions. Write the reproducible input sequence as steps with observable player-facing outcomes.",
        "Consider interruptions or reconnection only when in scope; state what progress, input or saved state should be observed after each action.",
      ],
      evidence: [
        "Record the actual platform/input/build with each run and identify useful step image/video or authorized tool evidence.",
        "Link customer-authorized platform requirements when available. These prompts are not proprietary console requirements or certification acceptance.",
      ],
    },
  },
  {
    id: "HARDWARE_SYSTEM",
    label: "Hardware, HIL or system integration",
    stages: {
      design: [
        "Identify the device/test article, interface and hardware/firmware/software revisions being examined.",
        "Separate simulated from physical components and name the system boundary. Do not present a simulation result as physical-device acceptance.",
      ],
      procedure: [
        "Record approved setup, required equipment and qualified safety instructions separately from ordered stimulus/measurement steps.",
        "For each step, reference project-approved criteria and measurement units. Do not derive safety limits or calibration acceptance from this guide.",
      ],
      evidence: [
        "Record actual rig/instrument/test-article identities and relevant calibration provenance in the run context.",
        "Link controlled requirements and preserve measurements with their configuration. A Pass or linked case alone is not safety validation.",
      ],
    },
  },
  {
    id: "PROCESS_SAMPLE",
    label: "Process, sample or laboratory workflow",
    stages: {
      design: [
        "Identify the process/sample/lot, intended method and controlled protocol version requiring review.",
        "Ask the qualified owner to define applicable sampling, custody, safety and acceptance requirements; no clinical or food-safety limits are supplied here.",
      ],
      procedure: [
        "Keep approved equipment/material/setup and pre-execution conditions separate from collection, handling and measurement steps.",
        "Reference the approved method and units for each expected observation. Preserve amendments and unexpected findings rather than replacing the original record.",
      ],
      evidence: [
        "Record real sample/lot identity, method version, instrument provenance and authorized supporting evidence with the execution.",
        "Distinguish an ordinary human case review from qualified regulatory approval. This guide is not an executable clinical, laboratory or food-safety protocol.",
      ],
    },
  },
] as const;

export type CaseDesignStage = "design" | "procedure" | "evidence";
export const caseDesignStages: ReadonlyArray<{
  id: CaseDesignStage;
  label: string;
}> = [
  { id: "design", label: "Choose the test boundary" },
  { id: "procedure", label: "Write the procedure" },
  { id: "evidence", label: "Plan evidence and automation" },
];
export function caseDesignGuide(id: string) {
  return caseDesignGuides.find((guide) => guide.id === id) ?? null;
}
export function caseDesignReviewKey(
  guideId: string,
  stage: CaseDesignStage,
  index: number,
) {
  const guide = caseDesignGuide(guideId);
  return guide &&
    caseDesignStages.some((item) => item.id === stage) &&
    Number.isInteger(index) &&
    index >= 0 &&
    index < guide.stages[stage].length
    ? `${guide.id}:${stage}:${index}`
    : null;
}
