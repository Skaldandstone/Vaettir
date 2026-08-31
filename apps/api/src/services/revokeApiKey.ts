import { TRPCError } from "@trpc/server";
import type { PrismaClient } from "@vaettir/db";
import { assertActiveOrganization, lockOrganization } from "./organizationLock.js";
import { requireAdmin, requireAnotherOwner } from "./seatManagement.js";

// Both support and tenant revocation use the same lock and release the same seat.
// An absent actor means the caller has already passed staffTokenProcedure.
export async function revokeApiKey(db: PrismaClient, apiKeyId: string, actorId?: string) {
  const target = await db.apiKey.findUnique({ where: { id: apiKeyId } });
  if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "API key not found" });
  return db.$transaction(async (tx) => {
    const org = await lockOrganization(tx, target.organizationId);
    if (actorId) {
      assertActiveOrganization(org);
      await requireAdmin(tx, org.id, actorId);
    }
    const key = await tx.apiKey.findUniqueOrThrow({ where: { id: apiKeyId } });
    const membership = await tx.membership.findUnique({ where: { organizationId_userId: { organizationId: org.id, userId: key.serviceUserId } } });
    // Legacy service owners must be transferred before removing their membership.
    if (membership) await requireAnotherOwner(tx, membership);
    const revokedAt = key.revokedAt ?? new Date();
    if (!key.revokedAt) await tx.apiKey.update({ where: { id: apiKeyId }, data: { revokedAt } });
    if (membership) await tx.membership.delete({ where: { id: membership.id } });
    return { revokedAt };
  });
}
