import { TRPCError } from "@trpc/server";
import type { Prisma, PrismaClient, OrgRole, SeatType } from "@vaettir/db";
import { canAddSeat } from "@vaettir/core";
import { assertActiveOrganization, lockOrganization } from "./organizationLock.js";
import { PRIVATE_BETA_TIER } from "./privateBeta.js";
import { effectiveSeatLimits } from "./billingSeats.js";

// Caller holds the organization lock, including while checkout is pending.
export async function requireUnmanagedBilling(tx: Prisma.TransactionClient, organizationId: string) {
  if (await tx.stripeBillingAccount.findUnique({ where: { organizationId }, select: { id: true } })) {
    throw new TRPCError({ code: "FORBIDDEN", message: "This organization's plan is billing-managed. Contact billing support to reconcile it." });
  }
}

export async function requireAdmin(tx: Prisma.TransactionClient, organizationId: string, userId: string) {
  const member = await tx.membership.findUnique({ where: { organizationId_userId: { organizationId, userId } } });
  if (!member || !["OWNER", "ADMIN"].includes(member.role) || member.seatType === "READ_ONLY") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Organization admin access required" });
  }
}

export async function usage(tx: Prisma.TransactionClient, organizationId: string, excludeInvitationId?: string) {
  const [members, pending] = await Promise.all([
    tx.membership.findMany({ where: { organizationId }, select: { seatType: true } }),
    tx.invitation.findMany({ where: {
      organizationId, status: "PENDING", expiresAt: { gt: new Date() },
      ...(excludeInvitationId ? { id: { not: excludeInvitationId } } : {}),
    }, select: { seatType: true } }),
  ]);
  return {
    fullSeats: [...members, ...pending].filter((m) => m.seatType === "FULL").length,
    readOnlySeats: [...members, ...pending].filter((m) => m.seatType === "READ_ONLY").length,
  };
}

function validateRole(role: OrgRole, seatType: SeatType) {
  if (seatType === "READ_ONLY" && role !== "VIEWER") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Read-only seats can only hold the Viewer role" });
  }
}

export async function requireAnotherOwner(tx: Prisma.TransactionClient, member: { id: string; organizationId: string; role: OrgRole }) {
  if (member.role === "OWNER" && await tx.membership.count({ where: { organizationId: member.organizationId, role: "OWNER", id: { not: member.id } } }) === 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "An organization must have at least one Owner" });
  }
}

export async function requireHumanOwner(tx: Prisma.TransactionClient, userId: string) {
  if (await tx.apiKey.findUnique({ where: { serviceUserId: userId }, select: { id: true } })) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Service accounts cannot own an organization. Choose a human member." });
  }
}

export async function inviteMember(db: PrismaClient, actorId: string, input: {
  organizationId: string; email: string; role: OrgRole; seatType: SeatType;
}) {
  return db.$transaction(async (tx) => {
    assertActiveOrganization(await lockOrganization(tx, input.organizationId));
    await requireAdmin(tx, input.organizationId, actorId);
    validateRole(input.role, input.seatType);
    const email = input.email.trim().toLowerCase();
    if (await tx.membership.findFirst({ where: { organizationId: input.organizationId, user: { email: { equals: email, mode: "insensitive" } } } })) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "This person is already a member" });
    }
    if (await tx.invitation.findFirst({ where: { organizationId: input.organizationId, email: { equals: email, mode: "insensitive" }, status: "PENDING", expiresAt: { gt: new Date() } } })) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "This person already has a pending invitation" });
    }
    const org = await tx.organization.findUniqueOrThrow({ where: { id: input.organizationId }, include: { planTier: true } });
    const check = canAddSeat(effectiveSeatLimits(org), await usage(tx, org.id), input.seatType);
    if (!check.allowed) throw new TRPCError({ code: "BAD_REQUEST", message: `${check.reason}. Pending invitations reserve seats; revoke an unused invitation to free one.` });
    return tx.invitation.create({ data: {
      ...input, email, invitedById: actorId, expiresAt: new Date(Date.now() + 7 * 86400000),
    }, select: { id: true, token: true, expiresAt: true } });
  });
}

