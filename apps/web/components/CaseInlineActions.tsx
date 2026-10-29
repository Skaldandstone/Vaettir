"use client";

import { IconButton } from "./ui/IconButton";

/** Direct actions share the existing task handlers; this is not an approval layer. */
export function CaseInlineActions({ name, canEdit, busy, exporting, canRun, canArchive, canRestore,
  onRun, onEdit, onMove, onTag, onCsv, onJson, onReview, onArchive, onRestore, onDelete,
}: {
  name: string; canEdit: boolean; busy: boolean; exporting: boolean;
  canRun: boolean; canArchive: boolean; canRestore: boolean;
  onRun(): void; onEdit?: () => void; onMove(): void; onTag(): void;
  onCsv(): void; onJson(): void; onReview(): void;
  onArchive(): void; onRestore(): void; onDelete(): void;
}) {
  return <div role="group" aria-label={`Actions for ${name}`} style={{ display: "flex", flexWrap: "wrap", gap: 2, maxWidth: 360 }}>
    {canEdit && <>
      <IconButton icon="arrow" label={`Run ${name}`} disabled={busy || !canRun} onClick={onRun} />
      {onEdit && <IconButton icon="edit" label={`Edit ${name}`} disabled={busy} onClick={onEdit} />}
      <IconButton icon="folder" label={`Move ${name} to a test plan`} disabled={busy} onClick={onMove} />
      <IconButton icon="pin" label={`Tag ${name}`} disabled={busy} onClick={onTag} />
    </>}
    <IconButton icon="grid" label={`Export ${name} as CSV`} disabled={exporting} onClick={onCsv} />
    <IconButton icon="book" label={`Export ${name} as procedures JSON`} disabled={exporting} onClick={onJson} />
    {canEdit && <>
      <IconButton icon="check" label={`Review ${name}`} disabled={busy} onClick={onReview} />
      {canArchive && <IconButton icon="save" label={`Archive ${name}`} disabled={busy} onClick={onArchive} />}
      {canRestore && <IconButton icon="undo" label={`Restore ${name}`} disabled={busy} onClick={onRestore} />}
      <IconButton icon="delete" label={`Delete ${name}`} disabled={busy} onClick={onDelete} />
    </>}
  </div>;
}
