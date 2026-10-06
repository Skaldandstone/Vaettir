import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { prerequisiteAccessInput, prerequisitePageInput, prerequisiteSetInput, prerequisiteGraphHash, prerequisiteRequestHash, reviewedPrerequisiteGraph, samePrerequisiteSet } from "./casePrerequisiteSchema.js";
const pins = { projectId: "synthetic-project", caseId: "case-main", originalOrganizationId: "synthetic-org", expectedClerkActorId: "synthetic-clerk", expectedActorId: "synthetic-native" };
const input = () => ({ ...pins, requestId: randomUUID(), expectedGraphHash: "a".repeat(64), expectedPrerequisiteIds: ["retained"], prerequisiteIds: ["retained", "new-approved"], confirmed: true as const });
describe("complete reviewed prerequisite graph, pure source proof", () => {
  it("strict read pins distinguish native actor from Clerk subject and never accept half original pins", () => {
    expect(prerequisiteAccessInput.safeParse({ projectId: pins.projectId, caseId: pins.caseId, readRequestId: randomUUID() }).success).toBe(true);
    for (const change of [{ originalOrganizationId: pins.originalOrganizationId }, { expectedClerkActorId: pins.expectedClerkActorId }, { expectedActorId: pins.expectedActorId }]) expect(prerequisiteAccessInput.safeParse({ projectId: pins.projectId, caseId: pins.caseId, readRequestId: randomUUID(), ...change }).success).toBe(false);
    expect(prerequisitePageInput.safeParse({ ...pins, readRequestId: randomUUID(), search: "", sort: "case-id", sessionVerified: true }).success).toBe(false);
  });
  it("new writes require exact native actor, complete baseline, confirmation and unique bounded link IDs", () => {
    expect(prerequisiteSetInput.parse(input()).prerequisiteIds).toEqual(["retained", "new-approved"]);
    for (const change of [{ expectedActorId: undefined }, { confirmed: false }, { prerequisiteIds: ["same", "same"] }, { prerequisiteIds: [pins.caseId] }, { prerequisiteIds: Array.from({ length: 51 }, (_, i) => `case-${i}`) }, { requestId: "not-uuid" }, { expectedGraphHash: "unknown" }]) expect(prerequisiteSetInput.safeParse({ ...input(), ...change }).success).toBe(false);
  });
  it("hash retains exact body order while set-CAS and graph digest are order-independent, never omit missing/archived refs", () => {
    const edges = [{ dependentId: pins.caseId, prerequisiteId: "missing-retained" }, { dependentId: "archived", prerequisiteId: "old-pending" }];
    expect(prerequisiteGraphHash(pins.projectId, edges)).toBe(prerequisiteGraphHash(pins.projectId, edges.toReversed()));
    expect(prerequisiteGraphHash(pins.projectId, edges)).not.toBe(prerequisiteGraphHash(pins.projectId, edges.slice(0, 1)));
    const a = input(); expect(prerequisiteRequestHash(a)).not.toBe(prerequisiteRequestHash({ ...a, prerequisiteIds: a.prerequisiteIds.toReversed() }));
    expect(samePrerequisiteSet(["a", "b"], ["b", "a"])).toBe(true); expect(samePrerequisiteSet(["a", "a"], ["a", "b"])).toBe(false);
  });
  it("edits only the complete selected outgoing set and preserves unrelated missing/archived links", () => {
    const edges = [{ dependentId: pins.caseId, prerequisiteId: "old" }, { dependentId: "archived", prerequisiteId: "missing" }];
    expect(reviewedPrerequisiteGraph(edges, pins.caseId, ["new"])).toEqual([{ dependentId: "archived", prerequisiteId: "missing" }, { dependentId: pins.caseId, prerequisiteId: "new" }]);
  });
  it("rejects cycles including unrelated retained cycles, never silently prunes to make the check pass", () => {
    expect(() => reviewedPrerequisiteGraph([{ dependentId: "a", prerequisiteId: "b" }], "b", ["a"])).toThrow("cycle");
    expect(() => reviewedPrerequisiteGraph([{ dependentId: "x", prerequisiteId: "y" }, { dependentId: "y", prerequisiteId: "x" }], "other", [])).toThrow("cycle");
  });
  it("admits 1,000-case affected closure and refuses 1,001 without recursion or truncation", () => {
    const edges = Array.from({ length: 999 }, (_, i) => ({ dependentId: `c${i}`, prerequisiteId: `c${i + 1}` }));
    expect(reviewedPrerequisiteGraph(edges, "c0", ["c1"])).toHaveLength(999);
    expect(() => reviewedPrerequisiteGraph([...edges, { dependentId: "c999", prerequisiteId: "c1000" }], "c0", ["c1"])).toThrow("1,000");
    expect(() => reviewedPrerequisiteGraph(Array.from({ length: 10001 }, (_, i) => ({ dependentId: `c${i}`, prerequisiteId: "root" })), "other", [])).toThrow("10,000");
  });
});
