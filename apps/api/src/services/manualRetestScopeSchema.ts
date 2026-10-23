import { z } from "zod";
const identity = z.string().min(1).max(200);
export const manualRetestExpectedScopeSchema = z.object({ projectId: identity, organizationId: identity, clerkActorId: identity }).strict();
export const manualRetestObservedScopeSchema = manualRetestExpectedScopeSchema.extend({ actorId: identity }).strict();
export const manualRetestStartOutputSchema = z.object({
  testRunId: identity, recovered: z.boolean(),
  scope: manualRetestObservedScopeSchema.extend({ sourceRunId: identity, testCaseId: identity,
    idempotencyKey: z.string().uuid(), reviewHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict().optional(),
}).strict();
export type ManualRetestExpectedScope = z.infer<typeof manualRetestExpectedScopeSchema>;
export type ManualRetestObservedScope = z.infer<typeof manualRetestObservedScopeSchema>;
export type ManualRetestStartOutput = z.infer<typeof manualRetestStartOutputSchema>;
export type ManualRetestReadScopeInput = { projectId: string; sourceRunId: string; testCaseId: string; expectedScope?: ManualRetestExpectedScope; before?: string };
/** Browser-pure exact read identity, not a permission token or historical tenancy claim. */
export function manualRetestReadRequestKey(input: ManualRetestReadScopeInput) {
  return JSON.stringify({ projectId: input.projectId, sourceRunId: input.sourceRunId, testCaseId: input.testCaseId,
    ...(input.expectedScope === undefined ? {} : { expectedScope: { projectId: input.expectedScope.projectId,
      organizationId: input.expectedScope.organizationId, clerkActorId: input.expectedScope.clerkActorId } }),
    ...(input.before === undefined ? {} : { before: input.before }) });
}
