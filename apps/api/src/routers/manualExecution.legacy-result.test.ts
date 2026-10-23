// Actual protected-router synthetic caller checks, not native DB acceptance.
import { describe, expect, it } from "vitest";
import type { Context } from "../trpc.js";
import { manualExecutionRouter } from "./manualExecution.js";

function caller(signedIn = true, role = "OWNER", seatType = "FULL") {
  const accesses: string[] = [];
  const prisma = new Proxy({}, { get(_target, key) {
    accesses.push(String(key));
    throw Error("Unversioned result must not read or mutate private DB state");
  } });
  const user = signedIn ? { id: "synthetic-native", clerkUserId: "synthetic-clerk",
    email: "synthetic@example.invalid", memberships: [{ organizationId: "synthetic-org", role, seatType }] } : null;
  return { api: manualExecutionRouter.createCaller({ prisma, user, staff: null } as unknown as Context), accesses };
}

describe("unversioned manual outcome endpoint has no safe new write or receipt recovery", () => {
  it.each([["OWNER", "FULL"], ["EDITOR", "FULL"], ["VIEWER", "READ_ONLY"]])(
    "cached %s/%s cannot write, heal or infer a receipt from a current row", async (role, seat) => {
      const current = caller(true, role, seat);
      for (const status of ["PASS", "FAIL", "BLOCKED", "SKIP"] as const) {
        await expect(current.api.recordResult({ testRunId: "foreign-or-closed-run", testCaseId: "missing-case", status,
          note: " Exact\n historical note ", observations: { environment: " Synthetic environment " } }))
          .rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringContaining("No result was changed") });
      }
      expect(current.accesses).toEqual([]);
    },
  );
  it("keeps protected transport and old input validation", async () => {
    const signedOut = caller(false);
    await expect(signedOut.api.recordResult({ testRunId: "run", testCaseId: "case", status: "PASS" }))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(signedOut.accesses).toEqual([]);
    const current = caller();
    await expect(current.api.recordResult({ testRunId: "run", testCaseId: "case", status: "INVENTED" as "PASS" }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(current.accesses).toEqual([]);
  });
});
