import { createHash, randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { assertCommentAck, commentRequestHash, currentCommentPage, freezeCommentInput, type CommentAck, type CommentPending } from "./case-comment-draft";
const origin = { projectId: "project", caseId: "case", organizationId: "org", clerkActorId: "clerk", nativeActorId: "native" }, scope = { projectId: "project", organizationId: "org", actorId: "native", actorClerkUserId: "clerk" };
const draft = { identity: "draft", origin, body: "  Plain λ🎮\n<literal> observation  " };
it("frozen exact scoped comment body uses unchanged trim semantics and matching server array/hash order", async () => {
  const input = freezeCommentInput(draft, randomUUID()); expect(Object.isFrozen(input)).toBe(true); expect(input.body).toBe(draft.body.trim()); expect(draft.body).toContain("  ");
  expect(await commentRequestHash(input)).toBe(createHash("sha256").update(JSON.stringify(["project", "case", "org", "clerk", input.requestId, input.body])).digest("hex")); expect(input).not.toHaveProperty("customFields");
});
it("no silently empty/oversized/null-containing comment request", () => {
  for (const body of [" ", "x".repeat(4001), "x\0y"]) expect(() => freezeCommentInput({ ...draft, body }, randomUUID())).toThrow();
  expect(freezeCommentInput({ ...draft, body: "x".repeat(4000) }, randomUUID()).body).toHaveLength(4000);
});
it("ACK matches actual UUID/hash/body/project/case/native author before any effects", async () => {
  const input = freezeCommentInput(draft, randomUUID()), pending: CommentPending = { input, draft, requestHash: await commentRequestHash(input), everAmbiguous: true };
  const saved: CommentAck = { id: randomUUID(), requestId: input.requestId, requestHash: pending.requestHash, body: input.body, projectId: "project", caseId: "case", readScope: scope, authorName: "Synthetic", isOwn: true, createdAt: new Date().toISOString() };
  expect(() => assertCommentAck(saved, pending)).not.toThrow();
  for (const patch of [{ requestId: randomUUID() }, { requestHash: "b".repeat(64) }, { body: "Other" }, { caseId: "other" }, { projectId: "other" }, { isOwn: false }, { id: "bad" }, { readScope: { ...scope, actorId: "replacement" } }, { readScope: { ...scope, organizationId: "foreign" } }]) expect(() => assertCommentAck({ ...saved, ...patch }, pending)).toThrow();
});
it("private page requires its completed activation/current native reader and hides failed/paused/fetching caches", () => {
  const requestId = randomUUID(), data = { projectId: "project", caseId: "case", readScope: scope, readRequestId: requestId, items: [], nextCursor: null }, query = { data, error: null, isFetchedAfterMount: true, isFetching: false, isPaused: false };
  expect(currentCommentPage(query, origin, true, requestId)).toBe(data);
  for (const patch of [{ error: Error("Revoked") }, { isFetchedAfterMount: false }, { isFetching: true }, { isPaused: true }, { data: { ...data, readRequestId: randomUUID() } }, { data: { ...data, readScope: { ...scope, actorId: "replacement" } } }]) expect(currentCommentPage({ ...query, ...patch }, origin, true, requestId)).toBeNull();
  expect(currentCommentPage(query, origin, false, requestId)).toBeNull(); expect(currentCommentPage(query, null, true, requestId)).toBeNull();
});
