import { manualCaseResultAckSchema, manualCaseResultReadKey, manualCaseResultWriteKey, type ManualCaseResultRead, type ManualCaseResultWrite } from "@vaettir/api/src/services/manualCaseResultSchema";
import { manualRetestObservedScopeSchema } from "@vaettir/api/src/services/manualRetestScopeSchema";
export function manualCaseReadMatches(input: ManualCaseResultRead & { before?: string; limit?: number }, value: { scope?: unknown; requested?: unknown }) {
  const parsed = manualRetestObservedScopeSchema.safeParse(value.scope);
  return parsed.success && input.expectedScope.projectId === input.projectId && parsed.data.projectId === input.projectId &&
    parsed.data.organizationId === input.expectedScope.organizationId && parsed.data.clerkActorId === input.expectedScope.clerkActorId && value.requested === manualCaseResultReadKey(input);
}
export async function manualCaseAckMatches(input: ManualCaseResultWrite, expectedRevisionNumber: number, value: unknown, expectedResultId?: string | null, expectedActorId?: string) {
  const parsed = manualCaseResultAckSchema.safeParse(value);
  if (!parsed.success || !Number.isInteger(expectedRevisionNumber) || expectedRevisionNumber < 1 || expectedRevisionNumber > 100) return false;
  const ack = parsed.data;
  if (input.expectedScope.projectId !== input.projectId || ack.scope.projectId !== input.projectId || ack.scope.organizationId !== input.expectedScope.organizationId ||
    ack.scope.clerkActorId !== input.expectedScope.clerkActorId || ack.testRunId !== input.testRunId || ack.testCaseId !== input.testCaseId ||
    ack.idempotencyKey !== input.idempotencyKey || ack.revisionNumber !== expectedRevisionNumber || (expectedResultId && ack.resultId !== expectedResultId) || (expectedActorId && ack.scope.actorId !== expectedActorId)) return false;
  try {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(manualCaseResultWriteKey(input)));
    return ack.requestHash === Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
  } catch { return false; }
}
