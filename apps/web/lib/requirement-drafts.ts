export type RequirementDraft = {
  title: string;
  description: string;
  sourceFile: string | null;
};

// Only acknowledged writes are marked saved. An ambiguous transport failure still
// needs reconciliation with the server; this is not a durable idempotency key.
export async function saveRequirementDrafts(
  drafts: RequirementDraft[],
  selected: Iterable<number>,
  saved: ReadonlySet<number>,
  create: (draft: { title: string; description: string }) => Promise<unknown>,
  onSaved: (index: number) => void,
) {
  const pending = [...selected].filter((index) => !saved.has(index));
  if (pending.some((index) => !drafts[index]?.title.trim())) {
    throw new Error(
      "Add a title to each selected requirement. Your rows are kept for editing.",
    );
  }
  for (const index of pending) {
    const draft = drafts[index]!;
    await create({
      title: draft.title.trim(),
      description: draft.sourceFile
        ? `${draft.description}\n\n(extracted from ${draft.sourceFile})`
        : draft.description,
    });
    onSaved(index);
  }
}
