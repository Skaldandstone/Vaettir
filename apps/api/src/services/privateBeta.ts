import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type { PrismaClient, User } from "@vaettir/db";

export const PRIVATE_BETA_TIER = "private-beta";
export const BETA_TEAM_LIMIT = 3;

export function normalizeBetaEmail(email: string) {
  return email.trim().toLowerCase();
}

export async function enrollBetaOwner(
  db: PrismaClient,
  email: string,
  actor: string,
  reason: string,
  studioRequestId?: string,
) {
  return db.$transaction(async (tx) => {
    // Every reservation writer takes this singleton lock first. That makes
    // the count-and-create capacity decision safe across API replicas.
    await tx.$queryRaw`SELECT "id" FROM "PlanTier" WHERE "key" = ${PRIVATE_BETA_TIER} FOR UPDATE`;
    await tx.planTier.findUniqueOrThrow({ where: { key: PRIVATE_BETA_TIER } });

    const normalized = normalizeBetaEmail(email);
    if (studioRequestId) {
      const requestEnrollment = await tx.betaEnrollment.findUnique({
        where: { studioRequestId },
      });
      if (requestEnrollment && requestEnrollment.email !== normalized) {
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "This Studio request is already bound to a different email address",
        });
      }
      if (requestEnrollment && !requestEnrollment.revokedAt)
        return requestEnrollment;
    }

    const existing = await tx.betaEnrollment.findUnique({
      where: { email: normalized },
    });
    if (existing && !existing.revokedAt) {
      if (studioRequestId && existing.studioRequestId !== studioRequestId) {
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "This email already has a reservation from a different Studio request",
        });
      }
      return existing;
    }
    if (existing?.claimedAt) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "This enrollment was already claimed. Reactivate the existing organization through support.",
      });
    }

    const reserved = await tx.betaEnrollment.count({
      where: { revokedAt: null },
    });
    if (reserved >= BETA_TEAM_LIMIT) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "The three-team private beta is full. Revoke an unused enrollment before inviting another team.",
      });
    }

    return tx.betaEnrollment.upsert({
      where: { email: normalized },
      create: { email: normalized, createdBy: actor, reason, studioRequestId },
      update: {
        revokedAt: null,
        createdBy: actor,
        reason,
        studioRequestId,
        createdAt: new Date(),
      },
    });
  });
}

export async function revokeBetaEnrollment(
  db: PrismaClient,
  id: string,
  expectedStudioRequestId?: string,
) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "PlanTier" WHERE "key" = ${PRIVATE_BETA_TIER} FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "BetaEnrollment" WHERE "id" = ${id} FOR UPDATE`;
    const enrollment = await tx.betaEnrollment.findUnique({ where: { id } });
    if (
      !enrollment ||
      (expectedStudioRequestId &&
        enrollment.studioRequestId !== expectedStudioRequestId)
    ) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Beta enrollment not found",
      });
    }
    if (enrollment.claimedAt) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "Claimed enrollments cannot be revoked. Suspend the organization through support instead.",
      });
    }
    if (enrollment.revokedAt) return enrollment;
    return tx.betaEnrollment.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
  });
}

export async function bootstrapBetaOrganization(
  db: PrismaClient,
  user: Pick<User, "id" | "email">,
  name: string,
  allowTrustedOwnerBootstrap = false,
) {
  return db.$transaction(async (tx) => {
    // Keep the shared lock order PlanTier -> BetaEnrollment -> User across
    // enrollment, claim and revocation writers to avoid deadlocks.
    await tx.$queryRaw`SELECT "id" FROM "PlanTier" WHERE "key" = ${PRIVATE_BETA_TIER} FOR UPDATE`;
    const email = normalizeBetaEmail(user.email);
    await tx.$queryRaw`SELECT "id" FROM "BetaEnrollment" WHERE "email" = ${email} FOR UPDATE`;
    let enrollment = await tx.betaEnrollment.findUnique({ where: { email } });
    if (!enrollment && allowTrustedOwnerBootstrap) {
      const reserved = await tx.betaEnrollment.count({
        where: { revokedAt: null },
      });
      if (reserved >= BETA_TEAM_LIMIT) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "The three-team private beta is full. Revoke an unused enrollment before creating another workspace.",
        });
      }
      enrollment = await tx.betaEnrollment.create({
        data: {
          email,
          createdBy: `owner:${user.id}`,
          reason: "Automatic full-access owner onboarding",
        },
      });
    }
    if (!enrollment || enrollment.revokedAt || enrollment.claimedAt) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message:
          "Vaettir is invite-only. Ask support for a beta owner invitation, or use your team's membership invitation.",
      });
    }

    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${user.id} FOR UPDATE`;
    if (
      await tx.apiKey.findUnique({
        where: { serviceUserId: user.id },
        select: { id: true },
      })
    ) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message:
          "Sign in with a human account to accept a beta owner enrollment",
      });
    }
    if (await tx.membership.count({ where: { userId: user.id } })) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "User already belongs to an organization",
      });
    }

    const tier = await tx.planTier.findUniqueOrThrow({
      where: { key: PRIVATE_BETA_TIER },
    });
    const trimmedName = name.trim();
    const baseSlug =
      trimmedName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "")
        .slice(0, 70) || "org";
    const organization = await tx.organization.create({
      data: {
        name: trimmedName,
        slug: `${baseSlug}-${randomUUID().slice(0, 8)}`,
        planTierId: tier.id,
      },
    });
    await tx.membership.create({
      data: {
        organizationId: organization.id,
        userId: user.id,
        role: "OWNER",
        seatType: "FULL",
      },
    });
    await tx.betaEnrollment.update({
      where: { id: enrollment.id },
      data: { claimedAt: new Date(), organizationId: organization.id },
    });
    if (tier.includedAiCreditsPerMonth > 0) {
      await tx.aiCreditTransaction.create({
        data: {
          organizationId: organization.id,
          type: "GRANT",
          amount: tier.includedAiCreditsPerMonth,
          description: `Initial monthly grant, ${tier.key} tier`,
        },
      });
    }
    await tx.auditLog.create({
      data: {
        organizationId: organization.id,
        actorId: user.id,
        entityType: "BetaEnrollment",
        entityId: enrollment.id,
        action: "CREATE",
        summary:
          "Private beta invitation accepted; five full seats, two read-only seats, 500 monthly AI credits.",
      },
    });
    return organization;
  });
}
