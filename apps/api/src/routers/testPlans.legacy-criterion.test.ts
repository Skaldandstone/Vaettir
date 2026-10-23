import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "../trpc.js";
vi.mock("../services/auditLog.js", () => ({ recordAudit: vi.fn() }));
vi.mock("../services/releaseReadiness.js", () => ({
  refreshReleaseReadiness: vi.fn(),
}));
import { recordAudit } from "../services/auditLog.js";
import { refreshReleaseReadiness } from "../services/releaseReadiness.js";
import { testPlansRouter } from "./testPlans.js";

function caller({
  role = "OWNER",
  seat = "FULL",
  actor = "original-actor",
  member = true,
  signedIn = true,
}: {
  role?: string;
  seat?: string;
  actor?: string;
  member?: boolean;
  signedIn?: boolean;
} = {}) {
  const accesses: string[] = [];
  // Any read, write, transaction, or private-body lookup is forbidden. Capture
  // property access as well as invocation so a future lookup cannot slip in.
  const db = new Proxy(
    {},
    {
      get(_target, property) {
        accesses.push(String(property));
        throw Error("Deprecated endpoint touched the database");
      },
    },
  );
  const user = signedIn
    ? {
        id: "synthetic-native-actor",
        clerkUserId: actor,
        email: "synthetic@example.com",
        memberships: member
          ? [{ organizationId: "cached-original-org", role, seatType: seat }]
          : [],
      }
    : null;
  const ctx = { prisma: db, user, staff: null } as unknown as Context;
  return { api: testPlansRouter.createCaller(ctx), accesses };
}
beforeEach(() => {
  vi.clearAllMocks();
});

describe("deprecated criterion writes fail closed (mock callers, no native execution)", () => {
  it.each([
    { label: "cached full Owner", options: {} },
    { label: "cached full Editor", options: { role: "EDITOR" } },
    {
      label: "read-only Editor",
      options: { role: "EDITOR", seat: "READ_ONLY" },
    },
    { label: "Viewer", options: { role: "VIEWER", seat: "READ_ONLY" } },
    { label: "changed signed-in actor", options: { actor: "another-actor" } },
    { label: "revoked original membership", options: { member: false } },
  ])(
    "$label cannot use either legacy input to read or mutate a criterion",
    async ({ options }) => {
      const c = caller(options);
      for (const operation of ["add", "delete"] as const) {
        const request =
          operation === "add"
            ? c.api.addAcceptanceCriterion({
                testPlanId: "unrelated-private-plan-id",
                description: "  Original cached wording\n",
                requirementId: "foreign-requirement-id",
              })
            : c.api.deleteAcceptanceCriterion({
                id: "unrelated-private-criterion-id",
              });
        await expect(request).rejects.toMatchObject({
          code: "PRECONDITION_FAILED",
          message: expect.stringContaining(
            `testPlanGovernance.${operation === "add" ? "addCriterion" : "deleteCriterion"}`,
          ),
        });
      }
      await expect(c.api.update({ id: "unrelated-private-plan-id", name: "Cached header", status: "ACTIVE", customFields: {} })).rejects.toMatchObject({
        code: "PRECONDITION_FAILED", message: expect.stringContaining("testPlanGovernance.editPlanHeader"),
      });
      for (const payload of [{ id: "private-plan", status: "ACTIVE" as const }, { id: "private-plan", status: "APPROVED" as const, customFields: { saved: "stale metadata" } }]) {
        await expect(c.api.update(payload)).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringContaining("testPlanGovernance.setPlanStatus") });
      }
      expect(c.accesses).toEqual([]);
      expect(recordAudit).not.toHaveBeenCalled();
      expect(refreshReleaseReadiness).not.toHaveBeenCalled();
    },
  );
  it("warns about earlier unknown acknowledgements without pretending a receipt or rejecting historical application", async () => {
    const c = caller();
    for (const request of [
      c.api.addAcceptanceCriterion({
        testPlanId: "p",
        description: "Existing wording",
      }),
      c.api.deleteAcceptanceCriterion({ id: "c" }),
      c.api.update({ id: "private-plan", status: "ACTIVE", customFields: {} }),
    ]) {
      await expect(request).rejects.toMatchObject({
        message: expect.stringContaining(
          "An earlier unacknowledged legacy request may already have applied",
        ),
      });
    }
    await expect(
      c.api.deleteAcceptanceCriterion({ id: "c" }),
    ).rejects.toMatchObject({
      message: expect.stringContaining("do not automatically resubmit"),
    });
    expect(c.accesses).toEqual([]);
    expect(recordAudit).not.toHaveBeenCalled();
    expect(refreshReleaseReadiness).not.toHaveBeenCalled();
  });
  it("retains protected authentication and ordinary legacy input validation without any database access", async () => {
    const anonymous = caller({ signedIn: false });
    await expect(
      anonymous.api.addAcceptanceCriterion({
        testPlanId: "p",
        description: "Valid legacy text",
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      anonymous.api.deleteAcceptanceCriterion({ id: "c" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(anonymous.api.update({ id: "p", name: "Valid legacy header", status: "DRAFT" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const authenticated = caller();
    await expect(
      authenticated.api.addAcceptanceCriterion({
        testPlanId: "p",
        description: "",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(anonymous.accesses).toEqual([]);
    expect(authenticated.accesses).toEqual([]);
    expect(recordAudit).not.toHaveBeenCalled();
    expect(refreshReleaseReadiness).not.toHaveBeenCalled();
  });
  it.each([
    { name: "Changed raw name" },
    { description: "" },
    { description: " exact\nprose " },
    { name: undefined },
    { description: undefined },
  ])("refuses every supplied legacy header field before lookup or partially writing accompanying status/JSON: %j", async (header) => {
    const c = caller();
    await expect(c.api.update({
      id: "unrelated-private-plan-id", status: "ACTIVE",
      customFields: { unrelated: "must not apply" }, ...header,
    })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringContaining("testPlanGovernance.editPlanHeader"),
    });
    expect(c.accesses).toEqual([]);
    expect(recordAudit).not.toHaveBeenCalled();
    expect(refreshReleaseReadiness).not.toHaveBeenCalled();
  });
});
