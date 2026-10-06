export type RepositoryReviewStatus = "APPROVED" | "PENDING_REVIEW" | "REJECTED";

// A view is scoped to a lifecycle lane, never an implicit mixture of approved
// procedures and drafts. Older saved views with an empty review scope stay safe.
export function repositoryReviewStatus(value: string): RepositoryReviewStatus {
  return value === "PENDING_REVIEW" || value === "REJECTED"
    ? value
    : "APPROVED";
}

type PlacedCase = {
  id: string;
  suitePath: string | null;
  sourceFilePath?: string | null;
};

export function sameSuiteAfterAnchor(
  suitePath: string | null,
  after: { id: string; suitePath: string | null } | undefined,
): string | null {
  return after?.suitePath === suitePath ? after.id : null;
}
export function unmodifiedCaseClick(event: {
  defaultPrevented: boolean;
  button: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}) {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

export function rowDropTarget(
  moving: PlacedCase,
  target: PlacedCase,
): { targetSuitePath: string | null; beforeCaseId: string } | null {
  if (moving.id === target.id) return null;
  // Source-file groups are presentation, not persisted folders. Do not turn a
  // row drop into an implicit folder assignment or claim it moved groups.
  if (
    target.suitePath === null &&
    (moving.suitePath !== null ||
      (moving.sourceFilePath ?? null) !== (target.sourceFilePath ?? null))
  )
    return null;
  return { targetSuitePath: target.suitePath, beforeCaseId: target.id };
}
