import { z } from "zod";

/** UTF-16 length matches native query identities; lone surrogates and controls
 * cannot acquire a different transport encoding or invisible read scope. */
export function supportedManualExecutionIdentity(value: string): boolean {
  if (
    value.length < 1 ||
    value.length > 200 ||
    /[\u0000-\u001f\u007f-\u009f]/.test(value)
  )
    return false;
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (code >= 0xd800 && code <= 0xdfff) return false;
  }
  return true;
}
const identity = z
  .string()
  .min(1)
  .max(200)
  .refine(
    supportedManualExecutionIdentity,
    "Execution identity contains unsupported characters.",
  );
export const manualExecutionReadScopeInputSchema = z
  .object({
    testRunId: identity,
    projectId: identity.optional(),
    originalOrganizationId: identity.optional(),
    expectedClerkActorId: identity.optional(),
  })
  .strict();
export type ManualExecutionReadScopeInput = z.infer<
  typeof manualExecutionReadScopeInputSchema
>;
export const manualExecutionReadScopeOutputSchema = z
  .object({
    testRunId: identity,
    projectId: identity,
    organizationId: identity,
    originalOrganizationId: identity,
    actorId: identity,
    clerkActorId: identity,
    canWrite: z.boolean(),
    readRequestKey: z.string().min(1).max(5600),
  })
  .strict();
export type ManualExecutionObservedReadScope = z.infer<
  typeof manualExecutionReadScopeOutputSchema
>;
/** Exact current read binding, not a token or proof of historical execution tenancy.
 * Absent optional fields stay absent for legacy callers. */
export function manualExecutionReadRequestKey(
  input: ManualExecutionReadScopeInput,
) {
  return JSON.stringify({
    testRunId: input.testRunId,
    ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
    ...(input.originalOrganizationId === undefined
      ? {}
      : { originalOrganizationId: input.originalOrganizationId }),
    ...(input.expectedClerkActorId === undefined
      ? {}
      : { expectedClerkActorId: input.expectedClerkActorId }),
  });
}
