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
