// P13-05: permanent regression coverage for organization suspend/reactivate
// and ownership transfer, matching the manual verification already done
// during development. Isolated org/users, separate from any other
// integration test file so a suspend in one test can never leak into
// another test's expectations.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@vaettir/db";
import { appRouter } from "../router.js";

const RUN_ID = `admin-ownership-test-${Date.now()}`;

let orgId: string;
let projectId: string;
let ownerUserId: string;
let ownerMembershipId: string;
let newOwnerUserId: string;
let newOwnerMembershipId: string;
let staffUserId: string;

beforeAll(async () => {
  const freeTier = await prisma.planTier.findUniqueOrThrow({ where: { key: "free" } });
  const org = await prisma.organization.create({
    data: { name: `Admin ownership test org ${RUN_ID}`, slug: `admin-ownership-test-${RUN_ID}`, planTier: { connect: { id: freeTier.id } } },
  });
  orgId = org.id;
  const project = await prisma.project.create({ data: { organizationId: orgId, name: "test project", slug: "test-project" } });
  projectId = project.id;

  const [owner, newOwner, staff] = await Promise.all([
    prisma.user.create({ data: { clerkUserId: `${RUN_ID}-owner`, email: `${RUN_ID}-owner@example.com` } }),
    prisma.user.create({ data: { clerkUserId: `${RUN_ID}-newowner`, email: `${RUN_ID}-newowner@example.com` } }),
    prisma.user.create({ data: { clerkUserId: `${RUN_ID}-staff`, email: `${RUN_ID}-staff@skaldandstone.com` } }),
  ]);
  ownerUserId = owner.id;
  newOwnerUserId = newOwner.id;
  staffUserId = staff.id;

  const [ownerMembership, newOwnerMembership] = await Promise.all([
    prisma.membership.create({ data: { organizationId: orgId, userId: ownerUserId, role: "OWNER" } }),
    prisma.membership.create({ data: { organizationId: orgId, userId: newOwnerUserId, role: "EDITOR" } }),
  ]);
  ownerMembershipId = ownerMembership.id;
  newOwnerMembershipId = newOwnerMembership.id;
});

afterAll(async () => {
  if (!orgId) return;
  await prisma.auditLog.deleteMany({ where: { organizationId: orgId } });
  if (projectId) await prisma.testCase.deleteMany({ where: { projectId } });
  await prisma.project.deleteMany({ where: { organizationId: orgId } });
  await prisma.membership.deleteMany({ where: { organizationId: orgId } });
  await prisma.user.deleteMany({ where: { id: { in: [ownerUserId, newOwnerUserId, staffUserId].filter(Boolean) } } });
  await prisma.organization.delete({ where: { id: orgId } });
});

async function callerFor(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { memberships: true } });
  return appRouter.createCaller({ prisma, user });
}

describe("admin.suspendOrganization / reactivateOrganization (real DB, real router)", () => {
  it("blocks project access while suspended, and staff can still reactivate", async () => {
    const ownerCaller = await callerFor(ownerUserId);
    const staffCaller = await callerFor(staffUserId);

    await expect(ownerCaller.testCases.list({ projectId })).resolves.toBeDefined();

    await staffCaller.admin.suspendOrganization({ organizationId: orgId, reason: "integration test" });
    const suspendedOrg = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
    expect(suspendedOrg.suspendedAt).not.toBeNull();

    await expect(ownerCaller.testCases.list({ projectId })).rejects.toMatchObject({ code: "FORBIDDEN" });

    // staffProcedure itself must stay reachable on a suspended org, or a
    // suspension could never be lifted again.
    await staffCaller.admin.reactivateOrganization({ organizationId: orgId, reason: "integration test done" });
    const reactivatedOrg = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
    expect(reactivatedOrg.suspendedAt).toBeNull();

    await expect(ownerCaller.testCases.list({ projectId })).resolves.toBeDefined();
  });

  it("rejects suspending an org that's already suspended, and reactivating one that isn't", async () => {
    const staffCaller = await callerFor(staffUserId);
    await staffCaller.admin.suspendOrganization({ organizationId: orgId, reason: "second test" });
    await expect(staffCaller.admin.suspendOrganization({ organizationId: orgId, reason: "double suspend" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await staffCaller.admin.reactivateOrganization({ organizationId: orgId, reason: "cleanup" });
    await expect(staffCaller.admin.reactivateOrganization({ organizationId: orgId, reason: "double reactivate" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });
});

describe("admin.transferOwnership (real DB, real router)", () => {
  it("promotes the new owner and demotes the previous owner to Admin", async () => {
    const staffCaller = await callerFor(staffUserId);
    const result = await staffCaller.admin.transferOwnership({
      organizationId: orgId,
      newOwnerMembershipId,
      previousOwnerMembershipId: ownerMembershipId,
      reason: "integration test",
    });
    expect(result.newOwnerEmail).toBe(`${RUN_ID}-newowner@example.com`);

    const [previous, next] = await Promise.all([
      prisma.membership.findUniqueOrThrow({ where: { id: ownerMembershipId } }),
      prisma.membership.findUniqueOrThrow({ where: { id: newOwnerMembershipId } }),
    ]);
    expect(previous.role).toBe("ADMIN");
    expect(next.role).toBe("OWNER");
  });

  it("rejects transferring to the same member", async () => {
    const staffCaller = await callerFor(staffUserId);
    await expect(
      staffCaller.admin.transferOwnership({
        organizationId: orgId,
        newOwnerMembershipId,
        previousOwnerMembershipId: newOwnerMembershipId,
        reason: "should fail",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
