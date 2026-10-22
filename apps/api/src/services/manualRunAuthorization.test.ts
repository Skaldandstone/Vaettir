import { beforeEach, expect, it, vi } from "vitest";
const policies = vi.hoisted(() => ({ read: vi.fn(), lock: vi.fn() }));
vi.mock("./identityAccessPolicy.js", () => ({ readPublishedIdentityAccess: policies.read, lockPublishedIdentityAction: policies.lock }));
import { manualRunPermission } from "./manualRunAuthorization.js";
const tx = {} as Parameters<typeof manualRunPermission>[0];
const viewer = { role: "VIEWER", seatType: "FULL" };
const actor = { id: "native", clerkUserId: "verified", authenticatedClerkSubject: "verified" };
beforeEach(() => { vi.clearAllMocks(); policies.read.mockResolvedValue({ permissions: ["runs.execute"] }); policies.lock.mockResolvedValue({ permissions: ["runs.execute"] }); });
it("locks the exact run action only for an independently supplied matching subject", async () => {
  expect(await manualRunPermission(tx, actor, "org", "project", viewer, true)).toBe(true);
  expect(policies.lock).toHaveBeenCalledExactlyOnceWith(tx, { userId: "native", clerkSubject: "verified" }, "org", "project", "runs.execute");
  expect(policies.read).not.toHaveBeenCalled();
});
it.each([undefined, "other"])("cached native subject alone or mismatched authority cannot grant execution: %s", async subject => {
  const unverified = { ...actor, authenticatedClerkSubject: subject };
  expect(await manualRunPermission(tx, unverified, "org", "project", viewer, false)).toBe(false);
  await expect(manualRunPermission(tx, unverified, "org", "project", viewer, true)).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(policies.lock).not.toHaveBeenCalled(); expect(policies.read).not.toHaveBeenCalled();
});
it("does not turn read-only seats or case authors into run executors", async () => {
  expect(await manualRunPermission(tx, actor, "org", "project", { ...viewer, seatType: "READ_ONLY" }, false)).toBe(false);
  policies.read.mockResolvedValue({ permissions: ["cases.write"] });
  expect(await manualRunPermission(tx, actor, "org", "project", viewer, false)).toBe(false);
});
it("retains native editor authority independently of custom roles", async () => {
  expect(await manualRunPermission(tx, { id: "native", clerkUserId: "cached" }, "org", "project", { role: "EDITOR", seatType: "FULL" }, true)).toBe(true);
  expect(policies.lock).not.toHaveBeenCalled(); expect(policies.read).not.toHaveBeenCalled();
});
