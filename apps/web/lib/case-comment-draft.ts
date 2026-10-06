import type { RouterInputs, RouterOutputs } from "./trpcReact";
export type CommentOrigin = Readonly<{ projectId: string; caseId: string; organizationId: string; clerkActorId: string; nativeActorId: string }>;
export type CommentInput = RouterInputs["caseComments"]["create"];
export type CommentAck = RouterOutputs["caseComments"]["create"];
export type CommentDraft = Readonly<{ identity: string; origin: CommentOrigin; body: string }>;
export type CommentPending = Readonly<{ input: Readonly<CommentInput>; draft: CommentDraft; requestHash: string; everAmbiguous: boolean }>;
export function sameCommentReader(scope: RouterOutputs["caseComments"]["access"]["readScope"] | undefined, origin: CommentOrigin) {
  return !!scope && scope.projectId === origin.projectId && scope.organizationId === origin.organizationId && scope.actorClerkUserId === origin.clerkActorId && scope.actorId === origin.nativeActorId;
}
export function freezeCommentInput(draft: CommentDraft, requestId: string): Readonly<CommentInput> {
  const body = draft.body.trim();
  if (!body || body.length > 4000 || body.includes("\0")) throw Error("Enter a plain-text comment of 1–4,000 characters without null characters.");
  // All members are strings. Copy rather than retain caller-owned references.
  return Object.freeze({ projectId: draft.origin.projectId, caseId: draft.origin.caseId, originalOrganizationId: draft.origin.organizationId, expectedClerkActorId: draft.origin.clerkActorId, requestId, body });
}
export async function commentRequestHash(input: Readonly<CommentInput>): Promise<string> {
  const text = JSON.stringify([input.projectId, input.caseId, input.originalOrganizationId, input.expectedClerkActorId, input.requestId, input.body]);
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}
export function assertCommentAck(saved: CommentAck, pending: CommentPending) {
  if (saved.requestId !== pending.input.requestId || saved.requestHash !== pending.requestHash || saved.body !== pending.input.body || saved.projectId !== pending.input.projectId || saved.caseId !== pending.input.caseId || !sameCommentReader(saved.readScope, pending.draft.origin) || !saved.isOwn || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(saved.id))
    throw Error("The comment acknowledgement did not match the original request, body and native author. Keep the exact request for recovery.");
}
export function currentCommentPage<T extends RouterOutputs["caseComments"]["list"]>(query: { data?: T; error?: unknown; isFetchedAfterMount: boolean; isFetching: boolean; isPaused: boolean }, origin: CommentOrigin | null, readable: boolean, requestId: string): T | null {
  const data = query.data;
  return readable && origin && query.isFetchedAfterMount && !query.error && !query.isFetching && !query.isPaused && data?.readRequestId === requestId && data.projectId === origin.projectId && data.caseId === origin.caseId && sameCommentReader(data.readScope, origin) ? data : null;
}
