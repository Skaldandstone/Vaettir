import { createHash, randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { assertPriorityAck, freezePriorityEnvelope, priorityRequestHash, type PriorityAck } from "./case-priority-draft";
const origin = { projectId: "project", caseId: "case", organizationId: "org", clerkActorId: "clerk", nativeActorId: "native" }, scope = { projectId: "project", organizationId: "org", actorClerkUserId: "clerk", actorId: "native" };
const draft = { identity: "draft", origin, priority: "HIGH" as const, previousPriority: "MEDIUM" as const, caseRevision: "a".repeat(64) };
it("native reviewed envelope freezes the unchanged old inner body/property order/hash, no rationale or scope transfer", async () => {
  const envelope = freezePriorityEnvelope(draft, randomUUID()); expect(Object.isFrozen(envelope)).toBe(true); expect(Object.isFrozen(envelope.input)).toBe(true); expect(envelope.expectedNativeActorId).toBe("native");
  expect(Object.keys(envelope.input)).toEqual(["projectId", "caseId", "priority", "expectedCaseRevision", "requestId", "originalOrganizationId", "expectedClerkActorId"]);
  expect(await priorityRequestHash(envelope.input)).toBe(createHash("sha256").update(JSON.stringify(envelope.input)).digest("hex")); expect(envelope.input).not.toHaveProperty("expectedNativeActorId"); expect(envelope.input).not.toHaveProperty("rationale"); expect(envelope.input).not.toHaveProperty("customFields");
});
it("new unsupported choice or fake revision is rejected without coercion", () => {
  expect(() => freezePriorityEnvelope({ ...draft, priority: "OTHER" as never }, randomUUID())).toThrow(); expect(() => freezePriorityEnvelope({ ...draft, caseRevision: "stale" }, randomUUID())).toThrow();
});
it("ACK validates whole old decision/hash/UUID and original native current-author scope", async () => {
  const envelope = freezePriorityEnvelope(draft, randomUUID()), held = { envelope, draft, requestHash: await priorityRequestHash(envelope.input), everAmbiguous: true };
  const saved: PriorityAck = { projectId: "project", caseId: "case", priority: "HIGH", replayed: true, requestId: envelope.input.requestId, requestHash: held.requestHash, readScope: scope };
  expect(() => assertPriorityAck(saved, held)).not.toThrow();
  for (const patch of [{ priority: "LOW" as const }, { requestId: randomUUID() }, { requestHash: "b".repeat(64) }, { projectId: "other" }, { caseId: "other" }, { replayed: undefined as never }, { readScope: { ...scope, actorId: "replacement" } }, { readScope: { ...scope, organizationId: "foreign" } }]) expect(() => assertPriorityAck({ ...saved, ...patch }, held)).toThrow();
});
