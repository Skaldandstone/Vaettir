import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { commentBodySchema, commentCreateInput, commentListInput } from "./caseComments.js";
import { casePriorityInput } from "./casePriority.js";
const scope = { projectId: "synthetic-project", caseId: "synthetic-case", originalOrganizationId: "synthetic-org", expectedClerkActorId: "synthetic-actor" };
describe("bounded case collaboration inputs", () => {
  it("retains plain text and multiline technical descriptions without interpreting markup", () => {
    expect(commentBodySchema.parse(" <script>alert(1)</script>\nGET /synthetic " )).toBe("<script>alert(1)</script>\nGET /synthetic");
  });
  it("rejects empty, oversized and null-containing comments", () => {
    for (const value of [" ", "a".repeat(4001), "a\0b"]) expect(commentBodySchema.safeParse(value).success).toBe(false);
    expect(commentBodySchema.safeParse("a".repeat(4000)).success).toBe(true);
  });
  it("requires original actor/organization pins and a UUID receipt, with no author supplied by clients", () => {
    const input = { ...scope, requestId: randomUUID(), body: "Synthetic comment" };
    expect(commentCreateInput.parse(input)).toEqual(input);
    expect(commentCreateInput.safeParse({ ...input, authorId: "other" }).success).toBe(false);
    expect(commentCreateInput.safeParse({ ...input, expectedClerkActorId: undefined }).success).toBe(false);
    expect(commentCreateInput.safeParse({ ...input, requestId: "not-a-uuid" }).success).toBe(false);
  });
  it("bounds pagination and accepts serialized wire dates", () => {
    expect(commentListInput.parse(scope).limit).toBe(25);
    expect(commentListInput.parse({ ...scope, limit: 50, cursor: { id: randomUUID(), createdAt: "2026-10-05T00:00:00Z" } }).cursor?.createdAt).toBeInstanceOf(Date);
    for (const limit of [0, 51, 1.5]) expect(commentListInput.safeParse({ ...scope, limit }).success).toBe(false);
    for (const createdAt of [true, 0, "10/5/2026", "invalid"]) expect(commentListInput.safeParse({ ...scope, cursor: { id: randomUUID(), createdAt } }).success).toBe(false);
  });
  it("allows all four priorities without requiring risk assessment or business narrative", () => {
    for (const priority of ["LOW", "MEDIUM", "HIGH", "CRITICAL"]) expect(casePriorityInput.safeParse({ ...scope, priority, requestId: randomUUID(), expectedCaseRevision: "a".repeat(64) }).success).toBe(true);
    expect(casePriorityInput.safeParse({ ...scope, priority: "HIGH", requestId: randomUUID() }).success).toBe(false);
  });
});