export async function updateMember(db: PrismaClient, actorId: string, input: { membershipId: string; role: OrgRole; seatType: SeatType }) {
  const target = await db.membership.findUniqueOrThrow({ where: { id: input.membershipId } });
  return db.$transaction(async (tx) => {
    assertActiveOrganization(await lockOrganization(tx, target.organizationId));
    await requireAdmin(tx, target.organizationId, actorId);
    const member = await tx.membership.findUniqueOrThrow({ where: { id: input.membershipId }, include: { organization: { include: { planTier: true } } } });
    validateRole(input.role, input.seatType);
    if (input.role === "OWNER") await requireHumanOwner(tx, member.userId);
    if (input.role !== "OWNER") await requireAnotherOwner(tx, member);
    if (input.seatType !== member.seatType) {
      const check = canAddSeat(effectiveSeatLimits(member.organization), await usage(tx, target.organizationId), input.seatType);
      if (!check.allowed) throw new TRPCError({ code: "BAD_REQUEST", message: check.reason });
    }
    return tx.membership.update({ where: { id: input.membershipId }, data: { role: input.role, seatType: input.seatType } });
  });
}

export async function removeMember(db: PrismaClient, actorId: string, membershipId: string) {
  const target = await db.membership.findUniqueOrThrow({ where: { id: membershipId } });
  await db.$transaction(async (tx) => {
    assertActiveOrganization(await lockOrganization(tx, target.organizationId));
    await requireAdmin(tx, target.organizationId, actorId);
    const member = await tx.membership.findUniqueOrThrow({ where: { id: membershipId } });
    await requireAnotherOwner(tx, member);
    await tx.membership.delete({ where: { id: membershipId } });
  });
}

export async function revokeInvitation(db: PrismaClient, actorId: string, invitationId: string) {
  const target = await db.invitation.findUniqueOrThrow({ where: { id: invitationId } });
  await db.$transaction(async (tx) => {
    assertActiveOrganization(await lockOrganization(tx, target.organizationId));
    await requireAdmin(tx, target.organizationId, actorId);
    const invitation = await tx.invitation.findUniqueOrThrow({ where: { id: invitationId } });
    if (invitation.status !== "PENDING") throw new TRPCError({ code: "BAD_REQUEST", message: "Only pending invitations can be revoked" });
    await tx.invitation.update({ where: { id: invitationId }, data: { status: "REVOKED" } });
  });
}

export async function acceptInvitation(db: PrismaClient, user: { id: string; email: string }, token: string) {
  const target = await db.invitation.findUniqueOrThrow({ where: { token } });
  return db.$transaction(async (tx) => {
    assertActiveOrganization(await lockOrganization(tx, target.organizationId));
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${user.id} FOR UPDATE`;
    const invite = await tx.invitation.findUniqueOrThrow({ where: { token }, include: { organization: { include: { planTier: true } } } });
    if (invite.status !== "PENDING" || invite.expiresAt <= new Date()) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "This invitation is expired or no longer pending" });
    }
    if (invite.email.toLowerCase() !== user.email.toLowerCase()) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Sign in with the email address this invitation was sent to" });
    }
    if (await tx.membership.findUnique({ where: { organizationId_userId: { organizationId: invite.organizationId, userId: user.id } } })) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "You are already a member of this organization" });
    }
    validateRole(invite.role, invite.seatType);
    if (invite.role === "OWNER") await requireHumanOwner(tx, user.id);
    const check = canAddSeat(effectiveSeatLimits(invite.organization), await usage(tx, invite.organizationId, invite.id), invite.seatType);
    if (!check.allowed) throw new TRPCError({ code: "BAD_REQUEST", message: check.reason });
    const membership = await tx.membership.create({ data: {
      organizationId: invite.organizationId, userId: user.id, role: invite.role, seatType: invite.seatType,
    } });
    await tx.invitation.update({ where: { id: invite.id }, data: { status: "ACCEPTED", acceptedAt: new Date() } });
    return membership;
  });
}

export async function changePlanTier(db: PrismaClient, actorId: string, organizationId: string, planTierId: string) {
  return db.$transaction(async (tx) => {
    assertActiveOrganization(await lockOrganization(tx, organizationId));
    await requireAdmin(tx, organizationId, actorId);
    await requireUnmanagedBilling(tx, organizationId);
    const org = await tx.organization.findUniqueOrThrow({ where: { id: organizationId }, include: { planTier: true } });
    const tier = await tx.planTier.findUniqueOrThrow({ where: { id: planTierId } });
    if (org.planTier.key === PRIVATE_BETA_TIER || !tier.isPublic) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Private beta allowances are managed by support. No paid upgrades or automatic charges are available." });
    }
    const counts = await usage(tx, organizationId);
    if ((tier.maxFullSeats !== null && counts.fullSeats > tier.maxFullSeats) || (tier.maxReadOnlySeats !== null && counts.readOnlySeats > tier.maxReadOnlySeats)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Remove excess members or pending invitations before changing plans" });
    }
    await tx.organization.update({ where: { id: organizationId }, data: { planTierId } });
    return { planTierId, planTierName: tier.name };
  });
}
