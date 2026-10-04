import { manualRetestObservedScopeSchema, manualRetestStartOutputSchema, manualRetestReadRequestKey,
  type ManualRetestExpectedScope, type ManualRetestReadScopeInput } from "@vaettir/api/src/services/manualRetestScopeSchema";

export function sameManualRetestScope(a: ManualRetestExpectedScope | null | undefined, b: ManualRetestExpectedScope | null | undefined) {
  return !!a && !!b && a.projectId === b.projectId && a.organizationId === b.organizationId && a.clerkActorId === b.clerkActorId;
}
export function verifiedManualRetestRead(input: ManualRetestReadScopeInput, value: { scope?: unknown; requested?: unknown }) {
  const observed = manualRetestObservedScopeSchema.safeParse(value.scope);
  return !!input.expectedScope && input.expectedScope.projectId === input.projectId && observed.success &&
    sameManualRetestScope(input.expectedScope, observed.data) && value.requested === manualRetestReadRequestKey(input);
}
type Request = ManualRetestReadScopeInput & { expectedReviewHash: string; idempotencyKey: string };
/** Server echoes bind the exact submitted request; native actorId is NOT client authority.
 * Independently verifies the unchanged deterministic run identity before consuming an uncertain request. */
export async function verifiedManualRetestAck(input: Request, value: unknown): Promise<boolean> {
  const parsed = manualRetestStartOutputSchema.safeParse(value);
  if (!parsed.success || !input.expectedScope || input.expectedScope.projectId !== input.projectId) return false;
  const receipt = parsed.data, scope = receipt.scope;
  if (!scope || !sameManualRetestScope(input.expectedScope, scope) || scope.sourceRunId !== input.sourceRunId ||
    scope.testCaseId !== input.testCaseId || scope.idempotencyKey !== input.idempotencyKey || scope.reviewHash !== input.expectedReviewHash) return false;
  try {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([input.projectId, scope.actorId, input.idempotencyKey])));
    const digest = Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
    return receipt.testRunId === `retest_${digest}`;
  } catch { return false; }
}
