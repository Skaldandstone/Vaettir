import { controlGuidance } from "./compliance-guidance";
import { COMPLIANCE_STARTERS } from "./compliance-starters";

const commonWords = new Set("a an the and or with without for from of on in to by is are be that this its it as test tests testing verify check checks checking review controls control requirement requirements should must can case cases".split(" "));
function words(text: string): Set<string> {
  return new Set((text.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((word) => word.length > 2 && !commonWords.has(word)));
}

// Read-only lexical hints. Not semantic coverage, legal applicability or evidence.
// Callers must disclose the scope of the candidate list supplied by the API.
export function rankComplianceCandidates<T extends { id: string; title: string }>(
  control: { title: string; description?: string | null }, cases: readonly T[],
): { candidate: T; matchedTerms: string[] }[] {
  const controlWords = words(`${control.title} ${control.description ?? ""}`);
  return cases.map((candidate, index) => ({
    candidate, index,
    matchedTerms: [...words(candidate.title)].filter((word) => controlWords.has(word)).sort(),
  })).sort((a, b) => b.matchedTerms.length - a.matchedTerms.length || a.index - b.index)
    .map(({ candidate, matchedTerms }) => ({ candidate, matchedTerms }));
}

export function complianceCheckOutline(
  frameworkKey: string,
  control: { code: string; title: string; description?: string | null },
) {
  const reference = COMPLIANCE_STARTERS.find((starter) => starter.key === frameworkKey)
    ?.controls.find((item) => item.code === control.code && item.title === control.title);
  // A saved control may retain the code/title while its scope changes. Do not
  // author an outline for that control from the original reference wording.
  if (!reference || reference.description !== control.description) return null;
  const guide = controlGuidance(frameworkKey, control.code, control.title);
  if (!guide) return null;
  return {
    title: `Review ${control.title.toLocaleLowerCase()}`,
    prerequisite: "Confirm applicability, scope and the current authoritative requirement with the responsible reviewer. Use authorized synthetic examples for behavior checks.",
    action: guide.tests,
    expectedResult: "Record the observed outcome against the reviewed acceptance criteria. Leave missing evidence or unresolved applicability for review; do not infer a pass.",
    evidence: guide.evidence,
  };
}
