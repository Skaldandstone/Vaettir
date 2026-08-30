import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type { PrismaClient, User } from "@vaettir/db";

export const PRIVATE_BETA_TIER = "private-beta";
export const BETA_TEAM_LIMIT = 3;

export function normalizeBetaEmail(email: string) {
  return email.trim().toLowerCase();
}

export async function enrollBetaOwner(db: PrismaClient, email: string, actor: string, reason: string) {
  return db.$transaction(async (tx) => {
    // Lock the singleton beta tier to serialize pending cohort reservations.
    await tx.$queryRaw`SELECT "id" FROM "PlanTier" WHERE "key" = ${PRIVATE_BETA_TIER} FOR UPDATE`;
    await tx.planTier.findUniqueOrThrow({ where: { key: PRIVATE_BETA_TIER } });
    const normalized = normalizeBetaEmail(email);
    const existing = await tx.betaEnrollment.findUnique({ where: { email: normalized } });
    if (existing && !existing.revokedAt) return existing;
    if (existing?.claimedAt) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "This enrollment was already claimed. Reactivate the existing organization through support." });
    }
    const reserved = await tx.betaEnrollment.count({ where: { revokedAt: null } });
    if (reserved >= BETA_TEAM_LIMIT) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "The three-team private beta is full. Revoke an unused enrollment before inviting another team." });
    }
    return tx.betaEnrollment.upsert({
      where: { email: normalized },
      create: { email: normalized, createdBy: actor, reason },
      update: { revokedAt: null, createdBy: actor, reason, createdAt: new Date() },
    });
  });
}

export async function revokeBetaEnrollment(db: PrismaClient, id: string) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "PlanTier" WHERE "key" = ${PRIVATE_BETA_TIER} FOR UPDATE`;
    const enrollment = await tx.betaEnrollment.findUniqueOrThrow({ where: { id } });
    if (enrollment.claimedAt) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Claimed enrollments cannot be revoked. Suspend the organization through support instead." });
    }
    return tx.betaEnrollment.update({ where: { id }, data: { revokedAt: new Date() } });
  });
}

export async function bootstrapBetaOrganization(db: PrismaClient, user: Pick<User, "id" | "email">, name: string) {
  return db.$transaction(async (tx) => {
    const email = normalizeBetaEmail(user.email);
    await tx.$queryRaw`SELECT "id" FROM "BetaEnrollment" WHERE "email" = ${email} FOR UPDATE`;
    const enrollment = await tx.betaEnrollment.findUnique({ where: { email } });
    if (!enrollment || enrollment.revokedAt || enrollment.claimedAt) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Vaettir is invite-only. Ask support for a beta owner invitation, or use your team's membership invitation." });
    }
    // Lock the user as well: simultaneous enrollment and invite acceptance
    // must not incorrectly create another workspace for an existing member.
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${user.id} FOR UPDATE`;
    if (await tx.membership.count({ where: { userId: user.id } })) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "User already belongs to an organization" });
    }
    const tier = await tx.planTier.findUniqueOrThrow({ where: { key: PRIVATE_BETA_TIER } });
    const baseSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0,70) || "org";
    const organization = await tx.organization.create({
      data: { name: name.trim(), slug: `${baseSlug}-${randomUUID().slice(0, 8)}`, planTierId: tier.id },
    });
    await tx.membership.create({ data: { organizationId: organization.id, userId: user.id, role: "OWNER", seatType: "FULL" } });
    await tx.betaEnrollment.update({ where: { id: enrollment.id }, data: { claimedAt: new Date(), organizationId: organization.id } });
    await tx.auditLog.create({ data: {
      organizationId: organization.id, actorId: user.id, entityType: "BetaEnrollment", entityId: enrollment.id,
      action: "CREATE", summary: "Private beta invitation accepted; five full seats, two read-only seats, 500 monthly AI credits.",
    } });
    return organization;
  });
}
