import { TRPCError } from "@trpc/server";
import type { PrismaClient } from "@vaettir/db";
import { assertActiveOrganization, lockOrganization } from "./organizationLock.js";
import { requireAdmin } from "./seatManagement.js";

// Credential revocation is unconditional after authorization. Seat cleanup is
// separate: retain a legacy sole-owner membership until a human takes ownership.
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
    const revokedAt = key.revokedAt ?? new Date();
    if (!key.revokedAt) await tx.apiKey.update({ where: { id: apiKeyId }, data: { revokedAt } });
    const seatCleanupPending = membership?.role === "OWNER" && await tx.membership.count({
      where: { organizationId: org.id, role: "OWNER", id: { not: membership.id } },
    }) === 0;
    if (membership && !seatCleanupPending) await tx.membership.delete({ where: { id: membership.id } });
    return {
      revokedAt,
      seatCleanupPending,
      actionRequired: seatCleanupPending
        ? "Credential revoked. Ask staff to transfer ownership to a human member, then revoke this key again to release its retained full seat."
        : null,
    };
  });
}
