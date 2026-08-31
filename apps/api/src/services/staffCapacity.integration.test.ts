import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, type OrgRole, type SeatType } from "@vaettir/db";
import { appRouter } from "../router.js";
import { createContext } from "../trpc.js";
import { hardDeleteOrganization } from "./orgHardDelete.js";
import { lockOrganization } from "./organizationLock.js";

let orgId: string, ownerId: string, ownerMemberId: string, staffId: string;
let users: string[];
async function addUser(role?: OrgRole, seatType: SeatType = "FULL") {
  const suffix = randomUUID();
  const user = await prisma.user.create({ data: { clerkUserId: suffix, email: `${suffix}@example.com` } });
  users.push(user.id);
  const member = role ? await prisma.membership.create({ data: { organizationId: orgId, userId: user.id, role, seatType } }) : null;
  return { user, member: member! };
}
async function caller(id: string) {
  return appRouter.createCaller({ prisma, user: await prisma.user.findUniqueOrThrow({ where: { id }, include: { memberships: true } }), staff: null });
}
function support() { return appRouter.createCaller({ prisma, user: null, staff: { actor: "capacity-test@skaldandstone.com" } }); }
async function fullSeats() { return prisma.membership.count({ where: { organizationId: orgId, seatType: "FULL" } }); }
beforeEach(async () => {
  users = [];
  const suffix = randomUUID();
  const tier = await prisma.planTier.findUniqueOrThrow({ where: { key: "private-beta" } });
  orgId = (await prisma.organization.create({ data: { name: suffix, slug: suffix, planTierId: tier.id } })).id;
  const owner = await addUser("OWNER");
  ownerId = owner.user.id; ownerMemberId = owner.member.id;
  staffId = (await addUser()).user.id;
  await prisma.user.update({ where: { id: staffId }, data: { email: `${suffix}@skaldandstone.com` } });
});
afterEach(async () => {
  if (orgId) {
    users.push(...(await prisma.apiKey.findMany({ where: { organizationId: orgId } })).map((k) => k.serviceUserId));
    await hardDeleteOrganization(prisma, orgId, staffId, "Staff capacity fixture cleanup");
    await prisma.organizationDeletionLog.deleteMany({ where: { organizationId: orgId } });
  }
  await prisma.user.deleteMany({ where: { id: { in: users } } });
});

