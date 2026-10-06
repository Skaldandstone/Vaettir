/** Display only: stored step keys and custom workspace labels stay unchanged. */
export function technicalBehaviorLabel(label?: string): string {
  return label === undefined || label === "Expected Action / Data"
    ? "Technical behavior / data"
    : label;
}

/** Arrays are the lossless path. Older new-draft callers may supply CSV text. */
export function initialCaseTags(tags?: readonly string[] | string): string[] {
  return typeof tags === "string"
    ? tags.split(",").map(tag => tag.trim()).filter(Boolean)
    : [...(tags ?? [])];
}

export function appendCaseTag(tags: readonly string[], draft: string, reopenedOriginal?: string): {
  tags: string[]; status: "added" | "duplicate" | "empty"; tag: string;
} {
  // Reopening and saving an untouched chip must round-trip whitespace,
  // duplicates and even a retained empty string. Only new/edited text trims.
  if (reopenedOriginal !== undefined && draft === reopenedOriginal) {
    return { tags: [...tags, draft], status: "added", tag: draft };
  }
  const tag = draft.trim();
  if (!tag) return { tags: [...tags], status: "empty", tag };
  if (tags.includes(tag)) return { tags: [...tags], status: "duplicate", tag };
  return { tags: [...tags, tag], status: "added", tag };
}

export function removeCaseTag(tags: readonly string[], index: number): string[] {
  return Number.isInteger(index) && index >= 0 && index < tags.length
    ? tags.filter((_, position) => position !== index)
    : [...tags];
}

/** Backspace reopens the last chip as text, instead of silently losing it. */
export function reopenLastCaseTag(tags: readonly string[], draft: string): {
  tags: string[]; draft: string;
} {
  return draft === "" && tags.length > 0
    ? { tags: tags.slice(0, -1), draft: tags.at(-1)! }
    : { tags: [...tags], draft };
}

export type CaseAuthoringStep = {
  action: string;
  expectedActionOrData: string | null;
  expectedResult: string | null;
  expectedResponse: string | null;
  mediaAttachmentIds: readonly string[];
  editorPlaceholder?: boolean;
};
export type PreparedCaseStep = Omit<CaseAuthoringStep, "editorPlaceholder" | "mediaAttachmentIds"> & { mediaAttachmentIds: string[] };

/** Never infer deletion from an absent action. Retained rows and supplied
 * expected/media fields require explicit review; only untouched blank editor
 * placeholders may be omitted. Optional NULL and empty strings stay distinct. */
export function prepareCaseStepsForSave(rows: readonly CaseAuthoringStep[]):
  { ok: true; steps: PreparedCaseStep[] } | { ok: false; stepNumber: number; error: string } {
  const steps: PreparedCaseStep[] = [];
  for (const [index, row] of rows.entries()) {
    if (!row.action.trim()) {
      const entirelyEmpty = row.action === "" &&
        [row.expectedActionOrData, row.expectedResult, row.expectedResponse].every(value => value === null || value === "") &&
        row.mediaAttachmentIds.length === 0;
      if (row.editorPlaceholder === true && entirelyEmpty) continue;
      return { ok: false, stepNumber: index + 1, error: `Step ${index + 1} has no tester action. Add its action or explicitly remove this row after reviewing its technical details, expected results and media. Nothing was saved.` };
    }
    steps.push({ action: row.action, expectedActionOrData: row.expectedActionOrData, expectedResult: row.expectedResult, expectedResponse: row.expectedResponse, mediaAttachmentIds: [...row.mediaAttachmentIds] });
  }
  return { ok: true, steps };
}

export type CasePhaseName = "Given" | "When" | "Then";
export type CasePhaseRow = { text: string; editorKey: string; editorPlaceholder: boolean };

export function initialCasePhaseRows(values: readonly string[], keyPrefix: string): CasePhaseRow[] {
  return values.map((text, index) => ({ text, editorKey: `${keyPrefix}-${index}`, editorPlaceholder: false }));
}

/** Empty text is a valid retained phase value under the existing API contract.
 * A UI placeholder is different: only a newly added, literally empty row may
 * be omitted. Whitespace, line breaks and duplicate wording retain exact order. */
export function prepareCasePhaseForSave(phase: CasePhaseName, rows: readonly CasePhaseRow[]):
  { ok: true; values: string[] } | { ok: false; itemNumber: number; error: string } {
  const values: string[] = [];
  for (const [index, row] of rows.entries()) {
    if (!row || typeof row.text !== "string" || typeof row.editorPlaceholder !== "boolean") {
      return { ok: false, itemNumber: index + 1, error: `${phase} item ${index + 1} has unsupported text or origin metadata. Review this item; no value was coerced and nothing was saved.` };
    }
    if (row.editorPlaceholder && row.text === "") continue;
    values.push(row.text);
  }
  return { ok: true, values };
}
