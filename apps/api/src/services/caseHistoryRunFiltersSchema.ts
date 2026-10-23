import { z } from "zod";

/** Existing recorded source classification: ciProvider === literal "manual"
 * maps to MANUAL; every other stored provider maps to CI_IMPORT. This does not
 * verify original automation, execution time, retry identity or provenance. */
export const caseHistoryRecordedSourceSchema = z.enum(["MANUAL", "CI_IMPORT"]);

/** Overall stored run status, deliberately NOT the selected case outcome. A
 * passed case may belong to a failed/partial run, and RUNNING is not Not run. */
export const caseHistoryRunStatusSchema = z.enum([
  "RUNNING",
  "PASSED",
  "FAILED",
  "PARTIAL",
]);

// Spread into the existing strict full filter schema. This module is browser
// pure and does not replace project/org/actor/date/configuration authorization.
export const caseHistoryRunFiltersShape = {
  recordedSource: caseHistoryRecordedSourceSchema.optional(),
  runStatus: caseHistoryRunStatusSchema.optional(),
};
export const caseHistoryRunFiltersSchema = z
  .object(caseHistoryRunFiltersShape)
  .strict();
export type CaseHistoryRunFilters = z.infer<typeof caseHistoryRunFiltersSchema>;

/** Stable optional fragment for the existing exact filter/cursor key. No
 * default classifications or statuses are invented for legacy requests.
 * Accepts a complete typed filter object; caller's full schema rejects unknown
 * fields. Only the two owned fields are projected into this key fragment. */
export function caseHistoryRunFiltersKeyFields(
  filters: CaseHistoryRunFilters,
): CaseHistoryRunFilters {
  const selected = caseHistoryRunFiltersSchema.parse({
    ...(filters.recordedSource === undefined
      ? {}
      : { recordedSource: filters.recordedSource }),
    ...(filters.runStatus === undefined
      ? {}
      : { runStatus: filters.runStatus }),
  });
  return selected;
}
