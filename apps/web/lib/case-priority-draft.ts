import type { RouterInputs, RouterOutputs } from "./trpcReact";
export type PriorityInput = RouterInputs["casePriority"]["set"];
export type PriorityEnvelope = RouterInputs["casePriority"]["setReviewed"];
export type PriorityPreview = RouterOutputs["casePriority"]["preview"];
export type PriorityAck = RouterOutputs["casePriority"]["setReviewed"];
export type PriorityOrigin = Readonly<{ projectId: string; caseId: string; organizationId: string; clerkActorId: string; nativeActorId: string }>;
export type PriorityDraft = Readonly<{ identity: string; origin: PriorityOrigin; priority: PriorityInput["priority"]; previousPriority: PriorityInput["priority"]; caseRevision: string }>;
export type PriorityPending = Readonly<{ envelope: Readonly<PriorityEnvelope>; draft: PriorityDraft; requestHash: string; everAmbiguous: boolean }>;
export function samePriorityReader(scope: PriorityPreview["readScope"] | undefined, original: PriorityOrigin) {
  return !!scope && scope.projectId === original.projectId && scope.organizationId === original.organizationId && scope.actorClerkUserId === original.clerkActorId && scope.actorId === original.nativeActorId;
}
export function freezePriorityEnvelope(draft: PriorityDraft, requestId: string): Readonly<PriorityEnvelope> {
  if (!/^[a-f0-9]{64}$/.test(draft.caseRevision) || !["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(draft.priority)) throw Error("Review the current native case and choose a supported priority.");
  // Exact original Zod object order. Never add envelope/native fields to the
  // established inner request hash or rebind its original author/workspace.
  const input = Object.freeze({ projectId: draft.origin.projectId, caseId: draft.origin.caseId, priority: draft.priority, expectedCaseRevision: draft.caseRevision, requestId, originalOrganizationId: draft.origin.organizationId, expectedClerkActorId: draft.origin.clerkActorId });
  return Object.freeze({ input, expectedNativeActorId: draft.origin.nativeActorId });
}
export async function priorityRequestHash(input: Readonly<PriorityInput>): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(input)));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}
export function assertPriorityAck(saved: PriorityAck, held: PriorityPending) {
  if (saved.requestId !== held.envelope.input.requestId || saved.requestHash !== held.requestHash || saved.priority !== held.envelope.input.priority || saved.projectId !== held.envelope.input.projectId || saved.caseId !== held.envelope.input.caseId || typeof saved.replayed !== "boolean" || !samePriorityReader(saved.readScope, held.draft.origin)) throw Error("The priority acknowledgement did not match the original native author, case, decision and request hash. Retain the exact request for recovery.");
}
