import type { QualityRiskDefinition } from "@vaettir/api/src/services/qualityRiskSchema";

export const qualityRiskStarters = [
  {
    id: "SOFTWARE_BUSINESS", label: "Software or business workflow",
    description: "Identify the behavior, people and business process to investigate.",
    prompts: [
      ["Which component, user role and business operation are involved?", "What specific failure could prevent the intended behavior, and what cause needs investigation?"],
      ["Who or what could be affected, under which operating conditions?", "What evidence is missing before choosing likelihood and consequence? Keep either Unknown when unsupported."],
      ["Which explicit requirement and test case would examine the intended control?", "Which unit, integration or end-to-end boundary should be tested, and why?"],
      ["Are the cause, effect and uncertainty factual human entries rather than the example prompts?", "Which version, configuration and recorded result would a later human residual review need?"],
    ],
    references: [{ label: "NASA software verification planning (public reference)", url: "https://swehb.nasa.gov/spaces/SWEHBVB/pages/32604465/SWE-028+Verification+Planning" }],
  },
  {
    id: "GAME_PLATFORM_INPUT", label: "Game platform or player input",
    description: "Consider the target build, player interaction and input configuration.",
    prompts: [
      ["Which game feature, PC/mobile/console target, platform version and build are involved?", "Which controller, keyboard/mouse, touch or accessibility interaction could fail, and under which conditions?"],
      ["Could the observed behavior affect progress, player access, session continuity or saved state? Describe evidence, not an assumed severity.", "Which player/input configurations have not been examined? Keep uncertainty explicit."],
      ["Which public or customer-supplied authorized requirement does the case examine?", "What reproducible input sequence, configuration and evidence would examine the intended mitigation?"],
      ["Have you entered actual target details without claiming a platform certification requirement?", "What later recorded result would support a human review? Public input guidance is not proprietary TRC/TCR access or certification."],
    ],
    references: [{ label: "Microsoft input for games (public reference)", url: "https://learn.microsoft.com/en-us/windows/uwp/gaming/input-for-games" },
      { label: "Microsoft gaming accessibility (public reference)", url: "https://learn.microsoft.com/en-us/training/paths/gaming-accessibility-fundamentals/" }],
  },
  {
    id: "HARDWARE_HIL_MACHINERY", label: "Hardware, HIL or machinery",
    description: "Describe the physical/system boundary and intended verification conditions.",
    prompts: [
      ["Which device, machine function, firmware/software and interface are involved?", "What failure mode, possible cause and physical or system effect need investigation?"],
      ["What intended operating conditions and unknowns affect your qualitative assessment?", "What evidence supports the categories? No calibrated risk matrix or safety threshold is supplied here."],
      ["Which approved requirement and case would examine the intended mitigation?", "Which real or simulated equipment, interface, configuration and measurement provenance should the test record?"],
      ["Have a qualified project owner define any required safe test procedure outside this prompt guide.", "What configuration, test article and recorded evidence would a later human review need? A case link or Pass alone is not safety validation."],
    ],
    references: [{ label: "NASA product verification (public reference)", url: "https://www.nasa.gov/reference/5-3-product-verification/" }],
  },
  {
    id: "PROCESS_LAB_FOOD", label: "Process, laboratory or food workflow",
    description: "Describe the process/sample boundary and the evidence needed for human review.",
    prompts: [
      ["Which process step, material/sample, lot or workflow is involved?", "What possible hazard or process failure, cause and effect need qualified investigation?"],
      ["What evidence and uncertainty support your qualitative assessment?", "Which applicable project protocol or qualified owner must determine any acceptance criteria? No regulatory limit is supplied here."],
      ["Which authorized requirement and test/sampling case examine the intended control?", "Which method, equipment provenance, sample identity and monitoring/verification records need to be retained?"],
      ["Have you recorded actual process facts without treating these prompts as an approved food-safety or clinical protocol?", "What later recorded evidence and qualified external review are missing? This ordinary human record is not regulatory acceptance."],
    ],
    references: [{ label: "FDA HACCP principles and application guidelines (public reference)", url: "https://www.fda.gov/food/hazard-analysis-critical-control-point-haccp/haccp-principles-application-guidelines" }],
  },
] as const;

export type QualityRiskStarterId = (typeof qualityRiskStarters)[number]["id"];
export type RiskStarterBoundary = {
  open: boolean; mode: "CREATE" | "UPDATE" | "REVIEW" | "VIEW"; canWrite: boolean;
  pending: boolean; busy: boolean; hasBaseline: boolean; hasSelectedEntry: boolean;
  acknowledged: boolean; dropUnavailableLinks: boolean;
  review: { likelihood: string; consequence: string; rationale: string; evidenceNotes: string; disposition: string; resultIds: readonly string[] };
};
export function canApplyQualityRiskStarter(definition: QualityRiskDefinition, boundary: RiskStarterBoundary) {
  return boundary.open && boundary.mode === "CREATE" && boundary.canWrite && !boundary.pending && !boundary.busy &&
    !boundary.hasBaseline && !boundary.hasSelectedEntry && !boundary.acknowledged && !boundary.dropUnavailableLinks &&
    [definition.title, definition.component, definition.failureMode, definition.cause, definition.effect, definition.rationale, definition.mitigation]
      .every(value => value === "") && definition.likelihood === "UNKNOWN" && definition.consequence === "UNKNOWN" &&
    definition.caseIds.length === 0 && definition.requirementIds.length === 0 &&
    boundary.review.likelihood === "UNKNOWN" && boundary.review.consequence === "UNKNOWN" && boundary.review.rationale === "" &&
    boundary.review.evidenceNotes === "" && boundary.review.disposition === "FURTHER_ACTION" && boundary.review.resultIds.length === 0;
}
export function reviewedQualityRiskStarter(definition: QualityRiskDefinition, boundary: RiskStarterBoundary, id: string, confirmed: boolean): QualityRiskStarterId | null {
  if (!confirmed || !canApplyQualityRiskStarter(definition, boundary)) return null;
  // No definition, relationship, residual review or request is modified. A
  // starter activates instructions only; factual fields remain human-entered.
  return qualityRiskStarters.find(starter => starter.id === id)?.id ?? null;
}
