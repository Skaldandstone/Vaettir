import type { RouterInputs, RouterOutputs } from "./trpcReact";
export type PrerequisiteOrigin = { projectId: string; caseId: string; organizationId: string; actorId: string; actorClerkUserId: string; sessionId: string };
export type PrerequisiteDraft = { identity: string; origin: PrerequisiteOrigin; baseline: readonly string[]; graphHash: string; ids: readonly string[]; linked: RouterOutputs["testCaseStructure"]["prerequisitePage"]["linked"] };
export type PrerequisiteInput = RouterInputs["testCaseStructure"]["reviewedSetPrerequisites"];
export type PrerequisiteAck = RouterOutputs["testCaseStructure"]["reviewedSetPrerequisites"];
export type PrerequisitePending = { input: PrerequisiteInput; draft: PrerequisiteDraft; requestHash: string; everAmbiguous: boolean };
export function samePrerequisiteReader(scope: { projectId: string; organizationId: string; actorId: string; actorClerkUserId: string } | undefined, origin: PrerequisiteOrigin | null, caseId: string, sessionId: string | null | undefined) {
  return Boolean(scope && origin && scope.projectId === origin.projectId && caseId === origin.caseId && scope.organizationId === origin.organizationId && scope.actorId === origin.actorId && scope.actorClerkUserId === origin.actorClerkUserId && sessionId === origin.sessionId);
}
export function freezePrerequisiteInput(draft: PrerequisiteDraft, requestId: string): PrerequisiteInput {
  return Object.freeze({ projectId: draft.origin.projectId, caseId: draft.origin.caseId, originalOrganizationId: draft.origin.organizationId, expectedClerkActorId: draft.origin.actorClerkUserId, expectedActorId: draft.origin.actorId, requestId, expectedGraphHash: draft.graphHash, expectedPrerequisiteIds: Object.freeze([...draft.baseline]) as string[], prerequisiteIds: Object.freeze([...draft.ids]) as string[], confirmed: true as const });
}
export async function prerequisiteInputHash(input: PrerequisiteInput) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(input)));
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
}
export function assertPrerequisiteAck(ack: PrerequisiteAck, pending: PrerequisitePending) {
  const input = pending.input;
  if (ack.projectId !== input.projectId || ack.caseId !== input.caseId || ack.organizationId !== input.originalOrganizationId || ack.actorId !== input.expectedActorId || ack.actorClerkUserId !== input.expectedClerkActorId || ack.requestId !== input.requestId || ack.requestHash !== pending.requestHash || JSON.stringify(ack.prerequisiteIds) !== JSON.stringify(input.prerequisiteIds)) throw Error("The prerequisite response did not confirm the exact original native account, scope and request. Keep the retained UUID for recovery.");
}
