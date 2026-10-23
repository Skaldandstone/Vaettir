import { z } from "zod";

export const HUMAN_EDIT_SKIP_REASON = "Case changed since its last import; source updates were not applied. Review the human edits and source changes.";

export const importSkippedRowsSchema = z.array(z.object({
  rowNumber: z.number().int().positive(),
  reason: z.string().min(1),
}));

type ImportOutcome = {
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  errors: unknown;
};

export function importSkippedRows(errors: unknown) {
  const parsed = importSkippedRowsSchema.safeParse(errors);
  return parsed.success ? parsed.data : [];
}

function onlyProtectedEdits(outcome: ImportOutcome) {
  const rows = importSkippedRows(outcome.errors);
  return outcome.createdCount === 0 && outcome.updatedCount === 0 &&
    outcome.skippedCount > 0 && rows.length === outcome.skippedCount &&
    rows.every(row => row.reason === HUMAN_EDIT_SKIP_REASON);
}

export function completedImportStatus(outcome: ImportOutcome): "FAILED" | "SUCCEEDED" {
  return outcome.skippedCount > 0 && outcome.createdCount === 0 && outcome.updatedCount === 0 &&
    !onlyProtectedEdits(outcome) ? "FAILED" : "SUCCEEDED";
}

// Derive a readable outcome without rewriting retained historical job records.
export function importStatusLabel(outcome: ImportOutcome & { status: string }) {
  if ((outcome.status === "FAILED" || outcome.status === "SUCCEEDED") && onlyProtectedEdits(outcome)) return "Needs review";
  if (outcome.status === "SUCCEEDED") return outcome.skippedCount > 0 ? "Completed with skipped rows" : "Completed";
  if (outcome.status === "FAILED") return "Failed";
  return outcome.status;
}
