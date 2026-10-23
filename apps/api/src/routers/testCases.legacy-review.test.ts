// Mock caller regression only: no native runtime, DB or provider acceptance.
import { describe, expect, it } from "vitest";
import type { Context } from "../trpc.js";
import { testCasesRouter } from "./testCases.js";

function caller(signedIn = true, role = "OWNER", seatType = "FULL") {
  const accesses: string[] = [];
  const prisma = new Proxy({}, {
    get(_target, property) {
      accesses.push(String(property));
      throw Error("Legacy review endpoint touched private DB state");
    },
  });
  const user = signedIn ? {
    id: "synthetic-native", clerkUserId: "synthetic-clerk", email: "synthetic@example.invalid",
    memberships: [{ organizationId: "synthetic-org", role, seatType }],
  } : null;
  return { api: testCasesRouter.createCaller({ prisma, user, staff: null } as unknown as Context), accesses };
}

describe("legacy case review routes refuse before private reads/writes", () => {
  it.each([
    ["OWNER", "FULL"], ["EDITOR", "FULL"], ["EDITOR", "READ_ONLY"], ["VIEWER", "READ_ONLY"],
  ])("cached %s/%s cannot bypass supported snapshot review", async (role, seat) => {
    const current = caller(true, role, seat);
    for (const result of [
      current.api.pendingReview({ projectId: "unrelated-private-project" }),
      current.api.approve({ id: "foreign-private-case", note: "  Exact old note\n" }),
      current.api.reject({ id: "foreign-private-case" }),
      current.api.bulkReview({ projectId: "private-project", ids: ["foreign-case", "missing-case"], decision: "approve" }),
      current.api.bulkReview({ projectId: "private-project", ids: ["approved-case", "archived-case"], decision: "reject" }),
    ]) await expect(result).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringContaining("caseReview.") });
    expect(current.accesses).toEqual([]);
  });
  it("signed-out calls remain unauthorized without private state access", async () => {
    const current = caller(false);
    await expect(current.api.approve({ id: "private-case" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(current.accesses).toEqual([]);
  });
  it("refusal is not an assertion that historical unknown writes failed", async () => {
    const current = caller();
    for (const result of [current.api.approve({ id: "case" }), current.api.reject({ id: "case" }), current.api.bulkReview({ projectId: "project", ids: ["case"], decision: "approve" })]) {
      await expect(result).rejects.toMatchObject({ message: expect.stringContaining("uncertain response") });
    }
    expect(current.accesses).toEqual([]);
  });
});