describe("Staff capacity and ownership boundaries", () => {
  it("counts reserved invitations before converting a read-only owner, then permits a valid transfer", async () => {
    await Promise.all(Array.from({ length: 3 }, () => addUser("EDITOR")));
    const target = await addUser("VIEWER", "READ_ONLY");
    const owner = await caller(ownerId), staff = await caller(staffId);
    const invite = await owner.organization.inviteMember({ organizationId: orgId, email: `${randomUUID()}@example.com`, role: "EDITOR", seatType: "FULL" });
    const input = { organizationId: orgId, newOwnerMembershipId: target.member.id, previousOwnerMembershipId: ownerMemberId, reason: "test transfer" };
    await expect(staff.admin.transferOwnership(input)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: target.member.id } })).seatType).toBe("READ_ONLY");
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: ownerMemberId } })).role).toBe("OWNER");
    expect((await staff.admin.overrideSeatCheck({ organizationId: orgId, seatType: "FULL", reason: "test" })).allowed).toBe(false);
    await owner.organization.revokeInvitation({ invitationId: invite.id });
    await expect(staff.admin.transferOwnership(input)).resolves.toEqual({ newOwnerEmail: target.user.email });
    expect(await fullSeats()).toBe(5);
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: ownerMemberId } })).role).toBe("ADMIN");
  });

  it("serializes competing transfers into the last full seat", async () => {
    await Promise.all(Array.from({ length: 3 }, () => addUser("EDITOR")));
    const targets = await Promise.all(Array.from({ length: 2 }, () => addUser("VIEWER", "READ_ONLY")));
    const staff = await caller(staffId);
    const results = await Promise.allSettled(targets.map((target) => staff.admin.transferOwnership({ organizationId: orgId, previousOwnerMembershipId: ownerMemberId, newOwnerMembershipId: target.member.id, reason: "concurrent transfer" })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await fullSeats()).toBe(5);
    expect(await prisma.membership.count({ where: { organizationId: orgId, role: "OWNER" } })).toBe(1);
  });

  it("cannot remove both owners with concurrent staff requests", async () => {
    const second = await addUser("OWNER");
    const staff = await caller(staffId);
    const results = await Promise.allSettled([ownerMemberId, second.member.id].map((membershipId) => staff.admin.deactivateMember({ membershipId, reason: "concurrent removal" })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.membership.count({ where: { organizationId: orgId, role: "OWNER" } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { organizationId: orgId, entityType: "Admin:Membership" } })).toBe(1);
  });

  it("serializes staff removal with a tenant owner demotion", async () => {
    const second = await addUser("OWNER");
    const admin = await addUser("ADMIN");
    const staff = await caller(staffId), tenant = await caller(admin.user.id);
    const results = await Promise.allSettled([
      staff.admin.deactivateMember({ membershipId: ownerMemberId, reason: "remove" }),
      tenant.organization.updateMember({ membershipId: second.member.id, role: "ADMIN", seatType: "FULL" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.membership.count({ where: { organizationId: orgId, role: "OWNER" } })).toBe(1);
  });

  it("rolls ownership changes back when the audit receipt cannot be recorded", async () => {
    const target = await addUser("EDITOR");
    const user = await prisma.user.findUniqueOrThrow({ where: { id: staffId }, include: { memberships: true } });
    const invalidStaff = appRouter.createCaller({ prisma, user: { ...user, id: "missing-staff-actor" }, staff: null });
    await expect(invalidStaff.admin.transferOwnership({ organizationId: orgId, previousOwnerMembershipId: ownerMemberId, newOwnerMembershipId: target.member.id, reason: "audit must succeed" })).rejects.toBeDefined();
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: ownerMemberId } })).role).toBe("OWNER");
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: target.member.id } })).role).toBe("EDITOR");
  });

  it("staff revocation frees one seat idempotently and denies the revoked token", async () => {
    const owner = await caller(ownerId);
    const key = await owner.apiKeys.create({ organizationId: orgId, name: "support revoke", role: "EDITOR" });
    const results = await Promise.all(Array.from({ length: 8 }, () => support().staff.revokeApiKey({ apiKeyId: key.id })));
    expect(new Set(results.map((r) => r.revokedAt.toISOString())).size).toBe(1);
    expect(await fullSeats()).toBe(1);
    const ctx = await createContext({ req: { headers: { authorization: `Bearer ${key.key}` } } } as never);
    await expect(appRouter.createCaller(ctx).organization.mine()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(owner.apiKeys.revoke({ id: key.id })).resolves.toMatchObject({ revokedAt: results[0].revokedAt, seatCleanupPending: false, actionRequired: null });
  });

  it.each(["staff", "tenant"] as const)("%s revokes a legacy sole-owner key immediately and safely cleans its seat after transfer", async (path) => {
    const owner = await caller(ownerId);
    const key = await owner.apiKeys.create({ organizationId: orgId, name: "legacy sole owner", role: "ADMIN" });
    const service = await prisma.apiKey.findUniqueOrThrow({ where: { id: key.id } });
    const serviceMember = await prisma.membership.findUniqueOrThrow({ where: { organizationId_userId: { organizationId: orgId, userId: service.serviceUserId } } });
    // Reproduce historical state that the current ownership writers reject.
    await prisma.$transaction(async (tx) => {
      await lockOrganization(tx, orgId);
      await tx.membership.update({ where: { id: serviceMember.id }, data: { role: "OWNER" } });
      await tx.membership.update({ where: { id: ownerMemberId }, data: { role: "ADMIN" } });
    });
    const freshTokenContext = () => createContext({ req: { headers: { authorization: `Bearer ${key.key}` } } } as never);
    expect((await freshTokenContext()).user?.id).toBe(service.serviceUserId);
    const tenant = await caller(ownerId), staff = await caller(staffId);
    if (path === "staff") await staff.admin.suspendOrganization({ organizationId: orgId, reason: "incident containment fixture" });
    const revoke = () => path === "staff" ? support().staff.revokeApiKey({ apiKeyId: key.id }) : tenant.apiKeys.revoke({ id: key.id });
    const receipts = await Promise.all(Array.from({ length: 6 }, revoke));
    const originalRevokedAt = receipts[0].revokedAt;
    expect(new Set(receipts.map((r) => r.revokedAt.toISOString())).size).toBe(1);
    for (const receipt of receipts) {
      expect(receipt.seatCleanupPending).toBe(true);
      expect(receipt.actionRequired).toContain("Credential revoked");
      expect(receipt.actionRequired).toContain("transfer ownership to a human");
    }
    expect((await prisma.apiKey.findUniqueOrThrow({ where: { id: key.id } })).revokedAt).toEqual(originalRevokedAt);
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: serviceMember.id } })).role).toBe("OWNER");
    expect(await fullSeats()).toBe(2);
    const revokedContext = await freshTokenContext();
    expect(revokedContext.user).toBeNull();
    await expect(appRouter.createCaller(revokedContext).organization.mine()).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    await staff.admin.transferOwnership({ organizationId: orgId, previousOwnerMembershipId: serviceMember.id, newOwnerMembershipId: ownerMemberId, reason: "repair historical service ownership" });
    const cleanup = await revoke();
    expect(cleanup).toEqual({ revokedAt: originalRevokedAt, seatCleanupPending: false, actionRequired: null });
    expect(await prisma.membership.findUnique({ where: { id: serviceMember.id } })).toBeNull();
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: ownerMemberId } })).role).toBe("OWNER");
    expect(await fullSeats()).toBe(1);
    expect((await prisma.apiKey.findUniqueOrThrow({ where: { id: key.id } })).revokedAt).toEqual(originalRevokedAt);
    await expect(revoke()).resolves.toEqual(cleanup);
  });

  it("repairs historical revoked-key seats and works during suspension", async () => {
    const key = await (await caller(ownerId)).apiKeys.create({ organizationId: orgId, name: "historical revoke", role: "EDITOR" });
    const original = new Date("2026-01-01T00:00:00Z");
    await prisma.apiKey.update({ where: { id: key.id }, data: { revokedAt: original } });
    await prisma.organization.update({ where: { id: orgId }, data: { suspendedAt: new Date() } });
    expect((await support().staff.revokeApiKey({ apiKeyId: key.id })).revokedAt).toEqual(original);
    expect(await fullSeats()).toBe(1);
  });

  it("does not promote a service credential into a human owner", async () => {
    const owner = await caller(ownerId);
    const key = await owner.apiKeys.create({ organizationId: orgId, name: "not an owner", role: "ADMIN" });
    const service = await prisma.apiKey.findUniqueOrThrow({ where: { id: key.id } });
    const member = await prisma.membership.findUniqueOrThrow({ where: { organizationId_userId: { organizationId: orgId, userId: service.serviceUserId } } });
    await expect(owner.organization.updateMember({ membershipId: member.id, role: "OWNER", seatType: "FULL" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect((await caller(staffId)).admin.transferOwnership({ organizationId: orgId, previousOwnerMembershipId: ownerMemberId, newOwnerMembershipId: member.id, reason: "not a human" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
