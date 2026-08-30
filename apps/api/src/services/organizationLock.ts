import { TRPCError } from "@trpc/server";
import type { Prisma } from "@vaettir/db";

// Every seat/plan/credit writer takes the same row lock before reading usage.
// Keep network calls outside these short transactions.
export async function lockOrganization(tx: Prisma.TransactionClient, organizationId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string; suspendedAt: Date | null }>>`
    SELECT "id", "suspendedAt" FROM "Organization" WHERE "id" = ${organizationId} FOR UPDATE
  `;
  if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found" });
  return rows[0];
}

export function assertActiveOrganization(org: { suspendedAt: Date | null }) {
  if (org.suspendedAt) {
    throw new TRPCError({ code: "FORBIDDEN", message: "This organization is suspended. Contact support." });
  }
}
