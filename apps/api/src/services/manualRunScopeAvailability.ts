import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { supportedManualExecutionIdentity } from "./manualExecutionReadScopeSchema.js";
const identity = z
  .string()
  .min(1)
  .max(200)
  .refine(supportedManualExecutionIdentity);
export const manualRunScopeAvailabilitySchema = z
  .object({
    plannedCaseIds: z.array(identity).max(1000),
    unavailableCases: z
      .array(
        z
          .object({
            testCaseId: identity,
            reason: z.literal("MISSING_CASE_AND_FROZEN_DEFINITION"),
          })
          .strict(),
      )
      .max(1000),
    scopeAvailability: z
      .object({
        plannedCount: z.number().int().min(0).max(1000),
        availableCount: z.number().int().min(0).max(1000),
        unavailableCount: z.number().int().min(0).max(1000),
        complete: z.boolean(),
        procedureBasis: z.enum([
          "FROZEN_RUN_DEFINITIONS",
          "LEGACY_CURRENT_CASE_DEFINITIONS",
        ]),
      })
      .strict(),
  })
  .strict();
function unsupported() {
  return new TRPCError({
    code: "PRECONDITION_FAILED",
    message:
      "This saved run's planned identities or available procedure partition is unsupported. No planned case was dropped, substituted or treated as complete.",
  });
}
function admittedIds(raw: unknown) {
  const parsed = z.array(identity).max(1000).safeParse(raw);
  if (!parsed.success || new Set(parsed.data).size !== parsed.data.length)
    throw unsupported();
  return parsed.data;
}
/** Current case IDs must have already passed original project/tenant admission.
 * Missing cases are metadata only, never fabricated executable empty cases.
 * Frozen definitions must cover the entire saved scope, not a partial fallback.
 * This is an identity-existence partition, not approval provenance, complete
 * procedure validation, readiness or authorization to write an observation. */
export function manualRunScopeAvailability(
  rawPlannedCaseIds: unknown,
  rawCurrentCaseIds: unknown,
  rawFrozenDefinitionIds: unknown | null,
) {
  const plannedCaseIds = admittedIds(rawPlannedCaseIds),
    current = admittedIds(rawCurrentCaseIds),
    planned = new Set(plannedCaseIds);
  if (current.some((id) => !planned.has(id))) throw unsupported();
  const frozen =
    rawFrozenDefinitionIds === null
      ? null
      : admittedIds(rawFrozenDefinitionIds);
  if (
    frozen &&
    (frozen.length !== plannedCaseIds.length ||
      frozen.some((id) => !planned.has(id)))
  )
    throw unsupported();
  const available = new Set(frozen ?? current),
    availableCaseIds = plannedCaseIds.filter((id) => available.has(id)),
    unavailableCases = plannedCaseIds
      .filter((id) => !available.has(id))
      .map((testCaseId) => ({
        testCaseId,
        reason: "MISSING_CASE_AND_FROZEN_DEFINITION" as const,
      }));
  return {
    availableCaseIds,
    plannedCaseIds,
    unavailableCases,
    scopeAvailability: {
      plannedCount: plannedCaseIds.length,
      availableCount: availableCaseIds.length,
      unavailableCount: unavailableCases.length,
      complete: unavailableCases.length === 0,
      procedureBasis:
        frozen === null
          ? ("LEGACY_CURRENT_CASE_DEFINITIONS" as const)
          : ("FROZEN_RUN_DEFINITIONS" as const),
    },
  };
}
export function requireCompleteManualRunScopeAvailability(
  value: ReturnType<typeof manualRunScopeAvailability>,
) {
  if (!value.scopeAvailability.complete)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "A saved planned case has neither its original frozen definition nor an available legacy case procedure. Completion is refused; the planned denominator, existing observations and run status were not changed.",
    });
}
